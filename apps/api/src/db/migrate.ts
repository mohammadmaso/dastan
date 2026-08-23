import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config.js';
import { createDb } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate(db = createDb(loadConfig())): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set<string>(
    (await db.query('SELECT name FROM _migrations')).rows.map((r) => r.name),
  );

  const files = (await readdir(join(__dirname, 'migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(__dirname, 'migrations', file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`[migrate] applied ${file}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Allow running directly: pnpm migrate
const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  migrate()
    .then(() => {
      console.log('[migrate] complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[migrate] failed', err);
      process.exit(1);
    });
}
