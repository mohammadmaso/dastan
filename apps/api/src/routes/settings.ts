import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Container } from '../services/container.js';

const genSchema = z.object({
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().int().min(1).max(64000),
  topP: z.number().min(0).max(1),
  suggestionCount: z.number().int().min(1).max(8),
  retrievalDepth: z.number().int().min(1).max(20),
  recentNodeCount: z.number().int().min(1).max(30),
});

const saveSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai_compatible']).optional(),
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  embeddingModel: z.string().min(1).optional(),
  embeddingEnabled: z.boolean().optional(),
  generation: genSchema,
});

export default async function settingsRoutes(app: FastifyInstance, opts: { container: Container }) {
  const { container } = opts;

  app.get('/settings', async () => {
    return container.settings.get();
  });

  app.put('/settings', async (req) => {
    const body = saveSchema.parse(req.body);
    return container.settings.save(body);
  });
}
