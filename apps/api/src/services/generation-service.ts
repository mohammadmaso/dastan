import type {
  ActivityEvent,
  ContinuationOption,
  ContinueRequest,
  ContinueStreamChunk,
  StoryNode,
  StoryPreferences,
} from '@storywriter/types';
import type { StoryService } from './story-service.js';
import type { BranchService } from './branch-service.js';
import type { NodeService } from './node-service.js';
import type { PreferenceService } from './preference-service.js';
import type { SettingsService } from './settings-service.js';
import type { MemoryService } from '../memory/memory-service.js';
import { RetrievalAgent } from './retrieval-agent.js';
import { streamChat, chat, LLMError } from '../llm/client.js';
import {
  buildSystemPrompt,
  buildContinuationPrompt,
  SUGGESTIONS_SYSTEM,
} from '../llm/prompts.js';

export type Emit = (chunk: ContinueStreamChunk) => void;

export class GenerationService {
  private retrieval: RetrievalAgent;

  constructor(
    private stories: StoryService,
    private branches: BranchService,
    private nodes: NodeService,
    private preferences: PreferenceService,
    private settings: SettingsService,
    private memory: MemoryService,
  ) {
    this.retrieval = new RetrievalAgent(memory);
  }

  private activity(type: ActivityEvent['type'], message?: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
    return { type, message, at: new Date().toISOString(), ...extra };
  }

  private emitActivity(emit: Emit, type: ActivityEvent['type'], message: string, extra: Partial<ActivityEvent> = {}) {
    emit({ kind: 'activity', activity: this.activity(type, message, extra) });
  }

  /**
   * Generate a continuation: agentic retrieval → stream prose → save node →
   * add episode to memory → propose continuations. Everything is streamed.
   */
  async continue(req: ContinueRequest, emit: Emit): Promise<void> {
    const appCall = await this.settings.callOptions();
    const suggestionCount = req.suggestionCount ?? appCall.suggestionCount;
    const recentCount = appCall.recentNodeCount;

    let branch: Awaited<ReturnType<typeof this.branches.get>>;
    let current: StoryNode;
    try {
      branch = await this.branches.get(req.branchId);
      const candidate =
        req.nodeId && req.nodeId !== 'new'
          ? await this.nodes.get(req.nodeId)
          : await this.nodes.current(req.branchId);
      if (!candidate) throw new Error('No current node to continue from');
      current = candidate;
    } catch (err) {
      emit({ kind: 'error', error: (err as Error).message, at: new Date().toISOString() });
      return;
    }

    try {
      this.emitActivity(emit, 'thinking', 'AI is thinking about the next scene...');

      const prefs =
        (await this.preferences.getLatest(req.storyId))?.preferences ?? ({} as StoryPreferences);

      // When writing into a forked companion branch, inherit lineage context from
      // the parent branch so the new branch has continuity.
      const lineageBranch =
        req.parentBranchId && req.parentBranchId !== req.branchId
          ? req.parentBranchId
          : req.branchId;
      const relatedBranches =
        lineageBranch === req.branchId ? [] : [lineageBranch];
      const recent = await this.nodes.recentNodes(lineageBranch, recentCount);

      const retrievalQuery = req.instruction?.trim() || 'Continue the story coherently from the current scene';

      // --- Agentic retrieval ---
      const { context } = await this.retrieval.retrieve({
        storyId: req.storyId,
        branchId: req.branchId,
        query: retrievalQuery,
        depth: appCall.retrievalDepth,
        relatedBranches,
        onActivity: (type, message, query, scope) =>
          this.emitActivity(emit, this.mapRetrievalType(type), message ?? '', {
            query,
            scope: scope as ActivityEvent['scope'],
          }),
      });

      this.emitActivity(emit, 'building_context', 'Building narrative context...');

      const system = buildSystemPrompt(prefs, branch.name, context, recent);
      const user = buildContinuationPrompt({
        currentNode: current.content,
        instruction: req.instruction,
        style: req.style,
      });

      // --- Stream prose ---
      this.emitActivity(emit, 'generation_started', 'Writing continuation...');
      let text = '';
      const maxTokens = req.maxTokens ?? appCall.maxTokens;
      const temperature = req.temperature ?? appCall.temperature;
      try {
        for await (const chunk of streamChat(
          { ...appCall, temperature, maxTokens },
          [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        )) {
          if (chunk.delta) {
            text += chunk.delta;
            emit({ kind: 'activity', activity: this.activity('generation_token', undefined, { token: chunk.delta }) });
          }
        }
      } catch (err) {
        if (err instanceof LLMError) {
          emit({ kind: 'error', error: `LLM error: ${err.message}`, at: new Date().toISOString() });
          return;
        }
        throw err;
      }

      const trimmed = text.trim();
      if (!trimmed) {
        emit({ kind: 'error', error: 'The model returned an empty response. Check your LLM settings.', at: new Date().toISOString() });
        return;
      }

      this.emitActivity(emit, 'generation_finished', 'Continuation complete.');

      // --- Save node ---
      const node = await this.nodes.create(
        {
          branchId: req.branchId,
          parentNodeId: current.id,
          content: trimmed,
          nodeType: 'AI_GENERATED',
          author: 'ai',
          continuationLabel: req.style || null,
          makeCurrent: true,
        },
        { skipMemory: true }, // memory added explicitly below for activity transparency
      );
      emit({ kind: 'node', node });

      // --- Add episode to memory ---
      await this.memory.addNodeEpisode(node);
      this.emitActivity(emit, 'node_saved', 'Node saved and added to story memory.');

      // --- Generate continuations ---
      const options = await this.generateSuggestions(
        { storyId: req.storyId, branchId: req.branchId, nodeId: node.id, count: suggestionCount },
        (m) => this.emitActivity(emit, 'thinking', m),
      );
      emit({ kind: 'continuations', continuations: options });
      emit({ kind: 'done', at: new Date().toISOString() });
    } catch (err) {
      console.error('[generation] pipeline error', err);
      emit({
        kind: 'error',
        error: err instanceof Error ? err.message : 'Unexpected generation error',
        at: new Date().toISOString(),
      });
    }
  }

  /** Generate N distinct continuation options for a node (no prose saved). */
  async generateSuggestions(
    params: { storyId: string; branchId: string; nodeId?: string; count?: number; instruction?: string },
    onThinking?: (msg: string) => void,
  ): Promise<ContinuationOption[]> {
    const appCall = await this.settings.callOptions();
    const count = Math.min(params.count ?? appCall.suggestionCount, 8);
    onThinking?.('Generating continuation options...');

    const prefs =
      (await this.preferences.getLatest(params.storyId))?.preferences ?? ({} as StoryPreferences);
    const current =
      params.nodeId && params.nodeId !== 'new'
        ? await this.nodes.get(params.nodeId)
        : await this.nodes.current(params.branchId);
    const recent = await this.nodes.recentNodes(params.branchId, appCall.recentNodeCount);
    const branch = await this.branches.get(params.branchId);

    const { context } = await this.retrieval.retrieve({
      storyId: params.storyId,
      branchId: params.branchId,
      query: params.instruction?.trim() || 'Where should this story go next?',
      depth: appCall.retrievalDepth,
    });

    const system = [
      SUGGESTIONS_SYSTEM.replace('numberOfOptions', String(count)),
      '',
      buildSystemPrompt(prefs, branch.name, context, recent),
    ].join('\n');

    const user = [
      current?.content
        ? `## Current End of Story\n${current.content.trim()}`
        : 'The story is just beginning.',
      params.instruction?.trim() ? `\n## Writer's hint\n${params.instruction.trim()}` : '',
      `\nPropose ${count} distinct, meaningful continuations as STRICT JSON.`,
    ].join('\n');

    try {
      const result = await chat({ ...appCall, jsonMode: true, temperature: 0.9, maxTokens: 900 }, [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ]);
      const parsed = parseSuggestions(result.text);
      if (parsed.length === 0) throw new Error('No suggestions parsed');
      return parsed;
    } catch (err) {
      onThinking?.('Could not generate suggestions (' + (err as Error).message + '), returning generic suggestions.');
      return genericSuggestions(count);
    }
  }

  private mapRetrievalType(type: string): ActivityEvent['type'] {
    switch (type) {
      case 'searching_memory':
      case 'search_intent':
      case 'memory_found':
      case 'reviewing_recent':
        return type as ActivityEvent['type'];
      default:
        return 'thinking';
    }
  }
}

function parseSuggestions(text: string): ContinuationOption[] {
  try {
    const cleaned = text.replace(/```/g, '').replace(/^json/i, '').trim();
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s === -1 || e === -1) return [];
    const json = JSON.parse(cleaned.slice(s, e + 1));
    const options = json.options ?? [];
    return options
      .map((o: any, i: number) => ({
        id: `sug-${i}-${Date.now()}`,
        label: String(o.label ?? `Option ${i + 1}`).slice(0, 80),
        summary: String(o.summary ?? ''),
      }))
      .slice(0, 8);
  } catch {
    return [];
  }
}

function genericSuggestions(count: number): ContinuationOption[] {
  const labels = [
    'A sudden complication',
    'The quiet aftermath',
    'An unexpected revelation',
    'A change of plans',
    'The confrontation',
    'A hidden clue',
    'A new arrival',
    'The turning point',
  ];
  return labels.slice(0, count).map((label, i) => ({
    id: `sug-${i}-${Date.now()}`,
    label,
    summary: `A possible direction that builds on the current state of the story.`,
  }));
}
