import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';

const bodySchema = z.object({
  preferences: z.record(z.any()),
  note: z.string().max(500).optional(),
});

export default async function preferencesRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/stories/:id/preferences', async (req, reply) => {
    const pref = await container.preferences.getLatest((req.params as any).id);
    if (!pref) return reply.code(404).send({ error: 'No preferences set yet' });
    return pref;
  });

  app.put('/stories/:id/preferences', async (req) => {
    const body = bodySchema.parse(req.body);
    return container.preferences.save((req.params as any).id, body.preferences as any, body.note);
  });

  app.get('/stories/:id/preferences/history', async (req) => {
    return container.preferences.history((req.params as any).id);
  });
}
