// Provision and verify the least-privilege PostgreSQL login the API/worker run as.
//
//   provision  (migration-owner DATABASE_URL)  create/align one login for THIS database, grant
//              noxh_app, register AUTH_ORGANIZATION_ID for that login.
//   verify     (RUNTIME_DATABASE_URL)          prove from inside the runtime session that it is
//              not elevated and that RLS/grants are in force.
//
// One login serves exactly one database: a login with a footprint in another database is refused.
// The password is read from RUNTIME_DB_PASSWORD and sent only as a SCRAM-SHA-256 verifier, so the
// plaintext never appears in SQL text or server logs. Output is JSON without secrets.
import pg from 'pg';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE = /^[a-z_][a-z0-9_]{2,62}$/;
const RESERVED = new Set(['noxh_app', 'noxh_runtime', 'noxh_owner', 'postgres', 'public']);

export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

function fail(message, details = {}) {
  console.log(JSON.stringify({ status: 'FAIL', message, ...details }));
  process.exit(1);
}

function config() {
  const user = process.env.RUNTIME_DB_USER ?? 'noxh_api';
  const password = process.env.RUNTIME_DB_PASSWORD ?? '';
  const organization = (process.env.AUTH_ORGANIZATION_ID ?? '').toLowerCase();
  if (!ROLE.test(user) || RESERVED.has(user)) fail('RUNTIME_DB_USER must be a dedicated role name');
  // URL-safe unreserved characters only: no SASLprep needed and safe inside DATABASE_URL.
  if (!/^[A-Za-z0-9._~-]{24,256}$/.test(password))
    fail('RUNTIME_DB_PASSWORD must be 24-256 characters from A-Z a-z 0-9 . _ ~ -');
  if (!UUID.test(organization)) fail('AUTH_ORGANIZATION_ID must be the instance organization UUID');
  const limit = Number(process.env.RUNTIME_DB_CONNECTION_LIMIT ?? 100);
  if (!Number.isInteger(limit) || limit < 4 || limit > 1000)
    fail('RUNTIME_DB_CONNECTION_LIMIT must be an integer between 4 and 1000');
  return { user, password, organization, limit };
}

const ident = (name) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";

async function provision() {
  const { user, password, organization, limit } = config();
  if (!process.env.DATABASE_URL) fail('DATABASE_URL (migration owner) is required');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const harden = process.argv.includes('--harden-database');
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query('SELECT pg_advisory_xact_lock(68280422)');
    const [owner] = (
      await client.query(
        `SELECT r.rolsuper, r.rolcreaterole,
                EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('identity_private.instance_organizations') AND c.relowner = r.oid) AS owns_scope
           FROM pg_roles r WHERE r.rolname = current_user`,
      )
    ).rows;
    if (!owner?.owns_scope && !owner?.rolsuper)
      refuse('Provisioning must run as the migration owner (owner of instance_organizations)');
    if (!owner.rolsuper && !owner.rolcreaterole)
      refuse('The migration owner needs SUPERUSER or CREATEROLE to manage the runtime login');
    const migrated = await client.query("SELECT 1 FROM schema_migrations WHERE version='022'");
    if (!migrated.rowCount) refuse('Migration 022 is not applied');
    const existing = (
      await client.query(
        `SELECT r.oid, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
                (SELECT count(*)::int FROM pg_shdepend d
                  WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r.oid
                    AND NOT (d.classid = 'pg_database'::regclass AND d.deptype = 'a'
                             AND d.objid = (SELECT oid FROM pg_database WHERE datname = current_database()))) AS footprint,
                (SELECT count(*)::int FROM pg_db_role_setting s
                  WHERE s.setrole = r.oid AND s.setdatabase NOT IN (0, (SELECT oid FROM pg_database WHERE datname = current_database()))) AS other_databases,
                (SELECT count(*)::int FROM pg_auth_members m JOIN pg_roles g ON g.oid = m.roleid
                  WHERE m.member = r.oid AND (g.rolname <> 'noxh_app' OR m.admin_option)) AS other_groups,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = r.oid) AS members
           FROM pg_roles r WHERE r.rolname = $1`,
        [user],
      )
    ).rows[0];
    if (existing) {
      // Never silently demote or repurpose a role: anything unexpected needs manual review.
      if (
        existing.rolsuper ||
        existing.rolbypassrls ||
        existing.rolcreatedb ||
        existing.rolcreaterole ||
        existing.rolreplication
      )
        refuse('Existing role is elevated; choose another RUNTIME_DB_USER or review manually');
      if (existing.other_databases)
        refuse('Login already serves another database; use one login per database');
      if (existing.footprint)
        refuse(
          'Existing role owns objects or holds direct privileges (any database); review manually',
        );
      if (existing.other_groups || existing.members)
        refuse('Existing role has other memberships; review manually');
    }
    const verifier = scramVerifier(password);
    // Only default-safe attributes: works for a CREATEROLE (non-superuser) migration owner too.
    const attributes = `LOGIN INHERIT CONNECTION LIMIT ${limit}`;
    await client.query(
      `${existing ? 'ALTER' : 'CREATE'} ROLE ${ident(user)} ${attributes} PASSWORD ${literal(verifier)}`,
    );
    const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
    await client.query(`ALTER ROLE ${ident(user)} RESET ALL`);
    await client.query(`ALTER ROLE ${ident(user)} IN DATABASE ${ident(db)} RESET ALL`);
    // Also marks the login as belonging to this database (checked on every later provision).
    await client.query(
      `ALTER ROLE ${ident(user)} IN DATABASE ${ident(db)} SET search_path TO public`,
    );
    await client.query(`GRANT noxh_app TO ${ident(user)}`);
    const org = await client.query('SELECT 1 FROM organizations WHERE id=$1', [organization]);
    if (!org.rowCount) refuse('The instance organization row does not exist yet');
    const registered = await client.query(
      "INSERT INTO identity_private.instance_organizations(runtime_role,organization_id,registered_by) VALUES($1,$2,'runtime-role provision') ON CONFLICT DO NOTHING RETURNING organization_id",
      [user, organization],
    );
    const others = await client.query(
      'SELECT count(*)::int AS n FROM identity_private.instance_organizations WHERE runtime_role=$1 AND organization_id<>$2',
      [user, organization],
    );
    if (harden) {
      await client.query(`REVOKE CONNECT ON DATABASE ${ident(db)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO ${ident(user)}`);
    }
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        status: 'PASS',
        action: existing ? 'updated' : 'created',
        role: user,
        group: 'noxh_app',
        organizationRegistered: registered.rowCount === 1 ? 'new' : 'existing',
        otherOrganizationsForLogin: others.rows[0].n,
        databaseHardened: harden,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof Refusal) fail(error.message + '; transaction rolled back');
    // Never echo statements: they carry the password verifier.
    fail('Provisioning failed; transaction rolled back', { code: error?.code ?? 'unknown' });
  } finally {
    await client.end();
  }
}

/** Checks shared with /health/ready (apps/api/src/health.ts mirrors the core subset). */
const VERIFY_SQL = `
SELECT NOT r.rolsuper AS "notSuperuser",
       NOT r.rolbypassrls AS "noBypassRls",
       NOT (r.rolcreatedb OR r.rolcreaterole OR r.rolreplication) AS "noCreateDbRoleReplication",
       pg_has_role(current_user, 'noxh_app', 'USAGE') AS "memberOfNoxhApp",
       NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname NOT IN (current_user, 'noxh_app')
                    AND pg_has_role(current_user, g.oid, 'MEMBER')) AS "noOtherMemberships",
       NOT EXISTS (SELECT 1 FROM pg_shdepend d WHERE d.refclassid = 'pg_authid'::regclass AND d.refobjid = r.oid AND d.deptype = 'o') AS "ownsNothing",
       NOT has_schema_privilege('public', 'CREATE') AND NOT has_schema_privilege('identity_private', 'CREATE')
         AND NOT has_database_privilege(current_database(), 'CREATE') AS "noDdl",
       NOT has_database_privilege(current_database(), 'TEMPORARY') AS "noTemporaryObjects",
       current_setting('session_replication_role') = 'origin' AS "triggersEnforced",
       NOT EXISTS (SELECT 1 FROM pg_db_role_setting s WHERE s.setrole = r.oid AND (s.setdatabase <> (SELECT oid FROM pg_database WHERE datname = current_database())
                    OR s.setconfig <> ARRAY['search_path=public'])) AS "roleSettingsPinned",
       EXISTS (SELECT 1 FROM identity_private.instance_organizations i WHERE i.runtime_role = current_user) AS "organizationRegistered"
  FROM pg_roles r WHERE r.rolname = current_user`;

async function verify() {
  const url = process.env.RUNTIME_DATABASE_URL;
  if (!url) fail('RUNTIME_DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const checks = (await client.query(VERIFY_SQL)).rows[0];
    const org = (process.env.AUTH_ORGANIZATION_ID ?? '').toLowerCase();
    if (UUID.test(org))
      checks.authOrganizationRegistered =
        (
          await client.query(
            'SELECT 1 FROM identity_private.instance_organizations WHERE runtime_role=current_user AND organization_id=$1',
            [org],
          )
        ).rowCount === 1;
    const [rls] = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname IN ('public','identity_private')
            AND c.relname NOT IN ('schema_migrations','instance_organizations')
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      )
    ).rows;
    checks.rlsForcedEverywhere = rls.n === 0;
    // Effective privileges must come only from noxh_app (no direct table/column grants).
    const [extra] = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
          WHERE c.relkind IN ('r','p','v','m') AND n.nspname IN ('public','identity_private')
            AND has_table_privilege(c.oid, p) AND NOT has_table_privilege('noxh_app', c.oid, p)`,
      )
    ).rows;
    const [extraColumns] = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
           CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p
          WHERE c.relkind='r' AND n.nspname IN ('public','identity_private') AND a.attnum>0 AND NOT a.attisdropped
            AND has_column_privilege(c.oid, a.attnum, p) AND NOT has_column_privilege('noxh_app', c.oid, a.attnum, p)`,
      )
    ).rows;
    checks.privilegesOnlyFromNoxhApp = extra.n === 0 && extraColumns.n === 0;
    const [truncate] = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname IN ('public','identity_private')
            AND (has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER'))`,
      )
    ).rows;
    checks.noTruncateReferencesTrigger = truncate.n === 0;
    const [migrations] = (
      await client.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version='022'")
    ).rows;
    checks.migration022Visible = migrations.n === 1;
    const ok = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ status: ok ? 'PASS' : 'FAIL', checks }));
    if (!ok) process.exitCode = 1;
  } catch (error) {
    fail('Verification query failed', { code: error?.code ?? 'unknown' });
  } finally {
    await client.end();
  }
}

const command = process.argv[2];
if (command === 'provision') await provision();
else if (command === 'verify') await verify();
else fail('Usage: node scripts/runtime-role.mjs provision [--harden-database] | verify');
