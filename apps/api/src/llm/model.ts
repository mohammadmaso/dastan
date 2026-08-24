import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export interface ModelOpts {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function languageModel(opts: ModelOpts): LanguageModel {
  const provider = createOpenAICompatible({
    name: 'storywriter',
    apiKey: opts.apiKey || 'not-set',
    baseURL: opts.baseUrl.replace(/\/$/, ''),
  });
  return provider(opts.model);
}
