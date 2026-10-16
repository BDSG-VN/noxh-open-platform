/**
 * Vitest setup: when NOXH_TEST_RUNTIME_ROLE=1, every SQL statement issued by API service code
 * runs under a member of the least-privilege `noxh_app` role (SET ROLE), while fixture SQL issued
 * directly from test files keeps the migration-owner session. This replays the whole API suite
 * against migration 022 grants and RLS instead of a superuser connection.
 * Inactive by default; never used outside tests.
 */
import { afterAll } from 'vitest';
import { Database, type Sql } from './database';

const QA_ROLE = 'noxh_qa_runtime_member';
const WRAPPED = Symbol('runtime-role-wrapped');
type Wrapped = Sql & { [WRAPPED]?: true };

function callerIsTestCode(): boolean {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  for (const frame of frames) {
    if (frame.includes('test-runtime-role.ts') || frame.includes('/database.ts')) continue;
    if (frame.includes('node_modules') || frame.includes('node:')) continue;
    return /\.test\.ts|test-privacy\.ts/.test(frame);
  }
  return true;
}

const control = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i;

async function prepare(raw: Sql) {
  const ready = await raw.query("SELECT to_regrole('noxh_app') IS NOT NULL AS ok");
  if (!ready.rows[0]?.ok) return false;
  await raw.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${QA_ROLE}') THEN CREATE ROLE ${QA_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT; END IF; END $$`,
  );
  await raw.query(`GRANT noxh_app TO ${QA_ROLE}`);
  // Test fixtures create organizations freely; register each as served by this test instance.
  await raw.query(`CREATE OR REPLACE FUNCTION identity_private.qa_register_instance() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN INSERT INTO identity_private.instance_organizations(organization_id, registered_by)
      VALUES (NEW.id, 'synthetic test fixture') ON CONFLICT DO NOTHING; RETURN NEW; END $f$`);
  await raw.query('DROP TRIGGER IF EXISTS qa_register_instance ON organizations');
  await raw.query(
    'CREATE TRIGGER qa_register_instance AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION identity_private.qa_register_instance()',
  );
  await raw.query(
    "INSERT INTO identity_private.instance_organizations(organization_id, registered_by) SELECT id, 'synthetic test fixture' FROM organizations ON CONFLICT DO NOTHING",
  );
  return true;
}

export const runtimeRoleStats = { asRuntime: 0, asFixture: 0 };

function wrap(raw: Sql): Wrapped {
  let prepared: Promise<boolean> | undefined;
  const wrapped: Wrapped = {
    async query(text, values) {
      const fixture = callerIsTestCode();
      prepared ??= prepare(raw);
      if (!(await prepared) || fixture || control.test(text)) {
        if (!control.test(text)) runtimeRoleStats.asFixture++;
        return raw.query(text, values);
      }
      runtimeRoleStats.asRuntime++;
      await raw.query(`SET ROLE ${QA_ROLE}`);
      try {
        return await raw.query(text, values);
      } finally {
        // In an aborted transaction this fails; the caller's ROLLBACK reverts SET ROLE.
        await raw.query('RESET ROLE').catch(() => undefined);
      }
    },
    [WRAPPED]: true,
  };
  return wrapped;
}

if (process.env.NOXH_TEST_RUNTIME_ROLE === '1') {
  const ensure = (db: Database) => {
    const current = db.testExecutor as Wrapped | undefined;
    if (current && !current[WRAPPED]) db.testExecutor = wrap(current);
  };
  const query = Database.prototype.query;
  const tx = Database.prototype.tx;
  Database.prototype.query = function (this: Database, text: string, values?: unknown[]) {
    ensure(this);
    return query.call(this, text, values);
  };
  Database.prototype.tx = function <T>(this: Database, work: (sql: Sql) => Promise<T>) {
    ensure(this);
    return tx.call(this, work) as Promise<T>;
  };
  afterAll(() => {
    // Evidence that service SQL actually ran under the runtime role in this test file.
    console.info('[runtime-role] ' + JSON.stringify(runtimeRoleStats));
  });
}
