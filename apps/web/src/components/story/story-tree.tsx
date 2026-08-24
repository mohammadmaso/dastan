'use client';

import { useMemo, useState } from 'react';
import { Bot, User, GitFork, ChevronDown, ChevronRight } from 'lucide-react';
import type { StoryNode } from '@storywriter/types';
import { cn } from '@/lib/utils';

interface Props {
  nodes: StoryNode[];
  activeBranchId: string;
  selectedNodeId: string | null;
  onSelect: (node: StoryNode) => void;
}

function previewText(node: StoryNode): string {
  const t = node.content.replace(/\s+/g, ' ').trim();
  return t.length > 80 ? t.slice(0, 80) + '…' : t || '(empty)';
}

export function StoryTree({ nodes, activeBranchId, selectedNodeId, onSelect }: Props) {
  const { childrenByParent, activeRoot } = useMemo(() => {
    const byParent = new Map<string, StoryNode[]>();
    for (const n of nodes) {
      const key = n.parentNodeId ?? '__root__';
      const list = byParent.get(key) ?? [];
      list.push(n);
      byParent.set(key, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position);

    const activeBranchNodes = nodes
      .filter((n) => n.branchId === activeBranchId)
      .sort((a, b) => a.position - b.position);
    const root = activeBranchNodes.find((n) => !n.parentNodeId) ?? activeBranchNodes[0] ?? null;
    return { childrenByParent: byParent, activeRoot: root };
  }, [nodes, activeBranchId]);

  if (!activeRoot) {
    return <p className="p-3 text-xs text-muted-foreground">No nodes yet.</p>;
  }

  return (
    <div className="overflow-y-auto px-3 py-3">
      <TreeNode
        node={activeRoot}
        childrenByParent={childrenByParent}
        activeBranchId={activeBranchId}
        selectedNodeId={selectedNodeId}
        onSelect={onSelect}
        depth={0}
        branchColor={colorFor(activeBranchId)}
        prevChapter={null}
      />
    </div>
  );
}

function TreeNode({
  node,
  childrenByParent,
  activeBranchId,
  selectedNodeId,
  onSelect,
  depth,
  branchColor,
  prevChapter,
}: {
  node: StoryNode;
  childrenByParent: Map<string, StoryNode[]>;
  activeBranchId: string;
  selectedNodeId: string | null;
  onSelect: (node: StoryNode) => void;
  depth: number;
  branchColor: string;
  prevChapter: string | null;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const children = childrenByParent.get(node.id) ?? [];
  const spine = children.find((c) => c.branchId === node.branchId);
  const offshoots = children.filter((c) => c.branchId !== node.branchId);

  const isSelected = selectedNodeId === node.id;
  const isActive = node.branchId === activeBranchId;
  const isChapterStart = node.chapterTitle && node.chapterTitle !== prevChapter;

  return (
    <div className="relative">
      {isChapterStart ? (
        <div className="my-2 flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          {node.chapterTitle}
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}

      {/* connector line to parent */}
      {depth > 0 && <div className="absolute -left-3 top-0 h-full w-px bg-border" />}

      <button
        onClick={() => onSelect(node)}
        className={cn(
          'group relative mb-1 flex w-full items-start gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors',
          isSelected ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40',
          !isActive && 'opacity-80',
        )}
      >
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: branchColor }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {node.author === 'ai' ? (
              <Bot className="h-3 w-3 text-muted-foreground" />
            ) : (
              <User className="h-3 w-3 text-muted-foreground" />
            )}
            <span dir="auto" className="truncate">
              {previewText(node)}
            </span>
          </span>
          {node.continuationLabel ? (
            <span dir="auto" className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {node.continuationLabel}
            </span>
          ) : null}
        </span>
        {isActive && node.isCurrent ? (
          <span className="mt-0.5 shrink-0 rounded-full bg-primary px-1.5 text-[9px] font-semibold text-primary-foreground">
            NOW
          </span>
        ) : null}
      </button>

      {offshoots.length > 0 && (
        <div className="mb-1 ml-1 rounded-md border border-dashed border-border p-1.5">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <GitFork className="h-3 w-3" />
            {offshoots.length} alternative {offshoots.length === 1 ? 'branch' : 'branches'}
          </button>
          {!collapsed && (
            <div className="flex flex-wrap gap-2 border-t border-dashed pt-1.5">
              {offshoots.map((o) => (
                <div key={o.id} className="w-48">
                  <TreeNode
                    node={o}
                    childrenByParent={childrenByParent}
                    activeBranchId={activeBranchId}
                    selectedNodeId={selectedNodeId}
                    onSelect={onSelect}
                    depth={depth + 1}
                    branchColor={colorFor(o.branchId)}
                    prevChapter={node.chapterTitle}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {spine && (
        <div className="ml-[5px] border-l pl-3">
          <TreeNode
            node={spine}
            childrenByParent={childrenByParent}
            activeBranchId={activeBranchId}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            depth={0}
            branchColor={branchColor}
            prevChapter={node.chapterTitle ?? prevChapter}
          />
        </div>
      )}
    </div>
  );
}

const COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#facc15', '#34d399', '#fb923c', '#60a5fa'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
