/**
 * Vitest setup: when NOXH_TEST_RUNTIME_ROLE=1, every SQL statement issued by API service code
 * runs under a member of the least-privilege `noxh_app` role (SET ROLE), while fixture SQL issued
 * directly from test files keeps the migration-owner session. This replays the whole API suite
 * against migration 022 grants and RLS instead of a superuser connection.
 * Inactive by default; never used outside tests. Fails closed: missing migrations or unclear
 * statement attribution run as the runtime role or abort the test file.
 */
import { afterAll, expect } from 'vitest';
import { appendFileSync } from 'node:fs';
import { Database, type Sql } from './database';

const QA_ROLE = 'noxh_qa_runtime_member';
const WRAPPED = Symbol('runtime-role-wrapped');
type Wrapped = Sql & { [WRAPPED]?: true };

/** Fixture SQL is SQL whose nearest non-harness caller is a test file; anything else is runtime. */
function callerIsTestCode(): boolean {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  for (const frame of frames) {
    if (frame.includes('test-runtime-role.ts') || frame.includes('/database.ts')) continue;
    if (frame.includes('node_modules') || frame.includes('node:')) continue;
    return /\.test\.ts|test-privacy\.ts|test-notification\.ts/.test(frame);
  }
  return false;
}

const control = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/i;

/** Returns false for in-memory fake executors (no PostgreSQL behind them). */
async function prepare(raw: Sql): Promise<boolean> {
  const ready = await raw.query(
    "SELECT to_regrole('noxh_app') IS NOT NULL AND to_regclass('identity_private.instance_organizations') IS NOT NULL AS ok",
  );
  const row = ready.rows[0];
  if (!row || typeof row.ok !== 'boolean') return false;
  if (!row.ok)
    throw new Error('NOXH_TEST_RUNTIME_ROLE=1 requires migration 022 in the test database');
  runtimeRoleStats.wrapped++;
  await raw.query(
    `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${QA_ROLE}') THEN CREATE ROLE ${QA_ROLE} NOLOGIN INHERIT; END IF; END $$`,
  );
  await raw.query(`GRANT noxh_app TO ${QA_ROLE}`);
  // Test fixtures create organizations freely; register each for the QA runtime member.
  await raw.query(`CREATE OR REPLACE FUNCTION identity_private.qa_register_instance() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN INSERT INTO identity_private.instance_organizations(runtime_role, organization_id, registered_by)
      VALUES ('${QA_ROLE}', NEW.id, 'synthetic test fixture') ON CONFLICT DO NOTHING; RETURN NEW; END $f$`);
  await raw.query('DROP TRIGGER IF EXISTS qa_register_instance ON organizations');
  await raw.query(
    'CREATE TRIGGER qa_register_instance AFTER INSERT ON organizations FOR EACH ROW EXECUTE FUNCTION identity_private.qa_register_instance()',
  );
  await raw.query(
    `INSERT INTO identity_private.instance_organizations(runtime_role, organization_id, registered_by) SELECT '${QA_ROLE}', id, 'synthetic test fixture' FROM organizations ON CONFLICT DO NOTHING`,
  );
  return true;
}

export const runtimeRoleStats = { asRuntime: 0, asFixture: 0, wrapped: 0 };

function wrap(raw: Sql): Wrapped {
  let prepared: Promise<boolean> | undefined;
  const wrapped: Wrapped = {
    async query(text, values) {
      const fixture = callerIsTestCode();
      prepared ??= prepare(raw);
      if (!(await prepared) || control.test(text)) return raw.query(text, values);
      if (fixture) {
        runtimeRoleStats.asFixture++;
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
    // Only PGlite executors (which expose `.query` bound to a PGlite instance via a closure over
    // `pg`) get wrapped; hand-written fakes in unit tests are not databases.
    if (current && !current[WRAPPED] && /pg\.query|PGlite/.test(String(current.query)))
      db.testExecutor = wrap(current);
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
    const report = process.env.NOXH_TEST_RUNTIME_ROLE_REPORT;
    if (report)
      appendFileSync(
        report,
        JSON.stringify({ file: expect.getState().testPath, ...runtimeRoleStats }) + '\n',
      );
    if (runtimeRoleStats.wrapped && !runtimeRoleStats.asRuntime)
      throw new Error('Runtime-role replay ran no service SQL under noxh_app in this file');
  });
}
