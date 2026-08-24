'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type { StoryPreferences } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { emptyPreferences, PreferenceForm, PREF_STEPS } from '@/components/story/preference-form';
import { cn } from '@/lib/utils';

const DRAFT_KEY = 'sw-draft-prefs';

export default function NewStoryPage() {
  const router = useRouter();
  const { t, dir } = useApp();
  const dialogs = useDialogs();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<StoryPreferences>(emptyPreferences());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { step?: number; prefs?: StoryPreferences };
        if (parsed.prefs) setPrefs({ ...emptyPreferences(), ...parsed.prefs });
        if (typeof parsed.step === 'number') setStep(parsed.step);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, prefs }));
    } catch {
      /* ignore */
    }
  }, [step, prefs]);

  const set = (patch: Partial<StoryPreferences>) => setPrefs((prev) => ({ ...prev, ...patch }));
  const isLast = step === PREF_STEPS.length - 1;

  async function handleCreate() {
    setSaving(true);
    try {
      const story = await api.createStory({
        title: prefs.title?.trim() || t('new.untitled'),
        description: prefs.premise,
        genre: prefs.genre,
        preferences: { preferences: prefs },
      });
      localStorage.removeItem(DRAFT_KEY);
      router.push(`/stories/${story.id}`);
    } catch (err) {
      dialogs.notify({ message: (err as Error).message });
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SiteHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          <div className="mb-6 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="font-serif text-xl font-semibold">{t('new.intro.title')}</h1>
          </div>
          <p className="mb-6 text-sm text-muted-foreground">{t('new.intro.sub1')}</p>
          <Progress value={((step + 1) / PREF_STEPS.length) * 100} className="mb-2" />
          <div className="mb-6 flex items-center gap-2">
            {PREF_STEPS.map((s, i) => (
              <button
                key={s.titleKey}
                onClick={() => i <= step && setStep(i)}
                className={cn('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-secondary')}
                aria-label={t(s.titleKey)}
              />
            ))}
          </div>
          <div className="rounded-lg border p-5">
            <PreferenceForm prefs={prefs} set={set} step={step} />
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
              {dir === 'rtl' ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />} {t('new.back')}
            </Button>
            {isLast ? (
              <Button onClick={handleCreate} disabled={saving}>
                <Sparkles className="h-4 w-4" /> {saving ? t('new.creating') : t('new.create')}
              </Button>
            ) : (
              <Button onClick={() => setStep((s) => s + 1)}>
                {t('new.next')} {dir === 'rtl' ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
