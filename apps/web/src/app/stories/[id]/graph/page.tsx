'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { MemoryGraph, MemoryEntity, Branch } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { SiteHeader } from '@/components/site-header';
import { MemoryGraphView } from '@/components/story/memory-graph';
import { Button } from '@/components/ui/button';

export default function GraphPage({ params }: { params: { id: string } }) {
  const storyId = params.id;
  const { t } = useApp();
  const [graph, setGraph] = useState<MemoryGraph | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [detail, setDetail] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listBranches(storyId).then(setBranches).catch(() => undefined);
  }, [storyId]);

  const load = async (branchId: string | null, silent = false) => {
    try {
      setError(null);
      const g = await api.getGraph(storyId, branchId);
      setGraph(g);
      if (!silent) {
        setDetail(null);
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
    }
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
    setSelectedId(entity.id);
    const d = await api.retrieveEntity(storyId, entity.name, branchFilter).catch(() => null);
    setDetail(d);
  }

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
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
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
          <MemoryGraphView graph={graph} selectedId={selectedId} onSelect={onNodeClick} />
        </div>

        <aside className="overflow-y-auto border-s p-4">
          {detail ? (
            <div>
              <h3 className="mb-1 font-serif text-lg font-semibold">{detail.entity?.name}</h3>
              {detail.entity?.summary ? (
                <p className="mb-4 whitespace-pre-line text-sm text-muted-foreground">
                  {detail.entity.summary}
                </p>
              ) : null}

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
