// Kept as a tiny error type for callers that still import it. Generation now
// goes through the Vercel AI SDK (`llm/model.ts`).

export class LLMError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
  }
}
