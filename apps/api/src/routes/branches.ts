import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';
import { NotFoundError } from '../services/story-service.js';

const createSchema = z.object({
  name: z.string().max(200).optional(),
  parentBranchId: z.string().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(['active', 'archived', 'completed']).optional(),
});

export default async function branchRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/stories/:id/branches', async (req) => {
    return container.branches.listByStory((req.params as any).id);
  });

  app.post('/stories/:id/branches', async (req, reply) => {
    const body = createSchema.parse(req.body);
    try {
      const branch = await container.branches.create((req.params as any).id, body);
      return reply.code(201).send(branch);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Story not found' });
      throw err;
    }
  });

  app.get('/branches/:id', async (req, reply) => {
    try {
      return await container.branches.get((req.params as any).id);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Branch not found' });
      throw err;
    }
  });

  app.patch('/branches/:id', async (req, reply) => {
    const body = updateSchema.parse(req.body);
    try {
      return await container.branches.update((req.params as any).id, body);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Branch not found' });
      throw err;
    }
  });

  app.delete('/branches/:id', async (req, reply) => {
    await container.branches.remove((req.params as any).id);
    return reply.code(204).send();
  });

  app.post('/branches/:id/duplicate', async (req, reply) => {
    try {
      const branch = await container.branches.duplicate((req.params as any).id);
      return reply.code(201).send(branch);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Branch not found' });
      throw err;
    }
  });
}
