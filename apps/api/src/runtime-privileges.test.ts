/** Least-privilege runtime role (migration 022): grants, RLS and denials on PostgreSQL (PGlite). */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Rows = Record<string, unknown>[];
interface Derived {
  tables: Map<string, { privileges: Set<string>; lockOnly: boolean }>;
  sequences: string[];
  statements: number;
}
interface Catalog {
  tables: { table_name: string; has_org: boolean }[];
  sequences: { sequence_name: string; table_name: string }[];
}
interface PrivilegeModule {
  readCatalog(query: (text: string, values?: unknown[]) => Promise<Rows>): Promise<Catalog>;
  deriveRuntimePrivileges(catalog: Catalog): Promise<Derived>;
  OWNER_ONLY_TABLES: string[];
}
interface InventoryModule {
  sqlInventory(): Promise<{ statements: { location: string; sql: string }[] }>;
}

const ORG_A = '10000000-0000-4000-8000-000000000001';
const ORG_B = '10000000-0000-4000-8000-0000000000b2';
const PROJECT_B = '20000000-0000-4000-8000-0000000000b2';
const MEMBER = 'qa_runtime_privilege_member';
const ALL = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
let pg: PGlite, catalog: Catalog, derived: Derived, inventory: InventoryModule;

const load = async <T>(file: string) =>
  (await import(pathToFileURL(resolve('../..', 'scripts', file)).href)) as T;
const rows = async (text: string, values: unknown[] = []) =>
  (await pg.query<Record<string, unknown>>(text, values)).rows;
/** Runs statements as a member of noxh_app inside a rolled-back transaction. */
async function asRuntime<T>(work: () => Promise<T>): Promise<T> {
  await pg.exec('BEGIN');
  await pg.exec(`SET LOCAL ROLE ${MEMBER}`);
  try {
    return await work();
  } finally {
    await pg.exec('ROLLBACK');
  }
}
async function deniedCode(sql: string) {
  try {
    await asRuntime(() => pg.exec(sql));
    return 'allowed';
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

beforeAll(async () => {
  pg = new PGlite();
  // Same bookkeeping table scripts/migrate.mjs creates before applying migrations.
  await pg.exec(
    'CREATE TABLE schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  await pg.exec(
    `CREATE ROLE ${MEMBER} NOLOGIN NOSUPERUSER NOBYPASSRLS INHERIT; GRANT noxh_app TO ${MEMBER};`,
  );
  const privileges = await load<PrivilegeModule>('runtime-privileges.mjs');
  inventory = await load<InventoryModule>('sql-inventory.mjs');
  catalog = await privileges.readCatalog(rows);
  derived = await privileges.deriveRuntimePrivileges(catalog);
}, 60000);
afterAll(async () => {
  await pg.close();
});

describe('runtime role privileges', () => {
  it('grants exactly what API SQL and invoked triggers need, no table-level extras', async () => {
    expect(derived.statements).toBeGreaterThan(500);
    const mismatches: string[] = [];
    for (const { table_name: table } of catalog.tables) {
      const need = derived.tables.get(table);
      for (const privilege of ALL) {
        const [r] = await rows('SELECT has_table_privilege($1,$2,$3) AS ok', [
          'noxh_app',
          table,
          privilege,
        ]);
        // The scope policy function reads the owner-managed instance list; nothing else.
        const expected =
          table === 'identity_private.instance_organizations'
            ? privilege === 'SELECT'
            : Boolean(
                need?.privileges.has(privilege) && !(need.lockOnly && privilege === 'UPDATE'),
              );
        if (r!.ok !== expected) mismatches.push(`${table} ${privilege} expected ${expected}`);
      }
      if (need?.lockOnly) {
        const [lock] = await rows(
          "SELECT has_any_column_privilege('noxh_app',$1,'UPDATE') AS col, EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='runtime_lock_only') AS guard",
          [table],
        );
        if (!lock!.col || !lock!.guard) mismatches.push(`${table} lock-only guard missing`);
      } else {
        const [col] = await rows("SELECT has_any_column_privilege('noxh_app',$1,'UPDATE') AS col", [
          table,
        ]);
        if (col!.col !== Boolean(need?.privileges.has('UPDATE')))
          mismatches.push(`${table} unexpected column UPDATE`);
      }
    }
    expect(mismatches).toEqual([]);
    const sequences = await rows(
      "SELECT name FROM (SELECT n.nspname||'.'||c.relname AS name, c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='S' OFFSET 0) s WHERE has_sequence_privilege('noxh_app',s.oid,'USAGE') ORDER BY 1",
    );
    expect(sequences.map((s) => s.name)).toEqual([...derived.sequences].sort());
  });

  it('has no login, superuser, bypass, DDL, ownership or SECURITY DEFINER surface', async () => {
    const [role] = await rows(
      "SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolcanlogin,rolinherit FROM pg_roles WHERE rolname='noxh_app'",
    );
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolcanlogin: false,
      rolinherit: false,
    });
    const [schema] = await rows(
      "SELECT has_schema_privilege('noxh_app','public','CREATE') AS pub, has_schema_privilege('noxh_app','identity_private','CREATE') AS priv",
    );
    expect(schema).toEqual({ pub: false, priv: false });
    expect(
      await rows(
        "SELECT relname FROM pg_class WHERE relowner IN (SELECT oid FROM pg_roles WHERE rolname IN ('noxh_app',$1))",
        [MEMBER],
      ),
    ).toEqual([]);
    expect(
      await rows(
        "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','identity_private') AND p.prosecdef",
      ),
    ).toEqual([]);
  });

  it('forces RLS with scoped runtime policies on every table', async () => {
    const tables = await rows(
      "SELECT n.nspname||'.'||c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname IN ('noxh_app_scope','noxh_app_guard') AND p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname='noxh_app')]) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','identity_private') ORDER BY 1",
    );
    const owner = new Set(['identity_private.instance_organizations', 'public.schema_migrations']);
    const missing = tables.filter(
      (t) => !owner.has(String(t.name)) && !(t.rls && t.force && t.policies === 2),
    );
    expect(missing).toEqual([]);
    expect(tables.length).toBeGreaterThan(80);
  });

  it('plans every API statement under the runtime role without privilege errors', async () => {
    const { statements } = await inventory.sqlInventory();
    const failures: string[] = [];
    for (const s of statements) {
      try {
        await asRuntime(() => pg.exec('EXPLAIN (GENERIC_PLAN) ' + s.sql));
      } catch (e) {
        failures.push(`${s.location} ${(e as { code?: string }).code} ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(statements.length).toBe(derived.statements);
  }, 120000);
});

describe('runtime role denials', () => {
  it('cannot run DDL, disable RLS, truncate, escalate or edit instance scope', async () => {
    expect(await deniedCode('CREATE TABLE public.qa_runtime_probe(id int)')).toBe('42501');
    expect(await deniedCode('CREATE TABLE identity_private.qa_runtime_probe(id int)')).toBe(
      '42501',
    );
    expect(await deniedCode('ALTER TABLE projects DISABLE ROW LEVEL SECURITY')).toBe('42501');
    expect(await deniedCode('ALTER TABLE projects NO FORCE ROW LEVEL SECURITY')).toBe('42501');
    expect(await deniedCode('DROP POLICY noxh_app_guard ON projects')).toBe('42501');
    expect(await deniedCode('TRUNCATE identity_private.audit_chain')).toBe('42501');
    // SET ROLE is checked against the login (session) user; covered by tests/database.integration.mjs.
    expect(
      await deniedCode(
        `INSERT INTO identity_private.instance_organizations(organization_id,registered_by) VALUES('${ORG_B}','x')`,
      ),
    ).toBe('42501');
    expect(await deniedCode('DELETE FROM identity_private.instance_organizations')).toBe('42501');
  });

  it('cannot rewrite append-only evidence or update lock-only tables', async () => {
    await pg.query(
      "INSERT INTO identity_private.instance_organizations(organization_id,registered_by) VALUES($1,'synthetic test') ON CONFLICT DO NOTHING",
      [ORG_A],
    );
    expect(await deniedCode("UPDATE identity_private.audit_chain SET action='x'")).toBe('42501');
    expect(await deniedCode('DELETE FROM identity_private.audit_chain')).toBe('42501');
    expect(await deniedCode('DELETE FROM declaration_versions')).toBe('42501');
    expect(await deniedCode('DELETE FROM application_decisions')).toBe('42501');
    expect(await deniedCode("UPDATE users SET status='disabled'")).toBe('42501');
    expect(await deniedCode('UPDATE users SET id=id')).toBe('42501');
    expect(await deniedCode("UPDATE organizations SET name='x'")).toBe('42501');
    expect(await deniedCode('SELECT id FROM users FOR UPDATE')).toBe('allowed');
    expect(await deniedCode('SELECT id FROM organizations FOR UPDATE')).toBe('allowed');
  });

  it('limits rows to registered instance organizations and the transaction pin', async () => {
    await pg.query("INSERT INTO organizations(id,name) VALUES($1,'Tổ chức khác giả lập')", [ORG_B]);
    await pg.query(
      "INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES($1,$2,'Dự án khác giả lập','Địa bàn giả lập',true)",
      [PROJECT_B, ORG_B],
    );
    await pg.query('DELETE FROM identity_private.instance_organizations');
    const visible = () =>
      asRuntime(async () =>
        (
          await pg.query<{ organization_id: string }>('SELECT organization_id FROM projects')
        ).rows.map((r) => r.organization_id),
      );
    expect(await visible()).toEqual([]);
    await pg.query(
      "INSERT INTO identity_private.instance_organizations(organization_id,registered_by) VALUES($1,'synthetic test')",
      [ORG_A],
    );
    const seen = await visible();
    expect(seen.length).toBe(2);
    expect(new Set(seen)).toEqual(new Set([ORG_A]));
    expect(
      await deniedCode(
        `INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES(gen_random_uuid(),'${ORG_B}','x','y',true)`,
      ),
    ).toBe('42501');
    expect(
      await deniedCode(
        `UPDATE projects SET organization_id='${ORG_B}' WHERE organization_id='${ORG_A}'`,
      ),
    ).toBe('42501');
    const pinned = await asRuntime(async () => {
      await pg.query("SELECT set_config('app.organization_id',$1,true)", [ORG_B]);
      return (await pg.query('SELECT id FROM projects')).rows.length;
    });
    expect(pinned).toBe(0);
    const pinnedA = await asRuntime(async () => {
      await pg.query("SELECT set_config('app.organization_id',$1,true)", [ORG_A]);
      return (await pg.query('SELECT id FROM projects')).rows.length;
    });
    expect(pinnedA).toBe(2);
    expect(
      await asRuntime(async () => (await pg.query('SELECT id FROM organizations')).rows),
    ).toEqual([{ id: ORG_A }]);
  });
});
