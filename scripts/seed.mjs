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
  await c.query('COMMIT');
  console.log('Synthetic fixtures installed');
} catch {
  await c.query('ROLLBACK');
  process.exitCode = 1;
  console.error('Seed failed; transaction rolled back');
} finally {
  c.release();
  await p.end();
}
