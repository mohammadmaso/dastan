// Embeds text for retrieval. Uses the configured OpenAI-compatible /embeddings
// endpoint with the user-chosen embedding model (Graphiti-style). Embeddings
// only attempt a remote call when enabled in Settings; if disabled or the call
// fails (e.g. local models without embeddings), we fall back to a deterministic
// hashed bag-of-words vector so retrieval keeps working.

import { embed as embedRemote } from '../llm/client.js';

export interface EmbedOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export class EmbeddingProvider {
  constructor(private opts: () => Promise<EmbedOptions> | EmbedOptions) {}

  /** Returns embeddings; falls back to hash embeddings when disabled/failing. */
  async embed(text: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(text) ? text : [text];
    try {
      const o = await this.opts();
      if (o.enabled) {
        return await embedRemote(
          { baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model },
          inputs,
        );
      }
    } catch {
      /* fall back to local hashed embeddings */
    }
    return inputs.map((s) => hashEmbedding(s));
  }
}

export function hashEmbedding(text: string, dims = 96): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  for (const tok of tokens) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    const idx = h % dims;
    vec[idx] += 1;
    vec[(h + 7) % dims] += 0.5;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
