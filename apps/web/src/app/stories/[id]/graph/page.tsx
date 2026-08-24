'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft } from 'lucide-react';
import type { MemoryGraph, MemoryEntity, Branch } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const TYPE_COLORS: Record<string, string> = {
  character: '#8b5cf6',
  location: '#22d3ee',
  organization: '#facc15',
  object: '#f472b6',
  other: '#64748b',
};

export default function GraphPage({ params }: { params: { id: string } }) {
  const storyId = params.id;
  const { t } = useApp();
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    api.listBranches(storyId).then(setBranches);
  }, [storyId]);

  const load = async (branchId: string | null, silent = false) => {
    const g = await api.getGraph(storyId, branchId);
    setGraph(g);
    if (!silent) setDetail(null);
  };

  useEffect(() => {
    load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  async function onBranchChange(v: string) {
    setBranchFilter(v);
    load(v === 'all' ? null : v, false);
  }

  async function onNodeClick(entity: MemoryEntity) {
    const d = await api.retrieveEntity(storyId, entity.name, branchFilter).catch(() => null);
    setDetail(d);
  }

  const { nodes, edges } = useMemo(() => {
    const nodes: RFNode[] = (graph?.entities ?? []).map((e) => ({
      id: e.id,
      position: posFrom(e.name),
      data: { label: e.name, type: e.type },
      style: {
        border: `1px solid ${TYPE_COLORS[e.type] ?? TYPE_COLORS.other}`,
        borderRadius: 8,
        background: 'hsl(var(--card))',
        color: 'hsl(var(--foreground))',
        fontSize: 12,
        padding: '4px 8px',
      },
    }));
    const edges: RFEdge[] = (graph?.relationships ?? []).map((r, i) => ({
      id: r.id,
      source: `e:${r.source}`,
      target: `e:${r.target}`,
      label: r.type,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'hsl(var(--border))' },
      labelStyle: { fontSize: 10, fill: 'hsl(var(--muted-foreground))' },
    }));
    return { nodes, edges };
  }, [graph]);

  return (
    <div className="flex h-full flex-col">
      <SiteHeader story={{ title: 'Memory Graph' }} />
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <Link href={`/stories/${storyId}`}>
          <Button size="sm" variant="ghost">
            <ArrowLeft className="h-4 w-4" /> {t('graph.back')}
          </Button>
        </Link>
        <span className="text-sm font-medium">{t('graph.title')}</span>
        <span className="text-xs text-muted-foreground">{t('graph.subtitle')}</span>
        <select
          className="ms-auto h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={branchFilter}
          onChange={(e) => onBranchChange(e.target.value)}
        >
          <option value="all">{t('graph.all')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid flex-1 grid-cols-1 md:grid-cols-[1fr_320px]">
        <div className="relative h-[70vh] md:h-auto">
          {(graph?.entities?.length ?? 0) === 0 && !detail ? (
            <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
              <p className="rounded-lg border bg-card/90 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                {t('graph.emptyTitle')}
              </p>
            </div>
          ) : null}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            nodesConnectable={false}
            onNodeClick={(_, n) => {
              const entity = graph?.entities.find((e) => e.id === n.id);
              if (entity) onNodeClick(entity);
            }}
          >
            <Background gap={16} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => TYPE_COLORS[(n.data as any)?.type] ?? TYPE_COLORS.other}
              nodeStrokeWidth={2}
            />
          </ReactFlow>
        </div>

        <aside className="overflow-y-auto border-s p-4">
          {detail ? (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Badge style={{ backgroundColor: TYPE_COLORS[detail.entity?.type] ?? TYPE_COLORS.other }}>
                  {detail.entity?.type}
                </Badge>
                <h3 className="font-serif text-lg font-semibold">{detail.entity?.name}</h3>
              </div>

              {detail.relationships?.length ? (
                <div className="mb-4">
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('graph.relationships')}</h4>
                  <ul className="space-y-1.5 text-sm">
                    {detail.relationships.map((r: any, i: number) => (
                      <li key={i}>
                        <span className="text-muted-foreground">{r.source}</span>{' '}
                        <span className="text-primary">—{r.type}→</span>{' '}
                        <span className="text-muted-foreground">{r.target}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {detail.episodes?.length ? (
                <div>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('graph.episodes')}</h4>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    {detail.episodes.map((e: any, i: number) => (
                      <li key={i}>
                        {e.summary}
                        {e.branchId ? <span className="text-xs"> (branch)</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('graph.empty')}</p>
          )}
        </aside>
      </div>
    </div>
  );
}

// Deterministic pseudo-position from name so layout is stable.
function posFrom(name: string): { x: number; y: number } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const angle = (h % 360) * (Math.PI / 180);
  const radius = 60 + (h % 160);
  return { x: Math.cos(angle) * radius + 300, y: Math.sin(angle) * radius + 200 };
}
