// Minimal OpenAI-compatible HTTP client. Works with OpenAI, local/self-hosted
// servers (Ollama, vLLM, LM Studio, llama.cpp) and other compatible providers.
// Supports text streaming (server-sent events) and embeddings.

export interface LLMCallOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Allow streaming. When false, returns the full completion. */
  stream?: boolean;
  jsonMode?: boolean;
}

export interface CompletionResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  finishedReason?: string;
}

export class LLMError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
  }
}

function isAbort(err: unknown): boolean {
  return (err as any)?.name === 'AbortError';
}

// Generous but bounded: a hung provider must never wedge a request forever.
const TOTAL_STREAM_MS = 10 * 60 * 1000;
const IDLE_STREAM_MS = 90 * 1000;
const CHAT_TIMEOUT_MS = 120 * 1000;
const EMBED_TIMEOUT_MS = 60 * 1000;

/** Stream a chat completion, yielding content deltas as they arrive. */
export async function* streamChat(
  opts: LLMCallOptions,
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<{ delta: string; done: boolean; usage?: { prompt: number; completion: number } }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.8,
    top_p: opts.topP ?? 1.0,
    stream: true,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_STREAM_MS);

  let response: Response;
  try {
    response = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(totalTimer);
    throw isAbort(err) ? new LLMError('LLM request timed out') : err;
  }

  if (!response.ok) {
    clearTimeout(totalTimer);
    const detail = await response.text().catch(() => '');
    throw new LLMError(
      `LLM request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  if (!response.body) {
    clearTimeout(totalTimer);
    throw new LLMError('Empty response body from LLM provider');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let usage: { prompt: number; completion: number } | undefined;
  let lastActivity = Date.now();

  // If the provider stalls mid-stream (no data), abort so the caller can recover.
  const idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_STREAM_MS) controller.abort();
  }, 5000);

  try {
    while (true) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw isAbort(err) ? new LLMError('LLM stream stalled — no tokens received for a while') : err;
      }
      lastActivity = Date.now();
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let json: any;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        if (json.usage) {
          usage = {
            prompt: json.usage.prompt_tokens,
            completion: json.usage.completion_tokens,
          };
        }
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          fullText += delta;
          yield { delta, done: false };
        }
      }
    }
  } finally {
    clearInterval(idleTimer);
    clearTimeout(totalTimer);
  }
  yield { delta: '', done: true, usage };
}

/** Non-streaming chat completion. */
export async function chat(
  opts: LLMCallOptions,
  messages: Array<{ role: string; content: string }>,
): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.8,
    top_p: opts.topP ?? 1.0,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonMode) body.response_format = { type: 'json_object' };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });
  } catch (err) {
    throw isAbort(err) ? new LLMError('LLM request timed out') : err;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LLMError(
      `LLM request failed (${response.status}): ${detail.slice(0, 300)}`,
      response.status,
    );
  }

  const json: any = await response.json();
  const choice = json.choices?.[0];
  return {
    text: choice?.message?.content ?? '',
    promptTokens: json.usage?.prompt_tokens,
    completionTokens: json.usage?.completion_tokens,
    finishedReason: choice?.finish_reason,
  };
}

export async function embed(
  opts: { baseUrl: string; apiKey: string; model?: string },
  input: string | string[],
): Promise<number[][]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  let response: Response;
  try {
    response = await fetch(`${opts.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model ?? process.env.MEMORY_EMBEDDING_MODEL ?? 'text-embedding-3-small',
        input,
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
  } catch (err) {
    throw isAbort(err) ? new LLMError('Embedding request timed out') : err;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new LLMError(`Embedding request failed (${response.status}): ${detail.slice(0, 200)}`, response.status);
  }
  const json: any = await response.json();
  const items = Array.isArray(json.data) ? json.data : [];
  return items.map((d: any) => d.embedding as number[]);
}
