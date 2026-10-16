import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const c = await pool.connect();
try {
  await c.query('BEGIN');
  // Bounded waits: a blocked advisory or table lock fails the run instead of hanging forever.
  await c.query("SELECT set_config('lock_timeout', $1, true)", [
    process.env.MIGRATION_LOCK_TIMEOUT ?? '60s',
  ]);
  await c.query('SELECT pg_advisory_xact_lock(68280401)');
  await c.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('db/migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    const version = name.split('_')[0];
    const sql = await readFile(`db/migrations/${name}`, 'utf8');
    const sha = createHash('sha256').update(sql).digest('hex');
    const existing = await c.query('SELECT sha256 FROM schema_migrations WHERE version=$1', [
      version,
    ]);
    if (existing.rows.length) {
      if (existing.rows[0].sha256 !== sha) throw new Error('Applied migration checksum mismatch');
      continue;
    }
    await c.query(sql);
    await c.query('INSERT INTO schema_migrations(version,sha256) VALUES($1,$2)', [version, sha]);
    console.log(`Applied migration ${version}`);
  }
  await c.query('COMMIT');
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  // PostgreSQL error class/message and the failing statement position; the SQL text is not echoed.
  const cause =
    e instanceof Error
      ? `${e.name}: ${e.message}${e.position ? ' at ' + e.position : ''}`
      : 'unknown';
  console.error('Migration failed; transaction rolled back (' + cause + ')');
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
