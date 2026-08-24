'use client';

import type { CharacterDefinition, StoryPreferences } from '@storywriter/types';
import type { Lang } from '@/lib/i18n';
import { useApp } from '@/lib/app-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type PrefSetter = (patch: Partial<StoryPreferences>) => void;
type T = (key: string, vars?: Record<string, string | number>) => string;

export function emptyPreferences(): StoryPreferences {
  return {
    tones: [],
    characters: [],
    plotStructures: [],
    includeTopics: [],
    avoidTopics: [],
    violenceLevel: 2,
    romanceLevel: 2,
    humorLevel: 2,
    horrorLevel: 1,
    experimentalLevel: 2,
    instructionAdherence: 'mostly',
  };
}

function LevelField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <div className="flex gap-1.5">
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={cn(
              'h-8 w-8 rounded-md border text-sm transition-colors',
              value === n ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent',
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipMulti({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(active ? value.filter((x) => x !== o) : [...value, o])}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                active ? 'border-primary bg-primary text-primary-foreground' : 'border-input hover:bg-accent',
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectField({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          …
        </option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function StepBasics(prefs: StoryPreferences, set: PrefSetter, t: T, lang: Lang) {
  const genres =
    lang === 'fa'
      ? ['فانتزی', 'علمی-تخیلی', 'معمایی', 'هیجانی', 'هراس', 'عاشقانه', 'ادبی', 'تاریخی', 'ماجراجویی', 'سایر']
      : ['Fantasy', 'Sci-Fi', 'Mystery', 'Thriller', 'Horror', 'Romance', 'Literary', 'Historical', 'Adventure', 'Other'];
  const lengths =
    lang === 'fa' ? ['داستان کوتاه', 'نوولا', 'رمان', 'داستان دنبالهدار'] : ['Short story', 'Novella', 'Novel', 'Serialized story'];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label className="mb-1.5 block">{t('q.title')}</Label>
        <Input value={prefs.title ?? ''} onChange={(e) => set({ title: e.target.value })} />
      </div>
      <SelectField label={t('q.genre')} options={genres} value={prefs.genre} onChange={(v) => set({ genre: v })} />
      <div>
        <Label className="mb-1.5 block">{t('q.subgenre')}</Label>
        <Input value={prefs.subgenre ?? ''} onChange={(e) => set({ subgenre: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label className="mb-1.5 block">{t('q.premise')}</Label>
        <Textarea value={prefs.premise ?? ''} onChange={(e) => set({ premise: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <Label className="mb-1.5 block">{t('q.conflict')}</Label>
        <Textarea value={prefs.centralConflict ?? ''} onChange={(e) => set({ centralConflict: e.target.value })} />
      </div>
      <div>
        <Label className="mb-1.5 block">{t('q.audience')}</Label>
        <Input value={prefs.intendedAudience ?? ''} onChange={(e) => set({ intendedAudience: e.target.value })} />
      </div>
      <SelectField label={t('q.length')} options={lengths} value={prefs.storyLength} onChange={(v) => set({ storyLength: v })} />
    </div>
  );
}

function StepTone(prefs: StoryPreferences, set: PrefSetter, t: T, lang: Lang) {
  const tones =
    lang === 'fa'
      ? ['تاریک', 'امیدوار', 'تراژیک', 'کمدی', 'عاشقانه', 'پرتعلیق', 'فلسفی', 'روانشناختی', 'حماسی', 'سوررئال', 'واقعگرایانه']
      : ['Dark', 'Hopeful', 'Tragic', 'Comedic', 'Romantic', 'Suspenseful', 'Philosophical', 'Psychological', 'Epic', 'Surreal', 'Realistic'];
  return (
    <div className="space-y-4">
      <ChipMulti label={t('q.tones')} options={tones} value={prefs.tones ?? []} onChange={(v) => set({ tones: v })} />
      <div>
        <Label className="mb-1.5 block">{t('q.customTone')}</Label>
        <Textarea value={prefs.customTone ?? ''} onChange={(e) => set({ customTone: e.target.value })} />
      </div>
    </div>
  );
}

function StepStyle(prefs: StoryPreferences, set: PrefSetter, t: T, lang: Lang) {
  const perspective = lang === 'fa' ? ['اول شخص', 'دوم شخص', 'سوم شخص'] : ['First person', 'Second person', 'Third person'];
  const tense = lang === 'fa' ? ['حال', 'گذشته'] : ['Present', 'Past'];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField label={t('q.perspective')} options={perspective} value={prefs.perspective} onChange={(v) => set({ perspective: v as StoryPreferences['perspective'] })} />
      <SelectField label={t('q.tense')} options={tense} value={prefs.tense} onChange={(v) => set({ tense: v as StoryPreferences['tense'] })} />
      <div className="sm:col-span-2">
        <Label className="mb-1.5 block">{t('q.voice')}</Label>
        <Input value={prefs.narrativeVoice ?? ''} onChange={(e) => set({ narrativeVoice: e.target.value })} />
      </div>
    </div>
  );
}

function StepChars(prefs: StoryPreferences, set: PrefSetter, t: T) {
  const chars = prefs.characters ?? [];
  const update = (i: number, patch: Partial<CharacterDefinition>) =>
    set({ characters: chars.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  return (
    <div className="space-y-3">
      {chars.map((c, i) => (
        <div key={`${c.name}-${i}`} className="space-y-2 rounded-md border p-3">
          <Input placeholder={t('q.charName')} value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
          <Textarea placeholder={t('q.charNotes')} value={c.personality || ''} onChange={(e) => update(i, { personality: e.target.value })} />
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => set({ characters: chars.filter((_, idx) => idx !== i) })}>
            {t('q.removeCharacter')}
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => set({ characters: [...chars, { name: '', role: 'supporting' }] })}>
        {t('q.addCharacter')}
      </Button>
    </div>
  );
}

function StepWorld(prefs: StoryPreferences, set: PrefSetter, t: T) {
  const fields: Array<[keyof StoryPreferences, string]> = [
    ['setting', t('q.world.setting')],
    ['timePeriod', t('q.world.time')],
    ['geography', t('q.world.geo')],
    ['culture', t('q.world.culture')],
    ['politics', t('q.world.politics')],
    ['technology', t('q.world.tech')],
    ['magicSystem', t('q.world.magic')],
    ['socialRules', t('q.world.social')],
    ['economicConditions', t('q.world.economy')],
    ['importantLocations', t('q.world.locations')],
    ['importantOrganizations', t('q.world.orgs')],
    ['importantObjects', t('q.world.objects')],
    ['historicalEvents', t('q.world.history')],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(([key, label]) => (
        <div key={key}>
          <Label className="mb-1.5 block">{label}</Label>
          <Input value={(prefs[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value } as Partial<StoryPreferences>)} />
        </div>
      ))}
    </div>
  );
}

function StepPlot(prefs: StoryPreferences, set: PrefSetter, t: T, lang: Lang) {
  const structures =
    lang === 'fa'
      ? ['ساختار سهپردهای', 'سفر قهرمان', 'ساختار معمایی', 'روایت غیرخطی']
      : ['Three-act structure', "Hero's journey", 'Mystery structure', 'Non-linear storytelling'];
  return (
    <ChipMulti label={t('q.plotStructures')} options={structures} value={prefs.plotStructures ?? []} onChange={(v) => set({ plotStructures: v })} />
  );
}

function StepContent(prefs: StoryPreferences, set: PrefSetter, t: T, lang: Lang) {
  const include = lang === 'fa' ? ['خانواده', 'هویت', 'از دست دادن'] : ['Family', 'Identity', 'Loss', 'Revenge', 'Love'];
  const avoid = lang === 'fa' ? ['خشونت گرافیکی', 'آزار حیوانات'] : ['Graphic gore', 'Animal cruelty', 'Child harm'];
  return (
    <div className="space-y-4">
      <ChipMulti label={t('q.include')} options={include} value={prefs.includeTopics ?? []} onChange={(v) => set({ includeTopics: v })} />
      <ChipMulti label={t('q.avoid')} options={avoid} value={prefs.avoidTopics ?? []} onChange={(v) => set({ avoidTopics: v })} />
      <LevelField label={t('q.violence')} value={prefs.violenceLevel ?? 2} onChange={(v) => set({ violenceLevel: v as StoryPreferences['violenceLevel'] })} />
      <LevelField label={t('q.romance')} value={prefs.romanceLevel ?? 2} onChange={(v) => set({ romanceLevel: v as StoryPreferences['romanceLevel'] })} />
    </div>
  );
}

function StepWriting(prefs: StoryPreferences, set: PrefSetter, t: T) {
  return (
    <div className="space-y-4">
      <Label className="mb-1.5 block">{t('q.adherence')}</Label>
      <LevelField label={t('q.experimental')} value={prefs.experimentalLevel ?? 2} onChange={(v) => set({ experimentalLevel: v as StoryPreferences['experimentalLevel'] })} />
    </div>
  );
}

export const PREF_STEPS: Array<{
  titleKey: string;
  blurbKey: string;
  render: (p: StoryPreferences, s: PrefSetter, t: T, lang: Lang) => React.ReactNode;
}> = [
  { titleKey: 'step.basics.title', blurbKey: 'step.basics.blurb', render: StepBasics },
  { titleKey: 'step.tone.title', blurbKey: 'step.tone.blurb', render: StepTone },
  { titleKey: 'step.style.title', blurbKey: 'step.style.blurb', render: StepStyle },
  { titleKey: 'step.chars.title', blurbKey: 'step.chars.blurb', render: StepChars },
  { titleKey: 'step.world.title', blurbKey: 'step.world.blurb', render: StepWorld },
  { titleKey: 'step.plot.title', blurbKey: 'step.plot.blurb', render: StepPlot },
  { titleKey: 'step.content.title', blurbKey: 'step.content.blurb', render: StepContent },
  { titleKey: 'step.writing.title', blurbKey: 'step.writing.blurb', render: StepWriting },
];

export function PreferenceForm({
  prefs,
  set,
  step,
}: {
  prefs: StoryPreferences;
  set: PrefSetter;
  step: number;
}) {
  const { t, lang } = useApp();
  const current = PREF_STEPS[step] ?? PREF_STEPS[0];
  return (
    <div>
      <h2 className="font-serif text-lg font-semibold">{t(current.titleKey)}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{t(current.blurbKey)}</p>
      {current.render(prefs, set, t, lang)}
    </div>
  );
}
