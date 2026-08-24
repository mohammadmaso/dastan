'use client';

import { useRef, useState } from 'react';
import { GitFork, Loader2, PenLine, RefreshCw, Sparkles } from 'lucide-react';
import type { ContinuationOption } from '@storywriter/types';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  options: ContinuationOption[];
  busy: boolean;
  onChoose: (option: ContinuationOption) => void;
  onBranch: (option: ContinuationOption) => void;
  onCustom: (text: string) => void;
  onMore: () => void | Promise<void>;
  onGenerate?: () => void;
  emptyStory?: boolean;
}

export function WriteHead({
  options,
  busy,
  onChoose,
  onBranch,
  onCustom,
  onMore,
  onGenerate,
  emptyStory,
}: Props) {
  const { t } = useApp();
  const [own, setOwn] = useState('');
  const [showOwn, setShowOwn] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const moreLock = useRef(false);
  const locked = busy || moreBusy;

  async function handleMore() {
    if (locked || moreLock.current) return;
    moreLock.current = true;
    setMoreBusy(true);
    try {
      await onMore();
    } finally {
      moreLock.current = false;
      setMoreBusy(false);
    }
  }

  if (emptyStory && !busy) {
    return (
      <div className="mx-auto max-w-[42rem] px-6 pb-16 text-center">
        <p className="mb-4 text-sm text-muted-foreground">{t('start.sub')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onGenerate} disabled={busy}>
            <Sparkles className="h-4 w-4" /> {t('start.generate')}
          </Button>
          <Button variant="outline" onClick={() => setShowOwn(true)}>
            <PenLine className="h-4 w-4" /> {t('start.write')}
          </Button>
        </div>
        {showOwn ? (
          <div className="mt-4 space-y-2 text-start">
            <Textarea
              dir="auto"
              className="min-h-[120px] font-serif"
              placeholder={t('start.placeholder')}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
            />
            <div className="flex justify-end">
              <Button disabled={!own.trim()} onClick={() => { onCustom(own.trim()); setOwn(''); }}>
                {t('cont.continue')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[42rem] space-y-3 px-6 pb-16">
      <div className="flex items-center justify-between">
        <h3 className="font-serif text-sm font-semibold">{t('cont.title')}</h3>
        <Button size="sm" variant="ghost" onClick={handleMore} disabled={locked}>
          {locked ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {t('cont.more')}
        </Button>
      </div>
      <div className="grid gap-2">
        {options.map((opt, i) => (
          <Card key={opt.id} className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-start gap-3 p-3">
              <span className="mt-0.5 font-serif text-lg text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="font-medium" dir="auto">
                  {opt.label}
                </p>
                <p className="text-sm text-muted-foreground" dir="auto">
                  {opt.summary}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => onChoose(opt)} disabled={locked}>
                    {t('cont.continue')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onBranch(opt)} disabled={locked}>
                    <GitFork className="h-3.5 w-3.5" /> {t('cont.branch')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {options.length === 0 && !locked ? (
          <p className="text-sm text-muted-foreground">{t('cont.empty')}</p>
        ) : null}
      </div>
      <div className="space-y-2">
        <Textarea
          dir="auto"
          placeholder={t('cont.placeholder')}
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          className="min-h-[80px] font-serif"
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={!own.trim() || locked} onClick={() => { onCustom(own.trim()); setOwn(''); }}>
            <PenLine className="h-3.5 w-3.5" /> {t('cont.custom')}
          </Button>
        </div>
      </div>
    </div>
  );
}
