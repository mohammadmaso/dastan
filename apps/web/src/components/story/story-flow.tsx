'use client';

import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type NodeProps,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Bot, User, BookMarked, Sparkles, PenLine, Loader2 } from 'lucide-react';
import type { StoryNode } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { cn } from '@/lib/utils';

const NODE_W = 240;
const H_GAP = 290;
const V_GAP = 150;

interface Props {
  nodes: StoryNode[];
  branchNames: Record<string, string>;
  currentBranchId: string | null;
  openNodeId: string | null;
  onNodeClick: (node: StoryNode) => void;
  streaming: boolean;
  streamText: string;
  generatingParentId: string | null;
}

interface Pos {
  x: number;
  y: number;
}

/** Top-down tidy tree layout from the parentNodeId hierarchy. */
function treeLayout(nodes: StoryNode[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, StoryNode[]>();
  const roots: StoryNode[] = [];

  for (const n of nodes) {
    if (n.parentNodeId && byId.has(n.parentNodeId)) {
      const list = children.get(n.parentNodeId) ?? [];
      list.push(n);
      children.set(n.parentNodeId, list);
    } else {
      roots.push(n);
    }
  }

  // Order children so the same-branch continuation keeps the spine, and
  // offshoot branches fan out to the right.
  for (const list of children.values()) {
    list.sort((a, b) =>
      a.branchId === b.branchId ? a.position - b.position : a.branchId < b.branchId ? -1 : 1,
    );
  }

  const pos = new Map<string, Pos>();
  let leaf = 0;

  function place(node: StoryNode, depth: number) {
    const kids = children.get(node.id) ?? [];
    if (kids.length === 0) {
      pos.set(node.id, { x: leaf * H_GAP, y: depth * V_GAP });
      leaf++;
      return;
    }
    for (const k of kids) place(k, depth + 1);
    const xs = kids.map((k) => pos.get(k.id)!.x);
    pos.set(node.id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth * V_GAP });
  }

  roots.sort((a, b) => a.position - b.position || (a.branchId < b.branchId ? -1 : 1));
  for (const r of roots) place(r, 0);

  return pos;
}

const COLORS = ['#8b5cf6', '#22d3ee', '#f472b6', '#f59e0b', '#34d399', '#fb923c', '#60a5fa'];
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

function preview(node: StoryNode): string {
  const text = node.content.replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.slice(0, 120) + '…' : text || '(empty)';
}

interface StoryNodeData {
  node: StoryNode;
  branchName: string;
  isOpen: boolean;
}

function metaLabel(node: StoryNode, t: (k: string) => string): string {
  if (node.nodeType === 'ROOT') return t('flow.root');
  if (node.chapterTitle) return t('ne.chapter');
  if (node.author === 'user') return t('ne.authorUser');
  if (node.author === 'ai') return t('ne.authorAi');
  return t('ne.branch');
}

function StoryFlowNodeCard({ data }: NodeProps) {
  const { t } = useApp();
  const { node, branchName, isOpen } = data as unknown as StoryNodeData;
  const color = colorFor(node.branchId);
  const isStart = node.nodeType === 'ROOT';
  const isUser = node.author === 'user' || node.nodeType === 'USER_WRITTEN';

  const label = node.chapterTitle ?? node.continuationLabel ?? (isStart ? t('flow.root') : branchName);

  return (
    <div
      className={cn(
        'relative w-[240px] cursor-pointer select-none rounded-2xl border bg-card/95 px-3.5 py-3 text-card-foreground shadow-sm backdrop-blur transition-all duration-150',
        isOpen
          ? 'border-primary shadow-lg ring-2 ring-primary/25'
          : 'border-border shadow-sm hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md',
        node.isCurrent && 'border-primary/50',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !min-w-0 !border-0"
        style={{ background: color }}
      />

      {/* branch color strip */}
      <span
        className="absolute inset-y-2.5 start-0 w-1 rounded-full opacity-80"
        style={{ background: color }}
      />

      <div className="flex items-center gap-2.5 ps-1.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm shadow-sm"
          style={{ backgroundColor: `${color}22`, color }}
        >
          {isStart ? <Sparkles className="h-4 w-4" /> : isUser ? <PenLine className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold leading-tight">
            {node.chapterTitle ? <BookMarked className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{label}</span>
          </p>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {metaLabel(node, t)}
          </p>
        </div>
        {node.isCurrent && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-foreground">
            {t('ne.current')}
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-3 ps-1.5 font-serif text-xs leading-relaxed text-foreground/85">
        {preview(node)}
      </p>

      <div className="mt-2 flex items-center gap-1 ps-1.5 text-[10px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{branchName}</span>
        <span className="ms-auto shrink-0">#{node.position + 1}</span>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !min-w-0 !border-0"
        style={{ background: color }}
      />
    </div>
  );
}

function GeneratingNode({ data }: NodeProps) {
  const { t } = useApp();
  const { text } = data as { text: string };
  return (
    <div className="w-[240px] rounded-2xl border border-dashed border-primary/60 bg-card/70 px-3.5 py-3 text-card-foreground shadow-sm backdrop-blur">
      <div className="flex items-center gap-2.5 ps-0">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
        <p className="truncate text-[13px] font-semibold text-primary">{t('flow.live')}</p>
      </div>
      <p className="mt-2 line-clamp-3 font-serif text-xs leading-relaxed text-muted-foreground">
        {text || '…'}
      </p>
    </div>
  );
}

const nodeTypes = {
  story: StoryFlowNodeCard,
  generating: GeneratingNode,
};

export function StoryFlow({
  nodes,
  branchNames,
  currentBranchId,
  openNodeId,
  onNodeClick,
  streaming,
  streamText,
  generatingParentId,
}: Props) {
  const { t } = useApp();
  const layout = useMemo(() => treeLayout(nodes), [nodes]);

  const rfNodes = useMemo<RFNode[]>(() => {
    const list: RFNode[] = nodes.map((n) => {
      const p = layout.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        position: p,
        type: 'story',
        data: { node: n, branchName: branchNames[n.branchId] ?? '', isOpen: n.id === openNodeId },
      };
    });

    if (streaming && generatingParentId) {
      const pp = layout.get(generatingParentId) ?? { x: 0, y: 0 };
      list.push({
        id: '__generating__',
        type: 'generating',
        position: { x: pp.x, y: pp.y + V_GAP },
        data: { text: streamText },
        selectable: false,
        focusable: false,
        draggable: false,
      });
    }
    return list;
  }, [nodes, layout, branchNames, openNodeId, streaming, generatingParentId, streamText]);

  const rfEdges = useMemo<RFEdge[]>(() => {
    const edges: RFEdge[] = nodes
      .filter((n) => n.parentNodeId && layout.has(n.parentNodeId))
      .map((n) => {
        const source = nodes.find((nn) => nn.id === n.parentNodeId);
        const color = colorFor(source?.branchId ?? n.branchId);
        return {
          id: `e-${n.parentNodeId}-${n.id}`,
          source: n.parentNodeId!,
          target: n.id,
          type: 'smoothstep',
          animated: n.isCurrent,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          style: { stroke: color, strokeWidth: 1.6, opacity: 0.75 },
        };
      });

    if (streaming && generatingParentId) {
      const color = colorFor(
        nodes.find((n) => n.id === generatingParentId)?.branchId ?? 'generating',
      );
      edges.push({
        id: 'e-generating',
        source: generatingParentId,
        target: '__generating__',
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
        style: { stroke: color, strokeWidth: 1.8, strokeDasharray: '5 5', opacity: 0.9 },
      });
    }
    return edges;
  }, [nodes, layout, streaming, generatingParentId]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.25, minZoom: 0.2 }}
        nodesConnectable={false}
        nodesDraggable
        elementsSelectable
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, rn) => {
          if (rn.id === '__generating__') return;
          const n = nodes.find((nn) => nn.id === rn.id);
          if (n) onNodeClick(n);
        }}
      >
        <Background gap={26} size={1} color="hsl(var(--border))" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => colorFor((n.data as unknown as StoryNodeData | undefined)?.node?.branchId ?? '')}
          nodeStrokeWidth={2}
          maskColor="hsl(var(--background)/0.6)"
        />
      </ReactFlow>
      {currentBranchId ? (
        <div className="pointer-events-none absolute bottom-3 start-1/2 z-10 -translate-x-1/2 rtl:translate-x-1/2 rounded-full border bg-card/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
          {t('ws.treeCaption')}
        </div>
      ) : null}
    </div>
  );
}
