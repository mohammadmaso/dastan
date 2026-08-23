import Fastify from 'fastify';
import cors from '@fastify/cors';
import { loadConfig } from './config.js';
import { createDb } from './db/index.js';
import { migrate } from './db/migrate.js';
import { buildContainer } from './services/container.js';

import storiesRoutes from './routes/stories.js';
import preferencesRoutes from './routes/preferences.js';
import branchRoutes from './routes/branches.js';
import nodeRoutes from './routes/nodes.js';
import aiRoutes from './routes/ai.js';
import settingsRoutes from './routes/settings.js';
import graphRoutes from './routes/graph.js';
import exportRoutes from './routes/export.js';

async function main() {
  const config = loadConfig();
  const db = createDb(config);

  // Wait for PostgreSQL (docker-compose health gate handles this, but be safe).
  await waitForDb(db);

  // Apply migrations.
  await migrate(db);

  const container = buildContainer(db, config);

  const app = Fastify({
    logger: {
      level: 'info',
      redact: ['req.headers.authorization', 'apiKey'],
    },
  });

  await app.register(cors, {
    origin: true,
  });

  // Health checks
  app.get('/health', async (_, reply) => {
    try {
      await db.query('SELECT 1');
      const falkordb = await container.falkordb.ping();
      return reply.send({ status: 'ok', postgres: true, falkordb });
    } catch {
      return reply.code(503).send({ status: 'degraded', postgres: false });
    }
  });

  app.get('/health/ready', async () => ({ status: 'ready' }));

  // Warm up the graph schema in the background (non-fatal).
  container.memory.warmup().catch(() => undefined);

  const routeOpts = { container };
  await app.register(storiesRoutes, routeOpts);
  await app.register(preferencesRoutes, routeOpts);
  await app.register(branchRoutes, routeOpts);
  await app.register(nodeRoutes, routeOpts);
  await app.register(aiRoutes, routeOpts);
  await app.register(settingsRoutes, routeOpts);
  await app.register(graphRoutes, routeOpts);
  await app.register(exportRoutes, routeOpts);

  // Error mapping for validation errors
  app.setErrorHandler((error, req, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation failed', details: error.validation });
    }
    req.log.error(error);
    const status = reply.statusCode >= 400 ? reply.statusCode : 500;
    return reply.code(status).send({ error: error.message });
  });

  const shutdown = async () => {
    app.log.info('shutting down');
    try {
      await app.close();
    } finally {
      await db.end();
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`API listening on ${config.host}:${config.port}`);
  app.log.info(`FalkorDB: ${config.falkordb.host}:${config.falkordb.port}`);
}

async function waitForDb(db: import('pg').Pool, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      await db.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Could not connect to PostgreSQL after multiple attempts');
}

main().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
