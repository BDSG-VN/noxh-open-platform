import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is required for database tests; never silently skip');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await test('RLS under non-superuser: owner, other owner, other project, unset scope and cross-org FK', async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE noxh_runtime');
    await c.query(
      "SELECT set_config('app.organization_id',$1,true),set_config('app.project_id',$2,true),set_config('app.user_id',$3,true)",
      [
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
      ],
    );
    assert.equal((await c.query('SELECT * FROM prep_dossiers')).rowCount, 1);
    await c.query("SELECT set_config('app.user_id','30000000-0000-4000-8000-000000000099',true)");
    assert.equal((await c.query('SELECT * FROM prep_dossiers')).rowCount, 0);
    await c.query(
      "SELECT set_config('app.user_id','30000000-0000-4000-8000-000000000001',true),set_config('app.project_id','20000000-0000-4000-8000-000000000002',true)",
    );
    assert.equal((await c.query('SELECT * FROM prep_dossiers')).rowCount, 0);
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE noxh_runtime');
    assert.equal((await c.query('SELECT * FROM prep_dossiers')).rowCount, 0);
    await c.query('ROLLBACK');
    await c.query('BEGIN');
    await c.query(
      "INSERT INTO organizations(id,name) VALUES('10000000-0000-4000-8000-000000000002','Other test org')",
    );
    await assert.rejects(
      c.query(
        "INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES('40000000-0000-4000-8000-000000000099','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001')",
      ),
      (e) => e.code === '23503',
    );
    await c.query('ROLLBACK');
  } finally {
    await c.query('ROLLBACK');
    c.release();
    await pool.end();
  }
});
