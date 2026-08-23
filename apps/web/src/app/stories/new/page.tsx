'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import type { CharacterDefinition, StoryPreferences } from '@storywriter/types';
import { api } from '@/lib/api';
import type { Lang } from '@/lib/i18n';
import { useApp } from '@/lib/app-state';
import { useDialogs } from '@/lib/dialogs';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type T = (key: string, vars?: Record<string, string | number>) => string;

function emptyPreferences(): StoryPreferences {
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

// ---------------------------------------------------------------------------
// Reusable field components
// ---------------------------------------------------------------------------
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
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
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
              onClick={() => toggle(o)}
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
  placeholder,
}: {
  label: string;
  options: string[];
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <Label className="mb-1.5 block">{label}</Label>
      <select
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          {placeholder ?? '…'}
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

// ---------------------------------------------------------------------------
// Character editor
// ---------------------------------------------------------------------------
function CharacterEditor({
  t,
  characters,
  onChange,
}: {
  t: T;
  characters: CharacterDefinition[];
  onChange: (c: CharacterDefinition[]) => void;
}) {
  const update = (i: number, patch: Partial<CharacterDefinition>) =>
    onChange(characters.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const add = () => onChange([...characters, { name: '', role: 'supporting', personality: '', motivation: '' }]);
  const remove = (i: number) => onChange(characters.filter((_, idx) => idx !== i));

  const roles: Record<string, string> = {
    protagonist: t('char.role.protagonist'),
    antagonist: t('char.role.antagonist'),
    supporting: t('char.role.supporting'),
    other: t('char.role.other'),
  };

  return (
    <div className="space-y-3">
      <Label>{t('q.characters')}</Label>
      {characters.map((c, i) => (
        <div key={i} className="rounded-md border p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder={t('q.charName')} value={c.name} onChange={(e) => update(i, { name: e.target.value })} />
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={c.role}
              onChange={(e) => update(i, { role: e.target.value as CharacterDefinition['role'] })}
            >
              {Object.entries(roles).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <Textarea
            placeholder={t('q.charNotes')}
            value={c.personality || ''}
            onChange={(e) => update(i, { personality: e.target.value })}
          />
          <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => remove(i)}>
            {t('q.removeCharacter')}
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={add}>
        {t('q.addCharacter')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
type Selected = Partial<StoryPreferences>;
type Setter = (patch: Selected) => void;

function StepBasics(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const genres = lang === 'fa'
    ? ['فانتزی', 'علمی-تخیلی', 'معمایی', 'هیجانی', 'هراس', 'عاشقانه', 'ادبی', 'تاریخی', 'ماجراجویی', 'سایر']
    : ['Fantasy', 'Sci-Fi', 'Mystery', 'Thriller', 'Horror', 'Romance', 'Literary', 'Historical', 'Adventure', 'Other'];
  const lengths = lang === 'fa'
    ? ['داستان کوتاه', 'نوولا', 'رمان', 'داستان دنبالهدار']
    : ['Short story', 'Novella', 'Novel', 'Serialized story'];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label className="mb-1.5 block">{t('q.title')}</Label>
        <Input value={prefs.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder="The Last Lighthouse" />
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
      <div>
        <Label className="mb-1.5 block">{t('q.chapters')}</Label>
        <Input type="number" value={prefs.chapterCount ?? ''} onChange={(e) => set({ chapterCount: Number(e.target.value) || undefined })} />
      </div>
    </div>
  );
}

function StepTone(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const tones = lang === 'fa'
    ? ['تاریک', 'امیدوار', 'تراژیک', 'کمدی', 'عاشقانه', 'پرتعلیق', 'فلسفی', 'روانشناختی', 'حماسی', 'سوررئال', 'واقعگرایانه']
    : ['Dark', 'Hopeful', 'Tragic', 'Comedic', 'Romantic', 'Suspenseful', 'Philosophical', 'Psychological', 'Epic', 'Surreal', 'Realistic'];
  const pacing = lang === 'fa' ? ['کند', 'معتدل', 'سریع'] : ['Slow', 'Moderate', 'Fast'];
  const scene = lang === 'fa' ? ['کوتاه', 'متوسط', 'بلند'] : ['Short', 'Medium', 'Long'];
  return (
    <div className="space-y-4">
      <ChipMulti label={t('q.tones')} options={tones} value={prefs.tones ?? []} onChange={(v) => set({ tones: v })} />
      <div>
        <Label className="mb-1.5 block">{t('q.customTone')}</Label>
        <Textarea value={prefs.customTone ?? ''} onChange={(e) => set({ customTone: e.target.value })} />
      </div>
      <SelectField label={t('q.pacing')} options={pacing} value={prefs.pacing} onChange={(v) => set({ pacing: v as any })} />
      <SelectField label={t('q.sceneLength')} options={scene} value={prefs.sceneLength} onChange={(v) => set({ sceneLength: v as any })} />
    </div>
  );
}

function StepNarrativeStyle(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const perspective = lang === 'fa' ? ['اول شخص', 'دوم شخص', 'سوم شخص'] : ['First person', 'Second person', 'Third person'];
  const povt = lang === 'fa' ? ['محدود', 'دانای کل'] : ['Limited', 'Omniscient'];
  const tense = lang === 'fa' ? ['حال', 'گذشته'] : ['Present', 'Past'];
  const langs = lang === 'fa' ? ['ادبی', 'ساده', 'ترکیبی'] : ['Literary', 'Simple', 'Mixed'];
  const dens = lang === 'fa' ? ['کم', 'متوسط', 'زیاد'] : ['Low', 'Medium', 'High'];
  const mono = lang === 'fa' ? ['هیچ', 'کم', 'زیاد'] : ['None', 'Light', 'Heavy'];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField label={t('q.perspective')} options={perspective} value={prefs.perspective} onChange={(v) => set({ perspective: v as any })} />
      <SelectField label={t('q.povtype')} options={povt} value={prefs.povType} onChange={(v) => set({ povType: v as any })} />
      <SelectField label={t('q.tense')} options={tense} value={prefs.tense} onChange={(v) => set({ tense: v as any })} />
      <div>
        <Label className="mb-1.5 block">{t('q.voice')}</Label>
        <Input value={prefs.narrativeVoice ?? ''} onChange={(e) => set({ narrativeVoice: e.target.value })} />
      </div>
      <SelectField label={t('q.language')} options={langs} value={prefs.languageStyle} onChange={(v) => set({ languageStyle: v as any })} />
      <SelectField label={t('q.dialogue')} options={dens} value={prefs.dialogueDensity} onChange={(v) => set({ dialogueDensity: v as any })} />
      <SelectField label={t('q.description')} options={dens} value={prefs.descriptionDensity} onChange={(v) => set({ descriptionDensity: v as any })} />
      <SelectField label={t('q.monologue')} options={mono} value={prefs.internalMonologue} onChange={(v) => set({ internalMonologue: v as any })} />
    </div>
  );
}

function StepCharacters(prefs: Selected, set: Setter, t: T) {
  return <CharacterEditor t={t} characters={prefs.characters ?? []} onChange={(v) => set({ characters: v })} />;
}

function StepWorld(prefs: Selected, set: Setter, t: T) {
  const fields: Array<[keyof StoryPreferences, string]> = [
    ['setting', 'Setting'],
    ['timePeriod', 'Time period'],
    ['geography', 'Geography'],
    ['culture', 'Culture'],
    ['politics', 'Politics'],
    ['technology', 'Technology'],
    ['magicSystem', 'Magic system'],
    ['socialRules', 'Social rules'],
    ['economicConditions', 'Economy'],
    ['importantLocations', 'Important locations'],
    ['importantOrganizations', 'Organizations'],
    ['importantObjects', 'Important objects'],
    ['historicalEvents', 'Historical events'],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(([key, label]) => (
        <div key={key}>
          <Label className="mb-1.5 block">{label}</Label>
          <Input value={(prefs[key] as string) ?? ''} onChange={(e) => set({ [key]: e.target.value } as any)} />
        </div>
      ))}
    </div>
  );
}

function StepPlot(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const structures = lang === 'fa'
    ? ['ساختار سهپردهای', 'سفر قهرمان', 'ساختار معمایی', 'روایت غیرخطی', 'چند خط زمانی', 'داستان کُندسوز', 'ریتم سریع', 'ساختار اپیزودیک', 'پیرنگ شخصیتمحور', 'پیرنگ داستانمحور']
    : ['Three-act structure', "Hero's journey", 'Mystery structure', 'Non-linear storytelling', 'Multiple timelines', 'Slow burn', 'Fast pacing', 'Episodic structure', 'Character-driven plot', 'Plot-driven story'];
  const storytelling = lang === 'fa'
    ? ['خطی', 'غیرخطی', 'چند خط زمانی', 'اپیزودیک', 'شخصیتمحور', 'داستانمحور']
    : ['Linear', 'Non-linear', 'Multiple timelines', 'Episodic', 'Character-driven', 'Plot-driven'];
  const ending = lang === 'fa' ? ['پایان باز', 'پایان بسته', 'تلخوشیرین'] : ['Open ending', 'Closed ending', 'Bittersweet'];
  return (
    <div className="space-y-4">
      <ChipMulti label={t('q.plotStructures')} options={structures} value={prefs.plotStructures ?? []} onChange={(v) => set({ plotStructures: v })} />
      <SelectField label={t('q.storytelling')} options={storytelling} value={prefs.storytelling} onChange={(v) => set({ storytelling: v as any })} />
      <SelectField label={t('q.ending')} options={ending} value={prefs.endingStyle} onChange={(v) => set({ endingStyle: v as any })} />
    </div>
  );
}

function StepContent(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const include = lang === 'fa'
    ? ['خانواده', 'هویت', 'از دست دادن', 'انتقام', 'رستگاری', 'قدرت', 'عشق', 'عدالت', 'بقا', 'دوستی']
    : ['Family', 'Identity', 'Loss', 'Revenge', 'Redemption', 'Power', 'Love', 'Justice', 'Survival', 'Friendship'];
  const avoid = lang === 'fa'
    ? ['خشونت گرافیکی', 'آزار حیوانات', 'آسیب به کودکان', 'خشونت جنسی', 'خودآزاری', 'مصرف مواد', 'سکس صریح']
    : ['Graphic gore', 'Animal cruelty', 'Child harm', 'Sexual violence', 'Self-harm', 'Drug use', 'Explicit sex'];
  return (
    <div className="space-y-5">
      <ChipMulti label={t('q.include')} options={include} value={prefs.includeTopics ?? []} onChange={(v) => set({ includeTopics: v })} />
      <ChipMulti label={t('q.avoid')} options={avoid} value={prefs.avoidTopics ?? []} onChange={(v) => set({ avoidTopics: v })} />
      <div className="grid grid-cols-2 gap-4">
        <LevelField label={t('q.violence')} value={prefs.violenceLevel ?? 2} onChange={(v) => set({ violenceLevel: v as any })} />
        <LevelField label={t('q.romance')} value={prefs.romanceLevel ?? 2} onChange={(v) => set({ romanceLevel: v as any })} />
        <LevelField label={t('q.humor')} value={prefs.humorLevel ?? 2} onChange={(v) => set({ humorLevel: v as any })} />
        <LevelField label={t('q.horror')} value={prefs.horrorLevel ?? 1} onChange={(v) => set({ horrorLevel: v as any })} />
      </div>
      <div>
        <Label className="mb-1.5 block">{t('q.sexual')}</Label>
        <Textarea value={prefs.sexualContentBoundaries ?? ''} onChange={(e) => set({ sexualContentBoundaries: e.target.value })} />
      </div>
      <div>
        <Label className="mb-1.5 block">{t('q.political')}</Label>
        <Input value={prefs.politicalThemes ?? ''} onChange={(e) => set({ politicalThemes: e.target.value })} />
      </div>
    </div>
  );
}

function StepWriting(prefs: Selected, set: Setter, t: T, lang: Lang) {
  const options = lang === 'fa'
    ? [
        ['strict', 'دنبال دقیق', 'ترجیحات را دقیق دنبال کن.'],
        ['mostly', 'بیشتر دنبال کن', 'انحرافِ سنجیده مجاز باشد.'],
        ['guideline', 'بهعنوان راهنما', 'ترجیحات را آزادانه تفسیر کن.'],
        ['surprise', 'غافلگیرم کن', 'در چارچوب دنیا، غافلگیرم کن.'],
      ]
    : [
        ['strict', 'Strictly follow', 'Follow preferences precisely.'],
        ['mostly', 'Mostly follow', 'Allow tasteful deviation.'],
        ['guideline', 'Use as guidelines', 'Freely interpret preferences.'],
        ['surprise', 'Surprise me', 'Surprise me when appropriate, within the world.'],
      ];
  return (
    <div className="space-y-5">
      <div>
        <Label className="mb-1.5 block">{t('q.adherence')}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map(([value, title, desc]) => (
            <button
              key={value}
              type="button"
              onClick={() => set({ instructionAdherence: value as any })}
              className={cn(
                'rounded-md border p-3 text-start transition-colors',
                prefs.instructionAdherence === value ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent',
              )}
            >
              <div className="text-sm font-medium">{title}</div>
              <div className="text-xs text-muted-foreground">{desc}</div>
            </button>
          ))}
        </div>
      </div>
      <LevelField label={t('q.experimental')} value={prefs.experimentalLevel ?? 2} onChange={(v) => set({ experimentalLevel: v as any })} />
    </div>
  );
}

const STEPS: Array<{
  titleKey: string;
  blurbKey: string;
  render: (p: Selected, s: Setter, t: T, lang: Lang) => React.ReactNode;
}> = [
  { titleKey: 'step.basics.title', blurbKey: 'step.basics.blurb', render: StepBasics },
  { titleKey: 'step.tone.title', blurbKey: 'step.tone.blurb', render: StepTone },
  { titleKey: 'step.style.title', blurbKey: 'step.style.blurb', render: StepNarrativeStyle },
  { titleKey: 'step.chars.title', blurbKey: 'step.chars.blurb', render: StepCharacters },
  { titleKey: 'step.world.title', blurbKey: 'step.world.blurb', render: StepWorld },
  { titleKey: 'step.plot.title', blurbKey: 'step.plot.blurb', render: StepPlot },
  { titleKey: 'step.content.title', blurbKey: 'step.content.blurb', render: StepContent },
  { titleKey: 'step.writing.title', blurbKey: 'step.writing.blurb', render: StepWriting },
];

export default function NewStoryPage() {
  const router = useRouter();
  const { t, lang, dir } = useApp();
  const dialogs = useDialogs();
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<StoryPreferences>(emptyPreferences());
  const [saving, setSaving] = useState(false);

  const set: Setter = (patch) => setPrefs((prev) => ({ ...prev, ...patch }));
  const isLast = step === STEPS.length - 1;

  async function handleCreate() {
    setSaving(true);
    try {
      const story = await api.createStory({
        title: prefs.title?.trim() || (lang === 'fa' ? 'داستان بدون عنوان' : 'Untitled Story'),
        description: prefs.premise,
        genre: prefs.genre,
        preferences: { preferences: prefs },
      });
      router.push(`/stories/${story.id}`);
    } catch (err) {
      dialogs.notify({ message: (err as Error).message });
      setSaving(false);
    }
  }

  const current = STEPS[step];

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

          <div className="mb-6 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <button
                key={s.titleKey}
                onClick={() => i < step && setStep(i)}
                className={cn('h-1.5 flex-1 rounded-full transition-colors', i <= step ? 'bg-primary' : 'bg-secondary')}
                aria-label={t(s.titleKey)}
              />
            ))}
          </div>

          <div className="rounded-lg border p-5">
            <h2 className="font-serif text-lg font-semibold">{t(current.titleKey)}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{t(current.blurbKey)}</p>
            <div className="min-h-[200px]">{current.render(prefs, set, t, lang)}</div>
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
