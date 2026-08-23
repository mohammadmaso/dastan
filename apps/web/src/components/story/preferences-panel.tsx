'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Save, X } from 'lucide-react';
import type { StoryPreferences, StoryPreferenceVersion } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function PreferencesPanel({ storyId, onClose }: { storyId: string; onClose: () => void }) {
  const { t } = useApp();
  const dialogs = useDialogs();
  const [version, setVersion] = useState<StoryPreferenceVersion | null>(null);
  const [editing, setEditing] = useState(false);
  const [json, setJson] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getPreferences(storyId).then(setVersion).catch(() => setVersion(null));
  }, [storyId]);

  function startEdit() {
    if (!version) return;
    setJson(JSON.stringify(version.preferences, null, 2));
    setEditing(true);
  }

  async function save() {
    try {
      const prefs = JSON.parse(json) as StoryPreferences;
      setSaving(true);
      const next = await api.savePreferences(storyId, prefs, note || undefined);
      setVersion(next);
      setEditing(false);
      setNote('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      dialogs.notify({ message: t('prefs.invalid', { msg: (e as Error).message }) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h3 className="text-sm font-medium">{t('prefs.title')}</h3>
        <div className="flex items-center gap-1">
          {saved && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="h-3 w-3" /> {t('prefs.saved')}
            </span>
          )}
          {version ? <span className="text-xs text-muted-foreground">{t('prefs.version', { version: version.version })}</span> : null}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 text-sm">
        {!version && !editing ? (
          <p className="text-muted-foreground">{t('prefs.empty')}</p>
        ) : editing ? (
          <div className="space-y-3">
            <div>
              <Label className="mb-1 block">{t('prefs.json')}</Label>
              <Textarea value={json} onChange={(e) => setJson(e.target.value)} className="min-h-[300px] font-mono text-xs" />
            </div>
            <div>
              <Label className="mb-1 block">{t('prefs.noteLabel')}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('prefs.notePh')} />
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('prefs.save')}
            </Button>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-muted-foreground">{t('prefs.future')}</span>
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pencil className="h-3.5 w-3.5" /> {t('prefs.edit')}
              </Button>
            </div>
            <PreferencesSummary prefs={version!.preferences} />
          </div>
        )}
      </div>
    </div>
  );
}

function PreferencesSummary({ prefs }: { prefs: StoryPreferences }) {
  const { t } = useApp();
  const labels: Record<string, string> = {
    title: t('q.title'),
    genre: t('q.genre'),
    premise: t('q.premise'),
    centralConflict: t('q.conflict'),
    tones: t('q.tones'),
    pacing: t('q.pacing'),
    perspective: t('q.perspective'),
    tense: t('q.tense'),
    narrativeVoice: t('q.voice'),
    plotStructures: t('q.plotStructures'),
    setting: 'Setting',
    magicSystem: 'Magic system',
    instructionAdherence: t('q.adherence'),
    experimentalLevel: t('q.experimental'),
  };
  const rows: Array<[string, string]> = [];
  const add = (key: keyof StoryPreferences, label?: string) => {
    const v = prefs[key];
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
      rows.push([label ?? labels[key] ?? key, Array.isArray(v) ? v.join(', ') : String(v)]);
  };
  add('title');
  add('genre');
  add('premise');
  add('centralConflict');
  add('tones');
  add('pacing');
  add('perspective');
  add('tense');
  add('narrativeVoice');
  add('plotStructures');
  add('setting');
  add('instructionAdherence');
  add('experimentalLevel');

  return (
    <dl className="space-y-1.5">
      {rows.map(([k, v]) => (
        <div key={k} className="text-sm">
          <dt className="inline font-medium text-muted-foreground">{k}: </dt>
          <dd className="inline">{v}</dd>
        </div>
      ))}
      {prefs.characters?.length ? (
        <div className="pt-2">
          <dt className="text-xs font-medium text-muted-foreground">{t('q.characters')}</dt>
          {prefs.characters.map((c, i) => (
            <dd key={i} className="text-sm">
              {c.name} ({c.role}){c.personality ? ` — ${c.personality}` : ''}
            </dd>
          ))}
        </div>
      ) : null}
    </dl>
  );
}
