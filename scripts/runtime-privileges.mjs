// Derives the least-privilege grant set for the API runtime database role (noxh_app) from the
// SQL the API actually issues plus the SECURITY INVOKER trigger bodies those writes fire.
// The committed migration 022 is the reviewed output; tests recompute the derivation and fail
// when code needs a privilege the migrations do not grant, or a grant is no longer needed.
import { sqlInventory, requiredPrivileges } from './sql-inventory.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const RUNTIME_GROUP = 'noxh_app';
/** Tables the runtime role must never write even if code paths are added later. */
export const RUNTIME_SCHEMAS = ['public', 'identity_private'];
/** Owner-managed bookkeeping that the runtime only reads or never touches. */
export const OWNER_ONLY_TABLES = ['identity_private.instance_organizations'];
/** No organization column; access is instance-global and limited to digests/expiry metadata. */
export const GLOBAL_TABLES = [
  'identity_private.auth_limits',
  'identity_private.revoked_staff_sessions',
];
/** No organization column; scoped through the parent application row visible under RLS. */
export const PARENT_SCOPED_TABLES = {
  'public.application_generated_forms':
    'EXISTS (SELECT 1 FROM public.applications a WHERE a.id = application_id)',
};

const lockClause =
  /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)(?:\s+OF\s+[a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)?(?:\s+(?:NOWAIT|SKIP\s+LOCKED))?/gi;

/** Catalog facts needed for derivation; queried with the migration owner connection. */
export async function readCatalog(query) {
  const triggers = await query(
    `
    SELECT n.nspname || '.' || c.relname AS table_name,
           t.tgtype::int AS tgtype,
           p.prosrc AS body,
           p.prosecdef AS security_definer
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND n.nspname = ANY($1)`,
    [RUNTIME_SCHEMAS],
  );
  const tables = await query(
    `
    SELECT n.nspname || '.' || c.relname AS table_name,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 1) AS first_column,
           EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped) AS has_org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','p') AND n.nspname = ANY($1)
     ORDER BY 1`,
    [RUNTIME_SCHEMAS],
  );
  const sequences = await query(
    `
    SELECT sn.nspname || '.' || s.relname AS sequence_name, tn.nspname || '.' || t.relname AS table_name
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
 * @returns {{ tables: Map<string,{privileges:Set<string>, lockOnly:boolean}>, sequences: string[], statements: number }}
 */
export async function deriveRuntimePrivileges(catalog) {
  const { statements, dynamic } = await sqlInventory();
  if (dynamic.some((d) => !d.location.startsWith('apps/api/src/database.ts')))
    throw new Error('Unresolvable SQL in API source: ' + dynamic.map((d) => d.location).join(', '));
  const need = new Map();
  const realUpdate = new Set();
  const add = (table, privilege) => {
    if (!need.has(table)) need.set(table, new Set());
    need.get(table).add(privilege);
  };
  const absorb = (sql) => {
    for (const [t, p] of requiredPrivileges(sql)) add(t, p);
    for (const [t, p] of requiredPrivileges(sql.replace(lockClause, ' ')))
      if (p === 'UPDATE') realUpdate.add(t);
  };
  for (const { sql } of statements) absorb(sql);
  // Trigger functions are SECURITY INVOKER: their statements run with the runtime privileges.
  // Iterate until stable because a trigger can write a table that has its own trigger.
  for (let changed = true; changed; ) {
    changed = false;
    for (const t of catalog.triggers) {
      if (t.security_definer)
        throw new Error('SECURITY DEFINER trigger needs explicit review: ' + t.table_name);
      const privileges = need.get(t.table_name);
      if (!privileges) continue;
      const fires =
        (t.tgtype & TRIGGER_INSERT && privileges.has('INSERT')) ||
        (t.tgtype & TRIGGER_DELETE && privileges.has('DELETE')) ||
        (t.tgtype & TRIGGER_UPDATE && realUpdate.has(t.table_name));
      if (!fires) continue;
      const before = JSON.stringify([...need].map(([k, v]) => [k, [...v]]));
      absorb(t.body);
      if (JSON.stringify([...need].map(([k, v]) => [k, [...v]])) !== before) changed = true;
    }
  }
  const known = new Set(catalog.tables.map((t) => t.table_name));
  known.add('public.schema_migrations');
  const unknown = [...need.keys()].filter((t) => !known.has(t));
  if (unknown.length) throw new Error('SQL references unknown tables: ' + unknown.join(', '));
  const tables = new Map();
  for (const [table, privileges] of [...need].sort(([a], [b]) => a.localeCompare(b))) {
    if (OWNER_ONLY_TABLES.includes(table)) {
      // Readable for scope checks (granted with the table itself); never writable at runtime.
      if ([...privileges].some((p) => p !== 'SELECT'))
        throw new Error('Runtime SQL must not write ' + table);
      continue;
    }
    tables.set(table, {
      privileges,
      lockOnly: privileges.has('UPDATE') && !realUpdate.has(table),
    });
  }
  const sequences = catalog.sequences
    .filter((s) => tables.get(s.table_name)?.privileges.has('INSERT'))
    .map((s) => s.sequence_name);
  return { tables, sequences, statements: statements.length };
}

const q = (name) =>
  name
    .split('.')
    .map((p) => '"' + p + '"')
    .join('.');

/** Renders the reviewed migration body. Kept deterministic for code review diffs. */
export function renderMigration(catalog, derived) {
  const lines = [];
  const scope = (expr) => `identity_private.instance_scope_allows(${expr})`;
  lines.push(
    '-- 022: least-privilege API runtime role. Generated by scripts/runtime-privileges.mjs from',
    '-- the API SQL inventory and trigger bodies, then reviewed. Do not edit after release; add a',
    '-- new migration when code needs a different privilege (tests fail until it exists).',
    '',
    "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='noxh_app') THEN",
    '  CREATE ROLE noxh_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;',
    'END IF; END $$;',
    'ALTER ROLE noxh_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;',
    'REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
    'GRANT USAGE ON SCHEMA public, identity_private TO noxh_app;',
    '',
    '-- Organizations this instance serves. Only the migration owner/operator writes it.',
    'CREATE TABLE identity_private.instance_organizations (',
    '  organization_id uuid PRIMARY KEY REFERENCES organizations(id),',
    '  registered_by text NOT NULL CHECK (length(registered_by) BETWEEN 1 AND 120),',
    '  registered_at timestamptz NOT NULL DEFAULT now()',
    ');',
    'REVOKE ALL ON identity_private.instance_organizations FROM PUBLIC;',
    'GRANT SELECT ON identity_private.instance_organizations TO noxh_app;',
    '',
    '-- Row allowed when its organization is served by this instance and, if the transaction pinned',
    '-- app.organization_id, equals that pin. SECURITY INVOKER and schema-qualified on purpose.',
    'CREATE FUNCTION identity_private.instance_scope_allows(org uuid) RETURNS boolean',
    'LANGUAGE sql STABLE PARALLEL SAFE AS $$',
    '  SELECT EXISTS (SELECT 1 FROM identity_private.instance_organizations i WHERE i.organization_id = org)',
    "     AND (nullif(current_setting('app.organization_id', true), '') IS NULL",
    "          OR org = nullif(current_setting('app.organization_id', true), '')::uuid)",
    '$$;',
    'REVOKE ALL ON FUNCTION identity_private.instance_scope_allows(uuid) FROM PUBLIC;',
    'GRANT EXECUTE ON FUNCTION identity_private.instance_scope_allows(uuid) TO noxh_app;',
    '',
    '-- Lock-only tables: SELECT ... FOR UPDATE needs an UPDATE privilege, but the runtime never',
    '-- updates them. A one-column grant plus this trigger keeps the lock and rejects the write.',
    'CREATE FUNCTION identity_private.reject_runtime_update() RETURNS trigger LANGUAGE plpgsql AS $$',
    'BEGIN',
    '  IF NOT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user)',
    "     AND pg_has_role(current_user, 'noxh_app', 'MEMBER') THEN",
    "    RAISE EXCEPTION 'runtime role may lock but not update %', TG_TABLE_NAME USING ERRCODE = '42501';",
    '  END IF;',
    '  RETURN NEW;',
    'END $$;',
    '',
    '-- Table privileges (no TRUNCATE, REFERENCES, TRIGGER or ownership).',
  );
  const byName = new Map(catalog.tables.map((t) => [t.table_name, t]));
  for (const [table, { privileges, lockOnly }] of derived.tables) {
    const list = [...privileges].filter((p) => !(lockOnly && p === 'UPDATE')).sort();
    if (table === 'public.schema_migrations') {
      // Created by scripts/migrate.mjs, absent when tests apply migration files directly.
      lines.push(
        `DO $$ BEGIN IF to_regclass('public.schema_migrations') IS NOT NULL THEN GRANT ${list.join(', ')} ON "public"."schema_migrations" TO noxh_app; END IF; END $$;`,
      );
      continue;
    }
    if (list.length) lines.push(`GRANT ${list.join(', ')} ON ${q(table)} TO noxh_app;`);
    if (lockOnly) {
      const column = byName.get(table)?.first_column;
      if (!column) throw new Error('No column for lock grant on ' + table);
      lines.push(`GRANT UPDATE (${q(column)}) ON ${q(table)} TO noxh_app;`);
      lines.push(
        `CREATE TRIGGER runtime_lock_only BEFORE UPDATE ON ${q(table)} FOR EACH ROW EXECUTE FUNCTION identity_private.reject_runtime_update();`,
      );
    }
  }
  for (const s of derived.sequences) lines.push(`GRANT USAGE ON SEQUENCE ${q(s)} TO noxh_app;`);
  lines.push('', '-- Row-level security for the runtime role on every table.');
  for (const t of catalog.tables) {
    const name = t.table_name;
    if (OWNER_ONLY_TABLES.includes(name) || name === 'public.schema_migrations') continue;
    let expr;
    if (name === 'public.organizations') expr = scope('id');
    else if (t.has_org) expr = scope('organization_id');
    else if (GLOBAL_TABLES.includes(name)) expr = 'true';
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
                { privileges: [...v.privileges].sort(), lockOnly: v.lockOnly },
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
