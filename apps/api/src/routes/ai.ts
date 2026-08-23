import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';
import type { ContinueStreamChunk } from '@storywriter/types';
import { MemoryScope } from '@storywriter/types';

const continueSchema = z.object({
  storyId: z.string(),
  branchId: z.string(),
  nodeId: z.string().optional(),
  parentBranchId: z.string().optional(),
  instruction: z.string().max(5000).optional(),
  style: z.string().max(500).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(32000).optional(),
  suggestionCount: z.number().int().min(1).max(8).optional(),
});

const suggestionsSchema = z.object({
  storyId: z.string(),
  branchId: z.string(),
  nodeId: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  instruction: z.string().max(5000).optional(),
});

const retrieveSchema = z.object({
  storyId: z.string(),
  branchId: z.string(),
  query: z.string().min(1).max(1000),
  scope: z.array(z.enum(['GLOBAL_STORY_MEMORY', 'CURRENT_BRANCH_MEMORY'])).optional(),
  depth: z.number().int().min(1).max(20).optional(),
});

// reply.hijack() bypasses the normal Fastify hook pipeline, so @fastify/cors
// does NOT add CORS headers to this raw SSE response. JavaScript can't read the
// stream without Access-Control-Allow-Origin, so we add it manually, echoing
// the request origin (mirrors the @fastify/cors `origin: true` behavior).
function setupSSE(reply: FastifyReply) {
  reply.hijack();
  const raw = reply.raw;
  const origin = reply.request.headers.origin;
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*'; 
  }
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  raw.writeHead(200, headers);
  let closed = false;
  raw.on('close', () => {
    closed = true;
  });
  const push = (chunk: ContinueStreamChunk) => {
    if (closed) return;
    raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (chunk.kind === 'activity' && chunk.activity?.token) {
      // tokens are flowing; allow flush
    }
    // @ts-expect-error flush is not always present but harmless
    raw.flush?.();
  };
  const end = () => {
    if (closed) return;
    raw.end();
  };
  return { push, end };
}

export default async function aiRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  // POST /ai/continue — SSE streamed continuation generation
  app.post('/ai/continue', async (req, reply) => {
    const body = continueSchema.parse(req.body);
    const { push, end } = setupSSE(reply);
    await container.generation.continue(body, push);
    end();
  });

  // POST /ai/suggestions — generate continuations for a node (no prose saved)
  app.post('/ai/suggestions', async (req) => {
    const body = suggestionsSchema.parse(req.body);
    const options = await container.generation.generateSuggestions(body);
    return { options };
  });

  // POST /ai/retrieve — run the agentic retrieval directly (for the memory panel)
  app.post('/ai/retrieve', async (req) => {
    const body = retrieveSchema.parse(req.body);
    const scopes = body.scope?.length ? body.scope : [MemoryScope.BRANCH, MemoryScope.GLOBAL];
    const activities: Array<{ message: string; query?: string; scope?: string }> = [];
    const result = await container.memory.retrieve({
      storyId: body.storyId,
      branchId: body.branchId,
      query: body.query,
      scopes: scopes as any,
      depth: body.depth ?? 5,
      emit: (type, message, query, scope) =>
        activities.push({ message: message ?? '', query, scope }),
    });
    return { memories: result.memories, activities };
  });
}
