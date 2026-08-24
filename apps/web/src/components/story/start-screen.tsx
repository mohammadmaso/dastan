'use client';

import { useEffect, useState } from 'react';
import { Sparkles, PenLine, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  storyId: string;
  busy: boolean;
  onGenerate: () => void;
  onSaveOwn: (text: string) => void;
}

export function StartScreen({ storyId, busy, onGenerate, onSaveOwn }: Props) {
  const { t } = useApp();
  const [premise, setPremise] = useState('');
  const [writing, setWriting] = useState(false);
  const [own, setOwn] = useState('');

  useEffect(() => {
    api.getPreferences(storyId).then((p) => setPremise(p?.preferences.premise ?? '')).catch(() => undefined);
  }, [storyId]);

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="font-serif text-2xl font-semibold">{t('start.title')}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{t('start.sub')}</p>

        {premise ? (
          <p className="mx-auto mt-4 max-w-sm rounded-lg border bg-card p-3 font-serif text-sm italic text-foreground/80">
            “{premise}”
          </p>
        ) : null}

        {!writing ? (
          <div className="mt-6 flex flex-col items-center gap-2">
            <Button size="lg" onClick={onGenerate} disabled={busy} className="w-full sm:w-auto">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t('start.generate')}
            </Button>
            <Button variant="ghost" onClick={() => setWriting(true)} disabled={busy}>
              <PenLine className="h-4 w-4" /> {t('start.write')}
            </Button>
          </div>
        ) : (
          <div className="mx-auto mt-6 max-w-sm space-y-2 text-start">
            <Textarea
              autoFocus
              dir="auto"
              className="min-h-[120px] font-serif text-base leading-6"
              placeholder={t('start.placeholder')}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setWriting(false)}>
                {t('new.back')}
              </Button>
              <Button
                size="sm"
                disabled={!own.trim() || busy}
                onClick={() => {
                  onSaveOwn(own.trim());
                  setWriting(false);
                }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                {t('start.generate')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
