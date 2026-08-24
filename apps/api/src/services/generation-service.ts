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
  preferencesToPrompt,
  SUGGESTIONS_SYSTEM,
} from '../llm/prompts.js';

export type Emit = (chunk: ContinueStreamChunk) => void;

// Suggestions must always answer: a generous deadline (well under the LLM
// client's 120s chat timeout) plus a bounded "story so far" window (previous
// nodes injected into the model context). Transient provider failures (504s,
// timeouts, unparseable output) are retried; if every attempt fails the caller
// gets an empty list and the UI shows a retry button — never misleading
// generic options the model didn't actually write.
const SUGGESTIONS_DEADLINE_MS = 115 * 1000;
const SUGGESTIONS_CONTEXT_CHARS = 12_000;
const SUGGESTIONS_ATTEMPTS = 3;

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

    // Keep-alive heartbeat: emit an activity every 20s while waiting on the
    // (sometimes slow) model, so the client's stream watchdog never trips and
    // the user gets continuous "still working" feedback.
    let tokensStarted = false;
    const heartbeat = setInterval(() => {
      if (!tokensStarted) {
        this.emitActivity(emit, 'thinking', 'Still working — waiting for the model...');
      }
    }, 20_000);

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

      // --- Retrieval (direct semantic search; skip the extra LLM intent-
      // planning call so the first token arrives much sooner) ---
      const { context } = await this.retrieval.retrieve({
        storyId: req.storyId,
        branchId: req.branchId,
        query: retrievalQuery,
        depth: appCall.retrievalDepth,
        relatedBranches,
        skipPlanning: true,
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
      let interrupted = false;
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
            tokensStarted = true;
            text += chunk.delta;
            emit({ kind: 'activity', activity: this.activity('generation_token', undefined, { token: chunk.delta }) });
          }
        }
      } catch (err) {
        if (err instanceof LLMError) {
          emit({ kind: 'error', error: `LLM error: ${err.message}`, at: new Date().toISOString() });
          return;
        }
        // The provider dropped the connection mid-generation (common with
        // proxies/timeouts). If we already streamed a meaningful passage, keep
        // it as the node instead of failing — a node must always land so
        // branching and continuing always work.
        interrupted = true;
        console.warn('[generation] stream interrupted:', (err as Error).message);
      }

      let trimmed = text.trim();
      if (!trimmed) {
        emit({ kind: 'error', error: 'The model returned an empty response. Check your LLM settings.', at: new Date().toISOString() });
        return;
      }
      if (interrupted) {
        trimmed = cutAtSentence(trimmed);
        this.emitActivity(emit, 'generation_finished', 'Connection dropped — the partial scene was saved. You can continue it.');
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
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Generate N distinct continuation options for a node (no prose saved).
   * The options are grounded in the real story: the full narrative lineage of
   * previous nodes leading up to the node (injected oldest → newest) plus the
   * writer's preferences. A hard deadline guarantees the caller always gets an
   * answer, even if the LLM stalls.
   */
  async generateSuggestions(
    params: { storyId: string; branchId: string; nodeId?: string; count?: number; instruction?: string },
    onThinking?: (msg: string) => void,
  ): Promise<ContinuationOption[]> {
    const appCall = await this.settings.callOptions();
    const count = Math.min(params.count ?? appCall.suggestionCount, 8);
    onThinking?.('Generating continuation options...');

    // One overall deadline guards the whole call; transient failures (504s,
    // timeouts, unparseable output) are retried a few times with backoff.
    const timer: { current?: NodeJS.Timeout } = {};
    const deadline = new Promise<{ timeout: true }>((resolve) => {
      timer.current = setTimeout(() => resolve({ timeout: true }), SUGGESTIONS_DEADLINE_MS);
    });

    let lastErr: unknown;
    for (let attempt = 1; attempt <= SUGGESTIONS_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        onThinking?.(`Retrying suggestion generation (attempt ${attempt})...`);
      }
      try {
        const result = await Promise.race([this.runSuggestions(params, appCall, count), deadline]);
        if ('timeout' in result) {
          clearTimeout(timer.current);
          console.warn('[suggestions] deadline hit — returning no options');
          onThinking?.('Took too long — try again.');
          return [];
        }
        clearTimeout(timer.current);
        return result;
      } catch (err) {
        lastErr = err;
        console.warn(`[suggestions] attempt ${attempt} failed:`, (err as Error).message);
      }
    }
    clearTimeout(timer.current);
    console.warn('[suggestions] all attempts failed — returning no options:', (lastErr as Error)?.message);
    onThinking?.('Could not generate suggestions — try again.');
    return [];
  }

  private async runSuggestions(
    params: { storyId: string; branchId: string; nodeId?: string; count?: number; instruction?: string },
    appCall: Awaited<ReturnType<SettingsService['callOptions']>>,
    count: number,
  ): Promise<ContinuationOption[]> {
    const prefs =
      (await this.preferences.getLatest(params.storyId))?.preferences ?? ({} as StoryPreferences);
    const current =
      params.nodeId && params.nodeId !== 'new'
        ? await this.nodes.get(params.nodeId)
        : await this.nodes.current(params.branchId);

    // The narrative lineage: every previous episode that led to this node,
    // oldest → newest (walks parentNodeId across branches, so forked branches
    // inherit their parent branch's context too).
    const soFar = current ? await this.lineage(current, SUGGESTIONS_CONTEXT_CHARS) : [];

    const system = [
      SUGGESTIONS_SYSTEM.replace('numberOfOptions', String(count)),
      '',
      preferencesToPrompt(prefs),
    ].join('\n');

    const user = [
      '## The Story So Far (previous episodes, oldest first)',
      soFar.length
        ? soFar
            .map(
              (n, i) =>
                `${i + 1}. ${n.continuationLabel ? `[${n.continuationLabel}] ` : ''}${n.content.trim()}`,
            )
            .join('\n\n')
        : '(the story is just beginning)',
      '',
      `## Current End of Story\n${current?.content?.trim() || '(the story is just beginning)'}`,
      params.instruction?.trim() ? `\n## Writer's hint\n${params.instruction.trim()}` : '',
      `\nPropose ${count} distinct, meaningful continuations as STRICT JSON.`,
    ].join('\n');

    // Note: deliberately no jsonMode — `response_format` triggers 504s on some
    // proxies; the tolerant parser below handles JSON embedded in prose.
    const result = await chat({ ...appCall, temperature: 0.9, maxTokens: 900 }, [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);
    const parsed = parseSuggestions(result.text);
    if (parsed.length === 0) throw new Error('No suggestions parsed');
    return parsed;
  }

  /** Walk the parentNodeId chain up to the story root, trimmed to fit the budget. */
  private async lineage(node: StoryNode, maxChars: number, maxNodes = 40): Promise<StoryNode[]> {
    const chain: StoryNode[] = [node];
    const seen = new Set<string>([node.id]);
    let cursor = node;
    while (cursor.parentNodeId && !seen.has(cursor.parentNodeId) && chain.length < maxNodes) {
      try {
        cursor = await this.nodes.get(cursor.parentNodeId);
      } catch {
        break;
      }
      seen.add(cursor.id);
      chain.unshift(cursor);
    }

    // Keep the most recent episodes that fit within maxChars (minus the node
    // itself — it is presented separately as the "Current End of Story").
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

/**
 * Tolerant parser for the model's suggestion JSON. Accepts a top-level
 * "options"/"suggestions" array, a bare array, or objects embedded in prose.
 * Falls back to [] only when nothing recognizable is found.
 */
function parseSuggestions(text: string): ContinuationOption[] {
  const cleaned = text.replace(/```/g, '').replace(/^json/i, '').trim();
  const found = extractOptionObjects(cleaned);
  if (found.length === 0) {
    console.warn('[suggestions] unparseable model text:', cleaned.slice(0, 500));
  }
  return found.slice(0, 8).map((o, i) => ({
    id: `sug-${i}-${Date.now()}`,
    label: String(o.label ?? `Option ${i + 1}`).slice(0, 80),
    summary: String(o.summary ?? ''),
  }));
}

function extractOptionObjects(text: string): Array<{ label?: unknown; summary?: unknown }> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) {
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      const arr =
        json?.options ?? json?.suggestions ?? (Array.isArray(json) ? json : null);
      if (Array.isArray(arr)) {
        const list = arr.filter((x: any) => x && typeof x === 'object' && (x.label || x.summary));
        if (list.length) return list;
      }
    } catch {
      /* not clean JSON — try embedded objects below */
    }
  }

  // Embedded objects in prose: {"label": "...", "summary": "..."}
  const out: Array<{ label?: unknown; summary?: unknown }> = [];
  const re = /\{[^{}]*\"label\"\s*:\s*\"[^\"]+\"[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o === 'object' && o.label) out.push(o);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** Trim a possibly-interrupted passage to the last complete sentence. */
function cutAtSentence(text: string): string {
  const t = text.trim();
  if (t.length <= 400) return t;
  const enders = ['.', '!', '؟'];
  let best = -1;
  for (let i = t.length - 1; i > t.length * 0.4; i--) {
    if (enders.includes(t[i])) {
      best = i;
      break;
    }
  }
  if (best === -1) return t;
  return t.slice(0, best + 1).trim();
}

