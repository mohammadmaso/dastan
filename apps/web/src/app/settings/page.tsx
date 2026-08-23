'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import type { GenerationSettings, LLMSettings } from '@storywriter/types';
import { api } from '@/lib/api';
import { useApp, type Theme } from '@/lib/app-state';
import { SiteHeader } from '@/components/site-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const defaultGen: GenerationSettings = {
  temperature: 0.8,
  maxTokens: 4096,
  topP: 1.0,
  suggestionCount: 3,
  retrievalDepth: 5,
  recentNodeCount: 5,
};

export default function SettingsPage() {
  const { t, theme, setTheme, lang, setLang } = useApp();
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<LLMSettings['provider']>('openai_compatible');
  const [embeddingEnabled, setEmbeddingEnabled] = useState(true);
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [gen, setGen] = useState<GenerationSettings>(defaultGen);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setBaseUrl(s.baseUrl);
      setModel(s.model);
      setProvider(s.provider);
      setEmbeddingEnabled(s.embeddingEnabled);
      setEmbeddingModel(s.embeddingModel);
      setGen(s.generation);
    });
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.saveSettings({
        provider,
        baseUrl,
        model,
        apiKey: apiKey || undefined,
        embeddingEnabled,
        embeddingModel,
        generation: gen,
      });
      setSaved(true);
      setApiKey('');
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <SiteHeader />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-5 px-6 py-8">
          <div>
            <h1 className="font-serif text-2xl font-semibold">{t('settings.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('settings.sub')}</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.preferences')}</CardTitle>
              <CardDescription>Interface appearance.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('lang.label')}</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as 'en' | 'fa')}
                >
                  <option value="en">{t('lang.en')}</option>
                  <option value="fa">{t('lang.fa')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label>{t('theme.label')}</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as Theme)}
                >
                  <option value="paper">{t('theme.paper')}</option>
                  <option value="light">{t('theme.light')}</option>
                  <option value="dark">{t('theme.dark')}</option>
                </select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.provider')}</CardTitle>
              <CardDescription>{t('settings.providerDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ['openai_compatible', 'OpenAI-compatible'],
                  ['openai', 'OpenAI'],
                  ['anthropic', 'Anthropic'],
                ].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setProvider(v as LLMSettings['provider'])}
                    className={
                      'rounded-md border px-3 py-2 text-sm ' +
                      (provider === v ? 'border-primary bg-primary/10' : 'border-input hover:bg-accent')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <Label>{t('settings.baseUrl')}</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="space-y-1">
                <Label>{t('settings.apikey')}</Label>
                <p className="text-xs text-muted-foreground">
                  {settings?.hasApiKey ? t('settings.apikeyKeep') : t('settings.apikeyNone')}
                </p>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={settings?.hasApiKey ? '••••••••' : t('settings.apikeyPh')}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('settings.model')}</Label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini, qwen3, llama…" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.embeddings')}</CardTitle>
              <CardDescription>{t('settings.embeddingsSub')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label>{t('settings.embeddingsEnabled')}</Label>
                <input
                  type="checkbox"
                  checked={embeddingEnabled}
                  onChange={(e) => setEmbeddingEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div className="space-y-1">
                <Label>{t('settings.embeddingModel')}</Label>
                <Input
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                  placeholder="text-embedding-3-small"
                />
                <p className="text-xs text-muted-foreground">
                  e.g. text-embedding-3-small, nomic-embed-text (Ollama), mistral-embed…
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.generation')}</CardTitle>
              <CardDescription>{t('settings.generationSub')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {(
                ['temperature', 'maxTokens', 'topP', 'suggestionCount', 'retrievalDepth', 'recentNodeCount'] as Array<
                  keyof GenerationSettings
                >
              ).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="capitalize">{key.replace(/([A-Z])/g, ' $1')}</Label>
                  <Input
                    type="number"
                    step="any"
                    value={gen[key] as number}
                    onChange={(e) => setGen({ ...gen, [key]: Number(e.target.value) })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-sm text-emerald-500">
                <Check className="h-4 w-4" /> {t('settings.saved')}
              </span>
            )}
            <Button onClick={save} disabled={saving || !baseUrl || !model}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('settings.save')}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
