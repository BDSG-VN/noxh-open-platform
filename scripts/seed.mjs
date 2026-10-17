import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SYNTHETIC_FIXTURES !== 'true')
  throw new Error('Seed requires nonproduction and ALLOW_SYNTHETIC_FIXTURES=true');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await p.connect();
try {
  await c.query('BEGIN');
  await c.query(await readFile('db/fixtures/seed.sql', 'utf8'));
  if (process.env.DEMO_OPEN_ACCESS === 'true') {
    await c.query(await readFile('db/fixtures/demo-open.sql', 'utf8'));
    console.log('Open demo fixture installed (fictional project, synthetic notice)');
  }
  await c.query('COMMIT');
  console.log('Synthetic fixtures installed');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  process.exitCode = 1;
  const cause = e instanceof Error ? `${e.name}: ${e.message}` : 'unknown';
  console.error('Seed failed; transaction rolled back (' + cause + ')');
} finally {
  c.release();
  await p.end();
}
