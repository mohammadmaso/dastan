import { MemoryScope } from '@storywriter/types';
import type { RetrievedMemory } from '@storywriter/types';
import type { MemoryService } from '../memory/memory-service.js';

export interface RetrievalAgentInput {
  storyId: string;
  branchId: string;
  query: string;
  scopes?: MemoryScope[];
  depth?: number;
  relatedBranches?: string[];
  /** Skip the LLM intent-planning step and search the raw query directly. */
  skipPlanning?: boolean;
  onActivity?: (
    type: 'searching_memory' | 'search_intent' | 'memory_found' | 'reviewing_recent',
    message?: string,
    query?: string,
    scope?: string,
  ) => void;
}

/**
 * Agentic retrieval: determines the necessary memories, runs one or more
 * scoped searches, and returns a compact context the generator can use.
 * Only high-level search intents/activity are surfaced — never chain-of-thought.
 */
export class RetrievalAgent {
  constructor(private memory: MemoryService) {}

  async retrieve(input: RetrievalAgentInput): Promise<{ memories: RetrievedMemory[]; context: string }> {
    const depth = input.depth ?? 5;
    const emit = input.onActivity;

    emit?.('reviewing_recent', 'Reviewing recent events in this branch...');

    const { memories } = await this.memory.retrieve({
      storyId: input.storyId,
      branchId: input.branchId,
      query: input.query,
      scopes: input.scopes ?? [MemoryScope.BRANCH, MemoryScope.GLOBAL],
      depth,
      emit,
      relatedBranches: input.relatedBranches,
      skipPlanning: input.skipPlanning,
    });

    if (memories.length) {
      emit?.('memory_found', `${memories.length} relevant memories retrieved for context.`);
    }

    const branchMemories = memories
      .filter((m) => m.scope === MemoryScope.BRANCH)
      .map((m) => `[This branch] ${m.text}`);
    const globalMemories = memories
      .filter((m) => m.scope === MemoryScope.GLOBAL)
      .map((m) => `[Story-wide] ${m.text}`);

    const context = [...globalMemories, ...branchMemories].join('\n\n');

    return { memories, context };
  }
}
