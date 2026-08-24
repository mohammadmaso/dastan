/** Graphiti group_id helpers. One namespace per world + one per branch. */

export function worldGroup(storyId: string): string {
  return `story_${storyId}_world`;
}

export function branchGroup(storyId: string, branchId: string): string {
  return `story_${storyId}_branch_${branchId}`;
}

export interface MemoryFact {
  uuid?: string;
  fact: string;
  groupId: string | null;
  episodeUuids: string[];
  score?: number | null;
  sourceNodeUuid?: string | null;
}

export interface FilterCtx {
  worldGroup: string;
  branchGroup: string;
  ancestorGroups: string[];
  /** Episode uuids belonging to nodes on the current path (root → fork point). */
  allowedEpisodeUuids: Set<string>;
}

/**
 * Keep a retrieved fact iff it belongs to this branch, the shared world, or an
 * ancestor branch *and* its source episodes sit on the allowed path.
 *
 * ponytail: we search ancestor group_ids and drop post-fork facts here instead
 * of re-ingesting the lineage into the new branch on every fork. Upgrade path:
 * copy-on-fork re-ingest of episodes up to fork_node_id into the child group.
 */
export function keepFact(fact: MemoryFact, ctx: FilterCtx): boolean {
  const gid = fact.groupId ?? '';
  if (gid === ctx.worldGroup) return true;
  if (gid === ctx.branchGroup) return true;
  if (!ctx.ancestorGroups.includes(gid)) return false;
  if (fact.episodeUuids.length === 0) return false;
  return fact.episodeUuids.some((id) => ctx.allowedEpisodeUuids.has(id));
}
