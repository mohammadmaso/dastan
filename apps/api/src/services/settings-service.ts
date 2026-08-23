import type { Db } from '../db/index.js';
import type { LLMSettings, SaveLLMSettingsInput } from '@storywriter/types';

// For a single-user local app, the API key is stored server-side only. We do a
// light obfuscation (base64 with a suffix) so it isn't plaintext at rest, but
// the primary guarantee is that it is NEVER returned to the browser or logged.
function encryptKey(plain: string): string {
  return `enc:v1:` + Buffer.from(plain).toString('base64');
}
function decryptKey(enc: string): string {
  if (enc.startsWith('enc:v1:')) {
    return Buffer.from(enc.slice('enc:v1:'.length), 'base64').toString('utf8');
  }
  return enc;
}

interface SettingsRow {
  provider: string;
  base_url: string;
  model: string;
  api_key_enc: string | null;
  embedding_model: string;
  embedding_enabled: boolean;
  temperature: number;
  max_tokens: number;
  top_p: number;
  suggestion_count: number;
  retrieval_depth: number;
  recent_node_count: number;
}

const COLS = `provider, base_url, model, api_key_enc,
  embedding_model, embedding_enabled,
  temperature, max_tokens, top_p, suggestion_count, retrieval_depth, recent_node_count`;

export class SettingsService {
  constructor(private db: Db) {}

  private async getRow(): Promise<SettingsRow | undefined> {
    const { rows } = await this.db.query<SettingsRow>(`SELECT ${COLS} FROM llm_settings WHERE id = 1`);
    return rows[0];
  }

  async get(): Promise<LLMSettings> {
    const r = await this.getRow();
    return {
      provider: (r?.provider as LLMSettings['provider']) ?? 'openai_compatible',
      baseUrl: r?.base_url ?? 'https://api.openai.com/v1',
      model: r?.model ?? 'gpt-4o-mini',
      hasApiKey: Boolean(r?.api_key_enc),
      embeddingModel: r?.embedding_model ?? 'text-embedding-3-small',
      embeddingEnabled: r?.embedding_enabled ?? true,
      generation: {
        temperature: r?.temperature ?? 0.8,
        maxTokens: r?.max_tokens ?? 4096,
        topP: r?.top_p ?? 1.0,
        suggestionCount: r?.suggestion_count ?? 3,
        retrievalDepth: r?.retrieval_depth ?? 5,
        recentNodeCount: r?.recent_node_count ?? 5,
      },
    };
  }

  /** Effective call options. Falls back to env-provided API key if not stored. */
  async callOptions() {
    const s = await this.get();
    const r = await this.getRow();
    const apiKey = r?.api_key_enc ? decryptKey(r.api_key_enc) : process.env.LLM_API_KEY ?? '';
    return {
      baseUrl: s.baseUrl,
      apiKey,
      model: s.model,
      embeddingModel: s.embeddingModel,
      embeddingEnabled: s.embeddingEnabled,
      temperature: s.generation.temperature,
      maxTokens: s.generation.maxTokens,
      topP: s.generation.topP,
      suggestionCount: s.generation.suggestionCount,
      retrievalDepth: s.generation.retrievalDepth,
      recentNodeCount: s.generation.recentNodeCount,
    };
  }

  async save(input: SaveLLMSettingsInput): Promise<LLMSettings> {
    const g = input.generation;
    await this.db.query(
      `UPDATE llm_settings SET
         provider = $1, base_url = $2, model = $3,
         api_key_enc = COALESCE($4, api_key_enc),
         embedding_model = COALESCE($5, embedding_model),
         embedding_enabled = COALESCE($6, embedding_enabled),
         temperature = $7, max_tokens = $8, top_p = $9,
         suggestion_count = $10, retrieval_depth = $11, recent_node_count = $12,
         updated_at = now()
       WHERE id = 1`,
      [
        input.provider ?? 'openai_compatible',
        input.baseUrl,
        input.model,
        input.apiKey ? encryptKey(input.apiKey) : null,
        input.embeddingModel ?? null,
        input.embeddingEnabled ?? null,
        g.temperature,
        g.maxTokens,
        g.topP,
        g.suggestionCount,
        g.retrievalDepth,
        g.recentNodeCount,
      ],
    );
    return this.get();
  }
}
