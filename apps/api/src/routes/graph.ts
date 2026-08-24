import type { FastifyInstance } from 'fastify';
import type { Container } from '../services/container.js';

export default async function graphRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/stories/:id/graph', async (req) => {
    const query = req.query as { branchId?: string };
    const branchId = query.branchId && query.branchId !== 'all' ? query.branchId : null;
    return container.memory.getGraph((req.params as { id: string }).id, branchId);
  });

  app.get('/stories/:id/entity/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const query = req.query as { branchId?: string };
    const branchId = query.branchId && query.branchId !== 'all' ? query.branchId : null;
    const detail = await container.memory.entityDetail(id, decodeURIComponent(name), branchId);
    if (!detail.entity) return reply.code(404).send({ error: 'Entity not found' });
    return detail;
  });
}
