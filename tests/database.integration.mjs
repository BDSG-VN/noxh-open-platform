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
const { spawnSync } = await import('node:child_process');
const { randomBytes } = await import('node:crypto');
const SEED_ORG = '10000000-0000-4000-8000-000000000001';
const OTHER_ORG = '10000000-0000-4000-8000-0000000000c3';
const roleTool = (env, args) =>
  spawnSync(process.execPath, ['scripts/runtime-role.mjs', ...args], {
    env: { ...process.env, AUTH_ORGANIZATION_ID: SEED_ORG, ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
const withUser = (base, user, password, database) => {
  const url = new URL(base);
  url.username = user;
  url.password = password;
  if (database) url.pathname = '/' + database;
  return url.href;
};

await test('least-privilege runtime login: provision, verify and deny escalation on real PostgreSQL', async () => {
  const user = 'noxh_api_ci_' + randomBytes(4).toString('hex');
  const password = randomBytes(24).toString('hex');
  const env = { RUNTIME_DB_USER: user, RUNTIME_DB_PASSWORD: password };
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const runtimeUrl = withUser(process.env.DATABASE_URL, user, password);
  try {
    const first = roleTool(env, ['provision']);
    assert.equal(first.status, 0, first.stdout);
    assert.equal(JSON.parse(first.stdout).status, 'PASS');
    // Re-running aligns the same role (password rotation path) and never prints the secret.
    const again = roleTool(env, ['provision']);
    assert.equal(again.status, 0, again.stdout);
    for (const out of [first.stdout, first.stderr, again.stdout, again.stderr])
      assert.ok(!out.includes(password));
    const verified = roleTool({ RUNTIME_DATABASE_URL: runtimeUrl }, ['verify']);
    assert.equal(verified.status, 0, verified.stdout);
    assert.equal(JSON.parse(verified.stdout).status, 'PASS');
    const refused = roleTool({ RUNTIME_DATABASE_URL: process.env.DATABASE_URL }, ['verify']);
    assert.notEqual(refused.status, 0, 'owner connection must not verify as least privilege');

    const runtime = new Pool({ connectionString: runtimeUrl, max: 1 });
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
      await deny('SET session_replication_role = replica');
      await deny('CREATE TABLE public.qa_probe(id int)');
      // No TEMPORARY privilege: pg_temp objects cannot shadow names used by triggers or SQL.
      await deny('CREATE TEMP TABLE inventory_price_plans(organization_id uuid, project_id uuid)');
      await deny(
        'CREATE TEMP VIEW pg_roles AS SELECT current_user::name AS rolname, true AS rolsuper',
      );
      await deny('ALTER TABLE projects DISABLE ROW LEVEL SECURITY');
      await deny('TRUNCATE identity_private.audit_chain');
      await deny("UPDATE identity_private.audit_chain SET action='x'");
      await deny("UPDATE consent_records SET purpose='rewritten'");
      await deny('UPDATE users SET updated_at=now()');
      await deny('DELETE FROM identity_private.instance_organizations');
      await deny('CREATE ROLE qa_probe');
      // Seeded org is registered for this login; a second org inserted by the owner stays invisible.
      await owner.query(
        `INSERT INTO organizations(id,name) VALUES('${OTHER_ORG}','QA other org') ON CONFLICT DO NOTHING`,
      );
      const orgs = (await runtime.query('SELECT id FROM organizations ORDER BY id')).rows;
      assert.deepEqual(orgs, [{ id: SEED_ORG }]);
      assert.equal(
        (await runtime.query('SELECT count(*)::int AS n FROM projects')).rows[0].n,
        (
          await owner.query('SELECT count(*)::int AS n FROM projects WHERE organization_id=$1', [
            SEED_ORG,
          ])
        ).rows[0].n,
      );
      await assert.rejects(
        runtime.query(
          `INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES(gen_random_uuid(),'${OTHER_ORG}','x','y',true)`,
        ),
        (e) => e.code === '42501',
      );
      // Every static API statement plans as this real login (PostgreSQL privilege checks).
      const { sqlInventory } = await import('../scripts/sql-inventory.mjs');
      const failures = [];
      for (const s of (await sqlInventory()).statements) {
        try {
          await runtime.query('EXPLAIN (GENERIC_PLAN) ' + s.sql);
        } catch (e) {
          failures.push(`${s.location} ${e.code}`);
        }
      }
      assert.deepEqual(failures, []);
      // A login changing its own settings is detected by verify and undone by provision.
      await runtime.query("ALTER ROLE CURRENT_USER SET statement_timeout = '1ms'");
    } finally {
      await runtime.end();
    }
    const drifted = roleTool({ RUNTIME_DATABASE_URL: runtimeUrl }, ['verify']);
    assert.notEqual(drifted.status, 0, 'self-applied role settings must fail verification');
    assert.equal(roleTool(env, ['provision']).status, 0);
    assert.equal(roleTool({ RUNTIME_DATABASE_URL: runtimeUrl }, ['verify']).status, 0);
  } finally {
    await owner.query(`REVOKE noxh_app FROM "${user}"`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS "${user}"`).catch(() => undefined);
    await owner.query('DELETE FROM organizations WHERE id=$1', [OTHER_ORG]);
    await owner.end();
  }
});

await test('runtime provisioning refuses repurposed logins and one login cannot reach another database', async () => {
  const owner = new Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = randomBytes(4).toString('hex');
  const elevated = 'noxh_pre_' + suffix;
  const shared = 'noxh_shared_' + suffix;
  const otherDb = 'noxh_ci_other_' + suffix;
  const password = randomBytes(24).toString('hex');
  try {
    // A pre-existing role with direct grants must not be silently adopted.
    await owner.query(`CREATE ROLE "${elevated}" LOGIN`);
    await owner.query(`GRANT DELETE ON projects TO "${elevated}"`);
    const adopted = roleTool({ RUNTIME_DB_USER: elevated, RUNTIME_DB_PASSWORD: password }, [
      'provision',
    ]);
    assert.notEqual(adopted.status, 0);
    assert.match(adopted.stdout, /direct privileges/);
    // Provision a login for this database, then try to reuse it for a second database.
    const env = { RUNTIME_DB_USER: shared, RUNTIME_DB_PASSWORD: password };
    assert.equal(roleTool(env, ['provision']).status, 0);
    await owner.query(`CREATE DATABASE "${otherDb}"`);
    const otherUrl = new URL(process.env.DATABASE_URL);
    otherUrl.pathname = '/' + otherDb;
    const migrate = spawnSync(process.execPath, ['scripts/migrate.mjs'], {
      env: { ...process.env, DATABASE_URL: otherUrl.href },
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(migrate.status, 0, migrate.stdout + migrate.stderr);
    const other = new Pool({ connectionString: otherUrl.href });
    try {
      await other.query(
        `INSERT INTO organizations(id,name) VALUES('${OTHER_ORG}','QA other db org')`,
      );
      await other.query(
        `INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES(gen_random_uuid(),'${OTHER_ORG}','Other db project','QA',true)`,
      );
    } finally {
      await other.end();
    }
    const hijack = roleTool(
      { ...env, DATABASE_URL: otherUrl.href, AUTH_ORGANIZATION_ID: OTHER_ORG },
      ['provision'],
    );
    assert.notEqual(hijack.status, 0, 'a login already serving one database must be refused');
    assert.match(hijack.stdout, /another database/);
    // The first database's login connecting to the other database sees none of its rows.
    const cross = new Pool({
      connectionString: withUser(process.env.DATABASE_URL, shared, password, otherDb),
      max: 1,
    });
    try {
      assert.equal((await cross.query('SELECT count(*)::int AS n FROM projects')).rows[0].n, 0);
      assert.equal(
        (await cross.query('SELECT count(*)::int AS n FROM organizations')).rows[0].n,
        0,
      );
      assert.equal(
        (await cross.query('SELECT count(*)::int AS n FROM identity_private.auth_limits')).rows[0]
          .n,
        0,
      );
    } finally {
      await cross.end();
    }
  } finally {
    await owner.query(`DROP DATABASE IF EXISTS "${otherDb}" WITH (FORCE)`).catch(() => undefined);
    for (const role of [elevated, shared]) {
      await owner.query(`DROP OWNED BY "${role}"`).catch(() => undefined);
      await owner.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => undefined);
    }
    await owner.end();
  }
});
