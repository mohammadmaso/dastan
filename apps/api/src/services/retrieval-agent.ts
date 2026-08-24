import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { MemoryScope } from '@storywriter/types';
import type { RetrievalStep } from '@storywriter/types';
import type { MemoryService } from '../memory/memory-service.js';
import { branchGroup, keepFact, worldGroup } from '../memory/groups.js';

export interface RetrievalAgentInput {
  storyId: string;
  branchId: string;
  query: string;
  depth?: number;
  relatedBranches?: string[];
  allowedEpisodeUuids?: string[];
  onStep?: (step: RetrievalStep) => void;
}

/**
 * Agentic retrieval tools. The model decides what to look up; each call is
 * surfaced to the UI as a RetrievalStep (never chain-of-thought).
 */
export function memoryTools(
  memory: MemoryService,
  input: RetrievalAgentInput,
): ToolSet {
  const world = worldGroup(input.storyId);
  const own = branchGroup(input.storyId, input.branchId);
  const ancestors = (input.relatedBranches ?? []).map((id) =>
    branchGroup(input.storyId, id),
  );
  const ctx = {
    worldGroup: world,
    branchGroup: own,
    ancestorGroups: ancestors,
    allowedEpisodeUuids: new Set(input.allowedEpisodeUuids ?? []),
  };
  const depth = input.depth ?? 5;
  let stepN = 0;

  const emit = (partial: Omit<RetrievalStep, 'id' | 'at'> & { id?: string }) => {
    input.onStep?.({
      id: partial.id ?? `r-${++stepN}`,
      at: new Date().toISOString(),
      ...partial,
    });
  };

  const filterHits = (
    hits: Array<{ fact: string; group_id?: string | null; episodes?: string[]; score?: number | null }>,
  ) =>
    hits.filter((h) =>
      keepFact(
        {
          fact: h.fact,
          groupId: h.group_id ?? null,
          episodeUuids: h.episodes ?? [],
          score: h.score,
        },
        ctx,
      ),
    );

  return {
    search_memory: tool({
      description:
        'Search this story\'s Graphiti memory for facts needed to continue coherently. Use CURRENT_BRANCH_MEMORY for events unique to this path, GLOBAL_STORY_MEMORY for world/character bible shared across branches.',
      inputSchema: z.object({
        query: z.string().describe('A specific natural-language search query about one fact'),
        scope: z
          .enum(['CURRENT_BRANCH_MEMORY', 'GLOBAL_STORY_MEMORY'])
          .optional()
          .describe('Which memory namespace to search'),
      }),
      execute: async ({ query, scope }) => {
        const id = `r-${++stepN}`;
        const memScope =
          scope === 'GLOBAL_STORY_MEMORY' ? MemoryScope.GLOBAL : MemoryScope.BRANCH;
        emit({
          id,
          tool: 'search_memory',
          query,
          scope: memScope,
          status: 'searching',
        });
        const groupIds =
          scope === 'GLOBAL_STORY_MEMORY' ? [world] : [world, own, ...ancestors];
        try {
          const hits = await memory.search(query, groupIds, depth);
          const kept = filterHits(hits);
          const facts = kept.map((h) => h.fact).filter(Boolean);
          emit({
            id,
            tool: 'search_memory',
            query,
            scope: memScope,
            status: facts.length ? 'found' : 'empty',
            facts,
          });
          return { facts, count: facts.length };
        } catch (err) {
          emit({
            id,
            tool: 'search_memory',
            query,
            scope: memScope,
            status: 'error',
            facts: [(err as Error).message],
          });
          return { facts: [], count: 0, error: (err as Error).message };
        }
      },
    }),

    look_up_entity: tool({
      description:
        'Look up a named character, place, object or organization and retrieve the facts surrounding it.',
      inputSchema: z.object({
        name: z.string().describe('Entity name as it appears in the story'),
      }),
      execute: async ({ name }) => {
        const id = `r-${++stepN}`;
        emit({ id, tool: 'look_up_entity', query: name, status: 'searching' });
        const groupIds = [world, own, ...ancestors];
        try {
          const nodes = await memory.searchNodes(name, groupIds, 5);
          const center = nodes[0]?.uuid;
          const hits = await memory.search(name, groupIds, depth, center);
          const kept = filterHits(hits);
          const facts = [
            ...nodes.map((n) => `${n.name}: ${n.summary ?? ''}`.trim()),
            ...kept.map((h) => h.fact),
          ].filter(Boolean);
          emit({
            id,
            tool: 'look_up_entity',
            query: name,
            status: facts.length ? 'found' : 'empty',
            facts,
          });
          return { name, facts, count: facts.length };
        } catch (err) {
          emit({
            id,
            tool: 'look_up_entity',
            query: name,
            status: 'error',
            facts: [(err as Error).message],
          });
          return { facts: [], count: 0, error: (err as Error).message };
        }
      },
    }),
  };
}
