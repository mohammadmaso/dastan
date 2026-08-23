import type { FastifyInstance } from 'fastify';
import type { Container } from '../services/container.js';
import { NotFoundError } from '../services/story-service.js';

export default async function exportRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/branches/:id/export.md', async (req, reply) => {
    const branchId = (req.params as any).id;
    try {
      const branch = await container.branches.get(branchId);
      const md = await container.exporter.exportBranchMarkdown(branch.storyId, branchId);
      const story = await container.stories.get(branch.storyId);
      const safe = (story.title ?? 'story').replace(/[^\w\d-]+/g, '_');
      return reply
        .header('Content-Type', 'text/markdown; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${safe}.md"`)
        .send(md);
    } catch (err) {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: 'Branch not found' });
      throw err;
    }
  });
}
