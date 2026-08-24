'use client';

import { Loader2, Search, Brain, CheckCircle2, FileText, AlertTriangle } from 'lucide-react';
import type { ActivityEvent } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { cn } from '@/lib/utils';

interface Props {
  events: ActivityEvent[];
  streaming: boolean;
}

function iconFor(type: ActivityEvent['type']) {
  switch (type) {
    case 'searching_memory':
    case 'search_intent':
    case 'memory_found':
    case 'reviewing_recent':
      return <Search className="h-3 w-3" />;
    case 'node_saved':
      return <CheckCircle2 className="h-3 w-3" />;
    case 'error':
      return <AlertTriangle className="h-3 w-3" />;
    default:
      return <Brain className="h-3 w-3" />;
  }
}

export function ActivityPanel({ events, streaming }: Props) {
  const { t } = useApp();
  const visible = events.filter((e) => e.type !== 'generation_token');

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-2 text-sm font-medium">
        {streaming && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {t('act.title')}
        {streaming ? (
          <span className="ms-auto text-[11px] font-normal text-muted-foreground">{t('act.working')}</span>
        ) : null}
      </div>
      <div className="max-h-44 space-y-1 overflow-y-auto p-2">
        {visible.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">{t('act.empty')}</p>
        ) : (
          visible.map((e, i) => (
            <div
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1 text-xs',
                e.type === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <span className="mt-0.5 shrink-0">{iconFor(e.type)}</span>
              <span className="min-w-0">
                <span dir="auto">{e.message ?? e.type}</span>
                {e.query ? (
                  <span dir="auto" className="block text-[11px] italic">
                    “{e.query}”
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
