import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';
import { NotFoundError } from '../services/story-service.js';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  preferences: z
    .object({ preferences: z.record(z.any()), note: z.string().optional() })
    .optional()
    .nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  genre: z.string().max(100).optional().nullable(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
});

export default async function storiesRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.post('/stories', async (req, reply) => {
    const body = createSchema.parse(req.body);
    const story = await container.stories.create(body as any);
    return reply.code(201).send(story);
  });

  app.get('/stories', async () => {
    return container.stories.list();
  });

  app.get('/stories/:id', async (req, reply) => {
    try {
      return await container.stories.get((req.params as any).id);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Story not found' });
      throw err;
    }
  });

  app.patch('/stories/:id', async (req, reply) => {
    const body = updateSchema.parse(req.body);
    try {
      return await container.stories.update((req.params as any).id, body);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Story not found' });
      throw err;
    }
  });

  app.delete('/stories/:id', async (req, reply) => {
    await container.stories.remove((req.params as any).id);
    return reply.code(204).send();
  });

  app.post('/stories/:id/duplicate', async (req, reply) => {
    try {
      const story = await container.stories.duplicate((req.params as any).id);
      return reply.code(201).send(story);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Story not found' });
      throw err;
    }
  });
}
