import {
  streamText,
  generateText,
  stepCountIs,
  type UIMessageStreamWriter,
} from 'ai';
import type {
  ContinuationOption,
  ContinueRequest,
  RetrievalStep,
  StoryNode,
  StoryPreferences,
} from '@storywriter/types';
import type { StoryService } from './story-service.js';
import type { BranchService } from './branch-service.js';
import type { NodeService } from './node-service.js';
import type { PreferenceService } from './preference-service.js';
import type { SettingsService } from './settings-service.js';
import type { MemoryService } from '../memory/memory-service.js';
import { memoryTools } from './retrieval-agent.js';
import { languageModel } from '../llm/model.js';
import {
  buildSystemPrompt,
  buildContinuationPrompt,
  preferencesToPrompt,
  SUGGESTIONS_SYSTEM,
} from '../llm/prompts.js';
import { parseContinuationOptions } from './continuation-options.js';

export type StreamWriter = UIMessageStreamWriter;

export class GenerationService {
  constructor(
    private stories: StoryService,
    private branches: BranchService,
    private nodes: NodeService,
    private preferences: PreferenceService,
    private settings: SettingsService,
    private memory: MemoryService,
  ) {}

  /**
   * Agentic retrieval → stream prose → save node → propose continuations.
   * Story memory ingest runs in the background so the writer is not blocked.
   */
  async continue(req: ContinueRequest, writer: StreamWriter): Promise<void> {
    const appCall = await this.settings.callOptions();
    const suggestionCount = req.suggestionCount ?? appCall.suggestionCount;
    const recentCount = appCall.recentNodeCount;
    const model = languageModel(appCall);

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
      writer.write({ type: 'data-error', data: { error: (err as Error).message } });
      return;
    }

    const prefs =
      (await this.preferences.getLatest(req.storyId))?.preferences ?? ({} as StoryPreferences);

    const lineageBranch =
      req.parentBranchId && req.parentBranchId !== req.branchId
        ? req.parentBranchId
        : branch.parentBranchId && branch.forkNodeId
          ? branch.parentBranchId
          : req.branchId;
    const relatedBranches = lineageBranch === req.branchId ? [] : [lineageBranch];

    const path = await this.nodes.lineage(current);
    const allowedEpisodeUuids = await this.nodes.allowedEpisodeUuids(path.map((n) => n.id));
    const recent = await this.nodes.recentNodes(
      lineageBranch === req.branchId ? req.branchId : lineageBranch,
      recentCount,
    );

    const retrievalQuery =
      req.instruction?.trim() || 'Continue the story coherently from the current scene';

    writer.write({
      type: 'data-activity',
      data: { type: 'thinking', message: 'Deciding what to recall from memory…', at: new Date().toISOString() },
    });

    const gathered: string[] = [];
    const tools = memoryTools(this.memory, {
      storyId: req.storyId,
      branchId: req.branchId,
      query: retrievalQuery,
      depth: appCall.retrievalDepth,
      relatedBranches,
      allowedEpisodeUuids,
      onStep: (step: RetrievalStep) => {
        writer.write({ type: 'data-retrieval', data: step });
        if (step.facts?.length) gathered.push(...step.facts);
      },
    });

    try {
      const research = streamText({
        model,
        tools,
        stopWhen: stepCountIs(6),
        temperature: 0.2,
        system:
          'You are a story memory retrieval agent. Call search_memory and look_up_entity until you have the facts needed to continue this story without contradictions. Prefer a few precise searches over many. When you have enough, stop calling tools.',
        prompt: [
          `Writer's direction: ${retrievalQuery}`,
          current.content?.trim() ? `Current scene:\n${current.content.trim().slice(0, 4000)}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      });
      for await (const _ of research.fullStream) {
        /* drain so tools execute; UI updates come from onStep */
      }
    } catch (err) {
      writer.write({
        type: 'data-retrieval',
        data: {
          id: 'research-error',
          tool: 'search_memory',
          query: retrievalQuery,
          status: 'error',
          facts: [(err as Error).message],
          at: new Date().toISOString(),
        },
      });
    }

    const uniqueFacts = [...new Set(gathered)].slice(0, 24);
    const memoryContext = uniqueFacts.map((f) => `- ${f}`).join('\n');

    writer.write({
      type: 'data-activity',
      data: { type: 'generation_started', message: 'Writing continuation…', at: new Date().toISOString() },
    });

    const system = buildSystemPrompt(prefs, branch.name, memoryContext, recent.length ? recent : path.slice(-recentCount));
    const user = buildContinuationPrompt({
      currentNode: current.content,
      instruction: req.instruction,
      style: req.style,
    });

    let text = '';
    writer.write({ type: 'text-start', id: 'prose' });
    try {
      const result = streamText({
        model,
        temperature: req.temperature ?? appCall.temperature,
        maxOutputTokens: req.maxTokens ?? appCall.maxTokens,
        system,
        prompt: user,
      });
      for await (const delta of result.textStream) {
        text += delta;
        writer.write({ type: 'text-delta', id: 'prose', delta });
      }
    } catch (err) {
      if (!text.trim()) {
        writer.write({ type: 'text-end', id: 'prose' });
        writer.write({
          type: 'data-error',
          data: { error: `LLM error: ${(err as Error).message}` },
        });
        return;
      }
    }
    writer.write({ type: 'text-end', id: 'prose' });

    const trimmed = text.trim();
    if (!trimmed) {
      writer.write({
        type: 'data-error',
        data: { error: 'The model returned an empty response. Check your LLM settings.' },
      });
      return;
    }

    const node = await this.nodes.create({
      branchId: req.branchId,
      parentNodeId: current.id,
      content: trimmed,
      nodeType: 'AI_GENERATED',
      author: 'ai',
      continuationLabel: req.style || null,
      makeCurrent: true,
    });
    writer.write({ type: 'data-node', data: node });
    writer.write({
      type: 'data-activity',
      data: { type: 'node_saved', message: 'Node saved.', at: new Date().toISOString() },
    });

    const options = await this.streamSuggestions(
      { storyId: req.storyId, branchId: req.branchId, nodeId: node.id, count: suggestionCount },
      writer,
    );
    writer.write({ type: 'data-continuations', data: { options } });
  }

  async generateSuggestions(params: {
    storyId: string;
    branchId: string;
    nodeId?: string;
    count?: number;
    instruction?: string;
  }): Promise<ContinuationOption[]> {
    return this.streamSuggestions(params);
  }

  private async streamSuggestions(
    params: {
      storyId: string;
      branchId: string;
      nodeId?: string;
      count?: number;
      instruction?: string;
    },
    writer?: StreamWriter,
  ): Promise<ContinuationOption[]> {
    const appCall = await this.settings.callOptions();
    const count = Math.min(params.count ?? appCall.suggestionCount, 8);
    const model = languageModel(appCall);
    const prefs =
      (await this.preferences.getLatest(params.storyId))?.preferences ?? ({} as StoryPreferences);
    const current =
      params.nodeId && params.nodeId !== 'new'
        ? await this.nodes.get(params.nodeId)
        : await this.nodes.current(params.branchId);
    const soFar = current ? await this.lineageWindow(current, 12_000) : [];

    const system = [SUGGESTIONS_SYSTEM.replace('numberOfOptions', String(count)), '', preferencesToPrompt(prefs)].join(
      '\n',
    );
    const user = [
      '## The Story So Far (previous episodes, oldest first)',
      soFar.length
        ? soFar
            .map((n, i) => `${i + 1}. ${n.continuationLabel ? `[${n.continuationLabel}] ` : ''}${n.content.trim()}`)
            .join('\n\n')
        : '(the story is just beginning)',
      '',
      `## Current End of Story\n${current?.content?.trim() || '(the story is just beginning)'}`,
      params.instruction?.trim() ? `\n## Writer's hint\n${params.instruction.trim()}` : '',
      `\nPropose ${count} distinct, meaningful continuations.`,
    ].join('\n');

    writer?.write({
      type: 'data-activity',
      data: { type: 'thinking', message: 'Proposing what happens next…', at: new Date().toISOString() },
    });

    try {
      const result = await generateText({
        model,
        system,
        prompt: user,
        temperature: 0.9,
        maxOutputTokens: 1200,
        abortSignal: AbortSignal.timeout(45_000),
      });
      const options = parseContinuationOptions(result.text, count);
      if (options.length) writer?.write({ type: 'data-continuations', data: { options } });
      return options;
    } catch (err) {
      console.warn('[suggestions] generateText failed', (err as Error).message);
      return [];
    }
  }

  private async lineageWindow(node: StoryNode, maxChars: number, maxNodes = 40): Promise<StoryNode[]> {
    const chain = await this.nodes.lineage(node, maxNodes);
    const picked: StoryNode[] = [];
    let total = 0;
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      if (n.id === node.id) continue;
      const len = n.content.trim().length + 60;
      if (total + len > maxChars && picked.length >= 3) break;
      total += len;
      picked.unshift(n);
    }
    return picked;
  }
}
