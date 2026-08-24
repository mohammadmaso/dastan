import type { FastifyInstance } from 'fastify';
import type { Container } from '../services/container.js';

export default async function graphRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  // GET /stories/:id/graph?branchId=...  → full knowledge graph for viewer
  // "all"/missing means every branch (any), otherwise filter to one branch.
  app.get('/stories/:id/graph', async (req) => {
    const query = req.query as { branchId?: string };
    const branchId = query.branchId && query.branchId !== 'all' ? query.branchId : 'any';
    return container.memory.getGraph((req.params as any).id, branchId);
  });

  // GET /stories/:id/entity/:name → detail for a clicked graph node
  app.get('/stories/:id/entity/:name', async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const query = req.query as { branchId?: string };
    try {
      const { entities } = await container.falkordb.fullGraph(id, query.branchId === 'all' ? 'any' : (query.branchId ?? null));
      const entity = entities.find((e) => e.name.toLowerCase() === decodeURIComponent(name).toLowerCase());
      if (!entity) return reply.code(404).send({ error: 'Entity not found' });
      const { relationships, episodes } = await container.falkordb.neighbors(
        [entity.name],
        id,
        query.branchId === 'all' ? 'any' : (query.branchId ?? null),
      );
      return {
        entity: { id: `e:${entity.name}`, name: entity.name, type: entity.type },
        relationships: relationships.map((r, i) => ({
          id: `r:${i}`,
          source: r.source,
          target: r.target,
          type: r.type,
          summary: r.summary,
          sourceType: r.sourceType,
          targetType: r.targetType,
          branchId: r.branchId,
        })),
        episodes: episodes.map((e) => ({
          id: e.id,
          summary: e.summary,
          branchId: e.branchId,
          at: '',
        })),
      };
    } catch {
      return reply.code(404).send({ error: 'Entity not found' });
    }
  });
}
