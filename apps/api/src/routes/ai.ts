import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createUIMessageStream } from 'ai';
import type { Container } from '../services/container.js';
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

function pipeSse(reply: FastifyReply, stream: ReadableStream<Uint8Array | string>) {
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
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  raw.writeHead(200, headers);

  const reader = stream.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = typeof value === 'string' ? value : Buffer.from(value);
        raw.write(chunk);
      }
    } finally {
      raw.end();
    }
  };
  pump().catch(() => {
    try {
      raw.end();
    } catch {
      /* ignore */
    }
  });
}

export default async function aiRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.post('/ai/continue', async (req, reply) => {
    const body = continueSchema.parse(req.body);
    const uiStream = createUIMessageStream({
      execute: async ({ writer }) => {
        await container.generation.continue(body, writer);
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });

    // Encode UI message chunks as SSE `data:` frames the client already understands.
    const encoded = uiStream.pipeThrough(
      new TransformStream<unknown, string>({
        transform(chunk, controller) {
          controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        },
        flush(controller) {
          controller.enqueue('data: {"type":"finish"}\n\n');
        },
      }),
    );
    pipeSse(reply, encoded as unknown as ReadableStream<string>);
  });

  app.post('/ai/suggestions', async (req) => {
    const body = suggestionsSchema.parse(req.body);
    const options = await container.generation.generateSuggestions(body);
    return { options };
  });

  app.post('/ai/retrieve', async (req) => {
    const body = retrieveSchema.parse(req.body);
    const scopes = body.scope?.length ? body.scope : [MemoryScope.BRANCH, MemoryScope.GLOBAL];
    const result = await container.memory.retrieve({
      storyId: body.storyId,
      branchId: body.branchId,
      query: body.query,
      scopes: scopes as MemoryScope[],
      depth: body.depth ?? 5,
    });
    return { memories: result.memories };
  });
}
