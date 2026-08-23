'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, Waypoints, PenLine } from 'lucide-react';
import type { ContinuationOption } from '@storywriter/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useApp } from '@/lib/app-state';
import { cn } from '@/lib/utils';

interface Props {
  options: ContinuationOption[];
  onChoose: (option: ContinuationOption) => void;
  onMore: () => void;
  onCustom: (text: string) => void;
  onBranchFromOption: (option: ContinuationOption) => void;
  busy: boolean;
}

export function Continuations({ options, onChoose, onMore, onCustom, onBranchFromOption, busy }: Props) {
  const { t } = useApp();
  const [custom, setCustom] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);

  async function handleMore() {
    setLoadingMore(true);
    try {
      await onMore();
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium">{t('cont.title')}</h3>
        <Button size="sm" variant="ghost" onClick={handleMore} disabled={loadingMore || busy}>
          {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('cont.more')}
        </Button>
      </div>

      {options.length === 0 && !busy ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t('cont.empty')}</p>
      ) : null}

      <div className="space-y-2 p-3">
        {options.map((opt, i) => (
          <div
            key={opt.id}
            className="flex flex-col gap-2 rounded-md border p-3 transition-colors hover:border-primary/50 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <div className="font-serif font-medium leading-snug">
                <span className="me-1.5 text-xs text-muted-foreground">{i + 1}.</span>
                {opt.label}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{opt.summary}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button size="sm" className={cn('flex-1 sm:flex-none')} onClick={() => onChoose(opt)} disabled={busy}>
                {t('cont.continue')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => onBranchFromOption(opt)} disabled={busy}>
                <Waypoints className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PenLine className="h-3.5 w-3.5" /> {t('cont.custom')}
        </div>
        <div className="flex gap-2">
          <Textarea
            className="min-h-[56px] flex-1"
            placeholder={t('cont.placeholder')}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <Button
            variant="secondary"
            disabled={!custom.trim() || busy}
            onClick={() => {
              onCustom(custom.trim());
              setCustom('');
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('cont.continue')}
          </Button>
        </div>
      </div>
    </div>
  );
}
