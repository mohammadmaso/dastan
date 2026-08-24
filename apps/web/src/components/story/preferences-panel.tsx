'use client';

import { useEffect, useState } from 'react';
import type { StoryPreferences } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { emptyPreferences, PreferenceForm, PREF_STEPS } from './preference-form';

interface Props {
  storyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PreferencesSheet({ storyId, open, onOpenChange }: Props) {
  const { t } = useApp();
  const [prefs, setPrefs] = useState<StoryPreferences>(emptyPreferences());
  const [step, setStep] = useState(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    api
      .getPreferences(storyId)
      .then((p) => {
        setPrefs({ ...emptyPreferences(), ...p.preferences });
        setVersion(p.version);
      })
      .catch(() => undefined);
  }, [open, storyId]);

  const set = (patch: Partial<StoryPreferences>) => setPrefs((prev) => ({ ...prev, ...patch }));

  async function save() {
    setSaving(true);
    try {
      const saved = await api.savePreferences(storyId, prefs, note || undefined);
      setVersion(saved.version);
      setNote('');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {t('prefs.title')}
            {version != null ? ` · ${t('prefs.version', { version })}` : ''}
          </SheetTitle>
        </SheetHeader>
        <p className="mb-3 text-xs text-muted-foreground">{t('prefs.future')}</p>
        <Progress value={((step + 1) / PREF_STEPS.length) * 100} className="mb-4" />
        <PreferenceForm prefs={prefs} set={set} step={step} />
        <div className="mt-4 space-y-2">
          <Label>{t('prefs.noteLabel')}</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('prefs.notePh')} />
        </div>
        <div className="mt-6 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            {t('new.back')}
          </Button>
          {step < PREF_STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)}>{t('new.next')}</Button>
          ) : (
            <Button onClick={save} disabled={saving}>
              {saving ? t('prefs.saved') : t('prefs.save')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
