import type { StoryNode } from '@storywriter/types';

/** Walk parentNodeId from a tip back to the root (oldest first). */
export function walkPath(nodes: StoryNode[], tip: StoryNode | null): StoryNode[] {
  if (!tip) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: StoryNode[] = [];
  const seen = new Set<string>();
  let cursor: StoryNode | undefined = tip;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentNodeId ? byId.get(cursor.parentNodeId) : undefined;
  }
  return chain;
}

export function tipOfBranch(nodes: StoryNode[], branchId: string): StoryNode | null {
  const of = nodes.filter((n) => n.branchId === branchId);
  return of.find((n) => n.isCurrent) ?? of.sort((a, b) => a.position - b.position).at(-1) ?? null;
}

export function childrenOf(nodes: StoryNode[], parentId: string): StoryNode[] {
  return nodes
    .filter((n) => n.parentNodeId === parentId)
    .sort((a, b) => a.siblingIndex - b.siblingIndex || a.createdAt.localeCompare(b.createdAt));
}

const COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#fb923c', '#60a5fa'];
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
