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
await test('least-privilege runtime login: provision, verify and deny escalation on real PostgreSQL', async () => {
  const { spawnSync } = await import('node:child_process');
  const { randomBytes } = await import('node:crypto');
  const user = 'noxh_api_ci_' + randomBytes(4).toString('hex');
  const password = randomBytes(24).toString('hex');
  const env = {
    ...process.env,
    RUNTIME_DB_USER: user,
    RUNTIME_DB_PASSWORD: password,
    AUTH_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
  };
  const run = (args, extra = {}) =>
    spawnSync(process.execPath, ['scripts/runtime-role.mjs', ...args], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 30000,
    });
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const url = new URL(process.env.DATABASE_URL);
  url.username = user;
  url.password = password;
  try {
    const first = run(['provision']);
    assert.equal(first.status, 0, first.stdout);
    assert.equal(JSON.parse(first.stdout).status, 'PASS');
    // Re-running aligns the same role (password rotation path) and never prints the secret.
    const again = run(['provision']);
    assert.equal(again.status, 0, again.stdout);
    for (const out of [first.stdout, first.stderr, again.stdout, again.stderr])
      assert.ok(!out.includes(password));
    const verified = run(['verify'], { RUNTIME_DATABASE_URL: url.href });
    assert.equal(verified.status, 0, verified.stdout);
    assert.equal(JSON.parse(verified.stdout).status, 'PASS');
    const refused = run(['verify'], {
      RUNTIME_DATABASE_URL: process.env.DATABASE_URL,
    });
    assert.notEqual(refused.status, 0, 'owner connection must not verify as least privilege');

    const runtime = new Pool({ connectionString: url.href, max: 1 });
    try {
      const deny = async (sql) =>
        assert.rejects(runtime.query(sql), (e) => e.code === '42501', sql);
      const [me] = (
        await runtime.query(
          'SELECT current_user AS u, session_user AS s, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user',
        )
      ).rows;
      assert.deepEqual(me, { u: user, s: user, rolsuper: false, rolbypassrls: false });
      const ownerName = new URL(process.env.DATABASE_URL).username;
      await deny(`SET ROLE "${ownerName}"`);
      await deny('SET ROLE noxh_runtime');
      await deny('CREATE TABLE public.qa_probe(id int)');
      await deny('ALTER TABLE projects DISABLE ROW LEVEL SECURITY');
      await deny('TRUNCATE identity_private.audit_chain');
      await deny("UPDATE identity_private.audit_chain SET action='x'");
      await deny('DELETE FROM identity_private.instance_organizations');
      await deny('CREATE ROLE qa_probe');
      // Seeded org is registered; a second org inserted by the owner stays invisible.
      await owner.query(
        "INSERT INTO organizations(id,name) VALUES('10000000-0000-4000-8000-0000000000c3','QA other org') ON CONFLICT DO NOTHING",
      );
      const orgs = (await runtime.query('SELECT id FROM organizations ORDER BY id')).rows;
      assert.deepEqual(orgs, [{ id: '10000000-0000-4000-8000-000000000001' }]);
      assert.equal(
        (await runtime.query('SELECT count(*)::int AS n FROM projects')).rows[0].n,
        (
          await owner.query(
            "SELECT count(*)::int AS n FROM projects WHERE organization_id='10000000-0000-4000-8000-000000000001'",
          )
        ).rows[0].n,
      );
      await assert.rejects(
        runtime.query(
          "INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES(gen_random_uuid(),'10000000-0000-4000-8000-0000000000c3','x','y',true)",
        ),
        (e) => e.code === '42501',
      );
    } finally {
      await runtime.end();
    }
  } finally {
    await owner.query(`REVOKE noxh_app FROM "${user}"`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS "${user}"`).catch(() => undefined);
    await owner.query("DELETE FROM organizations WHERE id='10000000-0000-4000-8000-0000000000c3'");
    await owner.end();
  }
});
