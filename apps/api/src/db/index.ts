import pg from 'pg';
import type { AppConfig } from '../config.js';

const { Pool } = pg;

export type Db = pg.Pool;

export function createDb(config: AppConfig): Db {
  const pool = new Pool({
    host: config.postgres.host,
    port: config.postgres.port,
    database: config.postgres.database,
    user: config.postgres.user,
    password: config.postgres.password,
    max: 10,
  });

  pool.on('error', (err) => {
    console.error('[pg] idle client error', err.message);
  });

  return pool;
}

/** Row values -> JSON. Maps snake_case DB rows into camelCase domain objects. */
export function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value;
  }
  return out;
}

export function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
