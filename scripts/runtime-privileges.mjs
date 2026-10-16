// Derives the least-privilege grant set for the API runtime database role (noxh_app) from the
// SQL the API actually issues plus the SECURITY INVOKER trigger bodies those writes fire.
// The committed migration 022 is the reviewed output; tests recompute the derivation and fail
// when code needs a privilege the migrations do not grant, or a grant is no longer needed.
import { sqlInventory, requiredPrivileges } from './sql-inventory.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const RUNTIME_GROUP = 'noxh_app';
export const RUNTIME_SCHEMAS = ['public', 'identity_private'];
/** Owner-managed bookkeeping that the runtime may only read (its own rows). */
export const OWNER_ONLY_TABLES = ['identity_private.instance_organizations'];
/** No organization column: limited to logins registered for this database. */
export const GLOBAL_TABLES = [
  'identity_private.auth_limits',
  'identity_private.revoked_staff_sessions',
];
/** No organization column; scoped through the parent application row visible under RLS. */
export const PARENT_SCOPED_TABLES = {
  'public.application_generated_forms':
    'EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id)',
};
/** Columns the lock-only grant prefers: bookkeeping fields that carry no business meaning. */
const HARMLESS_LOCK_COLUMNS = ['updated_at', 'version', 'created_at', 'linked_at'];
/** Fixed search_path for every trigger function so pg_temp/public objects cannot shadow names. */
export const FUNCTION_SEARCH_PATH = 'pg_catalog, public, identity_private, pg_temp';

/** Catalog facts needed for derivation; queried with the migration owner connection. */
export async function readCatalog(query) {
  const triggers = await query(
    `SELECT n.nspname || '.' || c.relname AS table_name,
            t.tgname AS trigger_name,
            t.tgtype::int AS tgtype,
            p.prosrc AS body,
            p.prosecdef AS security_definer
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal AND n.nspname = ANY($1)
      ORDER BY 1, 2`,
    [RUNTIME_SCHEMAS],
  );
  const tables = await query(
    `SELECT n.nspname || '.' || c.relname AS table_name,
            ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum) AS columns,
            EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1)
      ORDER BY 1`,
    [RUNTIME_SCHEMAS],
  );
  const sequences = await query(
    `SELECT sn.nspname || '.' || s.relname AS sequence_name, tn.nspname || '.' || t.relname AS table_name
       FROM pg_depend d
       JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
       JOIN pg_namespace sn ON sn.oid = s.relnamespace
       JOIN pg_class t ON t.oid = d.refobjid
       JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE d.deptype IN ('a','i') AND tn.nspname = ANY($1)
      ORDER BY 1`,
    [RUNTIME_SCHEMAS],
  );
  return { triggers, tables, sequences };
}

const TRIGGER_INSERT = 1 << 2,
  TRIGGER_DELETE = 1 << 3,
  TRIGGER_UPDATE = 1 << 4;

/**
 * @returns {{ tables: Map<string,{privileges:Set<string>, updateColumns:Set<string>, lockOnly:boolean}>, sequences: string[], statements: number }}
 */
export async function deriveRuntimePrivileges(catalog) {
  const { statements, dynamic } = await sqlInventory();
  if (dynamic.some((d) => !d.location.startsWith('apps/api/src/database.ts')))
    throw new Error('Unresolvable SQL in API source: ' + dynamic.map((d) => d.location).join(', '));
  const need = new Map();
  const entry = (table) => {
    if (!need.has(table))
      need.set(table, { privileges: new Set(), updateColumns: new Set(), locked: false });
    return need.get(table);
  };
  const absorb = (sql) => {
    for (const [table, privilege, column] of requiredPrivileges(sql)) {
      const e = entry(table);
      if (privilege === 'LOCK') e.locked = true;
      else if (privilege === 'UPDATE') e.updateColumns.add(column);
      else e.privileges.add(privilege);
    }
  };
  for (const { sql } of statements) absorb(sql);
  // Trigger functions are SECURITY INVOKER: their statements run with the runtime privileges.
  // Iterate to a fixed point because a trigger can write a table that has its own trigger.
  const snapshot = () =>
    JSON.stringify(
      [...need].map(([k, v]) => [
        k,
        [...v.privileges].sort(),
        [...v.updateColumns].sort(),
        v.locked,
      ]),
    );
  for (let before = '', after = snapshot(); before !== after; before = after, after = snapshot()) {
    for (const t of catalog.triggers) {
      if (t.security_definer)
        throw new Error('SECURITY DEFINER trigger needs explicit review: ' + t.table_name);
      const e = need.get(t.table_name);
      if (!e) continue;
      const fires =
        (t.tgtype & TRIGGER_INSERT && e.privileges.has('INSERT')) ||
        (t.tgtype & TRIGGER_DELETE && e.privileges.has('DELETE')) ||
        (t.tgtype & TRIGGER_UPDATE && e.updateColumns.size > 0);
      if (fires && t.trigger_name !== 'runtime_lock_only') absorb(t.body);
    }
  }
  const byName = new Map(catalog.tables.map((t) => [t.table_name, t]));
  const unknown = [...need.keys()].filter(
    (t) => !byName.has(t) && t !== 'public.schema_migrations' && !OWNER_ONLY_TABLES.includes(t),
  );
  if (unknown.length) throw new Error('SQL references unknown tables: ' + unknown.join(', '));
  const tables = new Map();
  for (const [table, e] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    if (OWNER_ONLY_TABLES.includes(table)) {
      if ([...e.privileges].some((p) => p !== 'SELECT') || e.updateColumns.size || e.locked)
        throw new Error('Runtime SQL must not write ' + table);
      continue;
    }
    const columns = byName.get(table)?.columns ?? [];
    for (const c of e.updateColumns)
      if (table !== 'public.schema_migrations' && !columns.includes(c))
        throw new Error(`UPDATE of unknown column ${table}.${c}`);
    tables.set(table, {
      privileges: e.privileges,
      updateColumns: e.updateColumns,
      lockOnly: e.locked && e.updateColumns.size === 0,
    });
  }
  const sequences = catalog.sequences
    .filter((s) => tables.get(s.table_name)?.privileges.has('INSERT'))
    .map((s) => s.sequence_name);
  return { tables, sequences, statements: statements.length };
}

export function lockColumn(columns) {
  return HARMLESS_LOCK_COLUMNS.find((c) => columns.includes(c)) ?? columns[0];
}

const q = (name) =>
  name
    .split('.')
    .map((p) => '"' + p + '"')
    .join('.');

/** Inline (planner-friendly, bound-by-OID) scope expression for an organization column. */
export function scopeExpression(column) {
  return (
    `${column} IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER)` +
    ` AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL` +
    ` OR ${column} = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)`
  );
}
const REGISTERED_LOGIN =
  'EXISTS (SELECT 1 FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER)';

/** Renders the reviewed migration body. Kept deterministic for code review diffs. */
export function renderMigration(catalog, derived) {
  const lines = [];
  lines.push(
    '-- 022: least-privilege API runtime role. Generated by scripts/runtime-privileges.mjs from',
    '-- the API SQL inventory and trigger bodies, then reviewed. Do not edit after release; add a',
    '-- new migration when code needs a different privilege (tests fail until it exists).',
    '',
    '-- Group role only; logins are created per database by scripts/runtime-role.mjs. Attributes',
    '-- are defaults (no superuser-only ALTER), and a pre-existing elevated role stops the migration.',
    'DO $$ BEGIN',
    "  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'noxh_app') THEN",
    '    CREATE ROLE noxh_app NOLOGIN NOINHERIT;',
    "  ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'noxh_app' AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication OR rolinherit)) THEN",
    "    RAISE EXCEPTION 'existing role noxh_app has elevated or login attributes; review manually';",
    '  END IF;',
    'END $$;',
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
    "DO $$ BEGIN EXECUTE pg_catalog.format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', pg_catalog.current_database()); END $$;",
    'GRANT USAGE ON SCHEMA public, identity_private TO noxh_app;',
    '',
    '-- Organizations each runtime login serves in this database. Only the migration owner writes it.',
    'CREATE TABLE identity_private.instance_organizations (',
    '  runtime_role name NOT NULL,',
    '  organization_id uuid NOT NULL REFERENCES organizations(id),',
    '  registered_by text NOT NULL CHECK (length(registered_by) BETWEEN 1 AND 120),',
    '  registered_at timestamptz NOT NULL DEFAULT now(),',
    '  PRIMARY KEY (runtime_role, organization_id)',
    ');',
    'REVOKE ALL ON identity_private.instance_organizations FROM PUBLIC;',
    'GRANT SELECT ON identity_private.instance_organizations TO noxh_app;',
    'ALTER TABLE identity_private.instance_organizations ENABLE ROW LEVEL SECURITY;',
    'CREATE POLICY noxh_app_own_rows ON identity_private.instance_organizations FOR SELECT TO noxh_app USING (runtime_role = CURRENT_USER);',
    '',
    '-- Lock-only tables: SELECT ... FOR UPDATE needs an UPDATE privilege, but the runtime never',
    '-- updates them. A one-column grant plus this trigger keeps the lock and rejects the write.',
    'CREATE FUNCTION identity_private.reject_runtime_update() RETURNS trigger LANGUAGE plpgsql',
    `SET search_path = ${FUNCTION_SEARCH_PATH} AS $$`,
    'BEGIN',
    '  IF NOT (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = CURRENT_USER)',
    "     AND pg_catalog.pg_has_role(CURRENT_USER, 'noxh_app', 'USAGE') THEN",
    "    RAISE EXCEPTION 'runtime role may lock but not update %', TG_TABLE_NAME USING ERRCODE = '42501';",
    '  END IF;',
    '  RETURN NEW;',
    'END $$;',
    '',
    '-- Trigger functions run as the invoker; pin their name resolution (pg_temp last).',
    'DO $$ DECLARE f regprocedure; BEGIN',
    '  FOR f IN SELECT p.oid::regprocedure FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace',
    "    WHERE n.nspname IN ('public', 'identity_private') AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype ORDER BY 1",
    '  LOOP',
    `    EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path = ${FUNCTION_SEARCH_PATH}', f);`,
    '  END LOOP;',
    'END $$;',
    '',
    '-- Table privileges (no TRUNCATE, REFERENCES, TRIGGER or ownership); UPDATE is per column.',
  );
  const byName = new Map(catalog.tables.map((t) => [t.table_name, t]));
  for (const [table, { privileges, updateColumns, lockOnly }] of derived.tables) {
    const list = [...privileges].sort();
    if (table === 'public.schema_migrations') {
      // Created by scripts/migrate.mjs, absent when tests apply migration files directly.
      lines.push(
        `DO $$ BEGIN IF pg_catalog.to_regclass('public.schema_migrations') IS NOT NULL THEN GRANT ${list.join(', ')} ON "public"."schema_migrations" TO noxh_app; END IF; END $$;`,
      );
      continue;
    }
    if (list.length) lines.push(`GRANT ${list.join(', ')} ON ${q(table)} TO noxh_app;`);
    const columns = lockOnly ? [lockColumn(byName.get(table).columns)] : [...updateColumns].sort();
    if (columns.length)
      lines.push(
        `GRANT UPDATE (${columns.map((c) => '"' + c + '"').join(', ')}) ON ${q(table)} TO noxh_app;`,
      );
    if (lockOnly)
      lines.push(
        `CREATE TRIGGER runtime_lock_only BEFORE UPDATE ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION identity_private.reject_runtime_update();`,
      );
  }
  for (const s of derived.sequences) lines.push(`GRANT USAGE ON SEQUENCE ${q(s)} TO noxh_app;`);
  lines.push(
    '',
    '-- Row-level security for the runtime role on every table: rows of organizations registered',
    '-- for the current login, narrowed to app.organization_id when a transaction pins it.',
  );
  for (const t of catalog.tables) {
    const name = t.table_name;
    if (OWNER_ONLY_TABLES.includes(name) || name === 'public.schema_migrations') continue;
    let expr;
    if (name === 'public.organizations') expr = scopeExpression('id');
    else if (t.has_org) expr = scopeExpression('organization_id');
    else if (GLOBAL_TABLES.includes(name)) expr = REGISTERED_LOGIN;
    else if (PARENT_SCOPED_TABLES[name]) expr = PARENT_SCOPED_TABLES[name];
    else throw new Error('Table has no runtime RLS rule: ' + name);
    lines.push(
      `ALTER TABLE ${q(name)} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${q(name)} FORCE ROW LEVEL SECURITY;`,
      `CREATE POLICY noxh_app_scope ON ${q(name)} TO noxh_app USING (${expr}) WITH CHECK (${expr});`,
      `CREATE POLICY noxh_app_guard ON ${q(name)} AS RESTRICTIVE TO noxh_app USING (${expr}) WITH CHECK (${expr});`,
    );
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import('pg');
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL (migration owner, disposable) required');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const query = async (text, values) => (await pool.query(text, values)).rows;
    const catalog = await readCatalog(query);
    const derived = await deriveRuntimePrivileges(catalog);
    if (process.argv.includes('--sql')) process.stdout.write(renderMigration(catalog, derived));
    else
      console.log(
        JSON.stringify(
          {
            statements: derived.statements,
            tables: Object.fromEntries(
              [...derived.tables].map(([k, v]) => [
                k,
                {
                  privileges: [...v.privileges].sort(),
                  updateColumns: [...v.updateColumns].sort(),
                  lockOnly: v.lockOnly,
                },
              ]),
            ),
            sequences: derived.sequences,
          },
          null,
          2,
        ),
      );
  } finally {
    await pool.end();
  }
}
