'use client';

import { useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StoryNode } from '@storywriter/types';
import { colorFor } from '@/lib/story-path';

interface Props {
  nodes: StoryNode[];
  selectedNodeId: string | null;
  onSelect: (node: StoryNode) => void;
}

export function StoryCanvas({ nodes, selectedNodeId, onSelect }: Props) {
  const { rfNodes, rfEdges } = useMemo(() => layout(nodes, selectedNodeId), [nodes, selectedNodeId]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        fitView
        nodesConnectable={false}
        nodesDraggable={false}
        onNodeClick={(_, n) => {
          const sn = byId.get(n.id);
          if (sn) onSelect(sn);
        }}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}

function layout(nodes: StoryNode[], selectedId: string | null) {
  const children = new Map<string, StoryNode[]>();
  const roots: StoryNode[] = [];
  for (const n of nodes) {
    if (!n.parentNodeId) roots.push(n);
    else {
      const list = children.get(n.parentNodeId) ?? [];
      list.push(n);
      children.set(n.parentNodeId, list);
    }
  }
  for (const list of children.values()) list.sort((a, b) => a.siblingIndex - b.siblingIndex);

  const pos = new Map<string, { x: number; y: number }>();
  let col = 0;
  function place(n: StoryNode, depth: number) {
    const kids = children.get(n.id) ?? [];
    if (!kids.length) {
      pos.set(n.id, { x: col * 220, y: depth * 90 });
      col += 1;
      return;
    }
    const start = col;
    for (const k of kids) place(k, depth + 1);
    const end = col - 1;
    pos.set(n.id, { x: ((start + end) / 2) * 220, y: depth * 90 });
  }
  for (const r of roots) place(r, 0);

  const rfNodes: RFNode[] = nodes.map((n) => ({
    id: n.id,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { label: (n.continuationLabel || n.content.replace(/\s+/g, ' ').slice(0, 40) || '·') },
    style: {
      border: `1px solid ${n.id === selectedId ? 'hsl(var(--primary))' : colorFor(n.branchId)}`,
      borderRadius: 8,
      background: 'hsl(var(--card))',
      fontSize: 11,
      padding: '4px 8px',
      width: 180,
    },
  }));
  const rfEdges: RFEdge[] = nodes
    .filter((n) => n.parentNodeId)
    .map((n) => ({
      id: `${n.parentNodeId}-${n.id}`,
      source: n.parentNodeId!,
      target: n.id,
    }));
  return { rfNodes, rfEdges };
}
