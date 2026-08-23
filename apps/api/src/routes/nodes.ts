import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';
import { NotFoundError } from '../services/story-service.js';

const createSchema = z.object({
  branchId: z.string(),
  parentNodeId: z.string().optional().nullable(),
  content: z.string().max(200_000),
  nodeType: z
    .enum(['ROOT', 'AI_GENERATED', 'USER_WRITTEN', 'CHOICE', 'BRANCH', 'CHAPTER_START', 'CHAPTER_END'])
    .optional(),
  author: z.enum(['ai', 'user', 'system']).optional(),
  continuationLabel: z.string().max(200).optional().nullable(),
  makeCurrent: z.boolean().optional(),
});

const updateSchema = z.object({
  content: z.string().max(200_000).optional(),
  nodeType: z
    .enum(['ROOT', 'AI_GENERATED', 'USER_WRITTEN', 'CHOICE', 'BRANCH', 'CHAPTER_START', 'CHAPTER_END'])
    .optional(),
  continuationLabel: z.string().max(200).optional().nullable(),
  isCurrent: z.boolean().optional(),
  chapterId: z.string().optional().nullable(),
});

const chapterSchema = z.object({
  title: z.string().min(1).max(200),
});

export default async function nodeRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/branches/:id/nodes', async (req) => {
    return container.nodes.listByBranch((req.params as any).id);
  });

  app.get('/branches/:id/nodes/current', async (req, reply) => {
    const node = await container.nodes.current((req.params as any).id);
    if (!node) return reply.code(404).send({ error: 'No current node' });
    return node;
  });

  app.post('/branches/:id/nodes', async (req, reply) => {
    const body = createSchema.parse(req.body);
    try {
      const node = await container.nodes.create(body);
      return reply.code(201).send(node);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
  });

  app.get('/nodes/:id', async (req, reply) => {
    try {
      return await container.nodes.get((req.params as any).id);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Node not found' });
      throw err;
    }
  });

  // Autosave endpoint (debounced on the client).
  app.patch('/nodes/:id', async (req, reply) => {
    const body = updateSchema.parse(req.body);
    try {
      return await container.nodes.update((req.params as any).id, body);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Node not found' });
      throw err;
    }
  });

  app.delete('/nodes/:id', async (req, reply) => {
    await container.nodes.remove((req.params as any).id);
    return reply.code(204).send();
  });

  app.post('/nodes/:id/set-current', async (req, reply) => {
    try {
      const node = await container.nodes.get((req.params as any).id);
      await container.nodes.setCurrent(node.branchId, node.id);
      return container.nodes.get(node.id);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Node not found' });
      throw err;
    }
  });

  // Chapter boundary: POST /nodes/:id/chapter  { title }
  app.post('/nodes/:id/chapter', async (req, reply) => {
    const body = chapterSchema.parse(req.body);
    try {
      const node = await container.nodes.get((req.params as any).id);
      const chapter = await container.nodes.createChapterBoundary(
        node.storyId,
        node.branchId,
        node.id,
        body.title,
      );
      return reply.code(201).send(chapter);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Node not found' });
      throw err;
    }
  });
}
