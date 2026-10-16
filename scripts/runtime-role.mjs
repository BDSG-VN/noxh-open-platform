// Provision and verify the least-privilege PostgreSQL login the API/worker run as.
//
//   provision  (migration-owner DATABASE_URL)  create/align the login, grant noxh_app, register
//              AUTH_ORGANIZATION_ID as an organization this instance serves.
//   verify     (RUNTIME_DATABASE_URL)          prove from inside the runtime session that it is
//              not elevated and that RLS/grants are in force.
//
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
  // Printable ASCII only: SCRAM needs SASLprep for other characters, which is not implemented here.
  if (!/^[\x21-\x7e]{24,256}$/.test(password))
    fail('RUNTIME_DB_PASSWORD must be 24-256 printable ASCII characters');
  if (!UUID.test(organization)) fail('AUTH_ORGANIZATION_ID must be the instance organization UUID');
  const limit = Number(process.env.RUNTIME_DB_CONNECTION_LIMIT ?? 40);
  if (!Number.isInteger(limit) || limit < 2 || limit > 500)
    fail('RUNTIME_DB_CONNECTION_LIMIT must be an integer between 2 and 500');
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
    await client.query('SELECT pg_advisory_xact_lock(68280422)');
    const [owner] = (await client.query('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'))
      .rows;
    if (!owner?.rolsuper) refuse('Provisioning must run as the migration owner (superuser)');
    const migrated = await client.query("SELECT 1 FROM schema_migrations WHERE version='022'");
    if (!migrated.rowCount) refuse('Migration 022 is not applied');
    const existing = (
      await client.query(
        `SELECT r.oid, r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
                (SELECT count(*)::int FROM pg_class WHERE relowner=r.oid)
              + (SELECT count(*)::int FROM pg_namespace WHERE nspowner=r.oid)
              + (SELECT count(*)::int FROM pg_proc WHERE proowner=r.oid)
              + (SELECT count(*)::int FROM pg_type WHERE typowner=r.oid)
              + (SELECT count(*)::int FROM pg_database WHERE datdba=r.oid) AS owned,
                ARRAY(SELECT g.rolname::text FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid
                       WHERE m.member=r.oid AND g.rolname<>'noxh_app' ORDER BY 1) AS other_groups,
                ARRAY(SELECT u.rolname::text FROM pg_auth_members m JOIN pg_roles u ON u.oid=m.member
                       WHERE m.roleid=r.oid ORDER BY 1) AS members
           FROM pg_roles r WHERE r.rolname=$1`,
        [user],
      )
    ).rows[0];
    if (existing) {
      // Never silently demote a role that may be used for something else: require manual review.
      if (
        existing.rolsuper ||
        existing.rolbypassrls ||
        existing.rolcreaterole ||
        existing.rolreplication
      )
        refuse('Existing role is elevated; choose another RUNTIME_DB_USER or review manually');
      if (existing.owned) refuse('Existing role owns database objects; review manually');
      if (existing.other_groups.length || existing.members.length)
        refuse('Existing role has other memberships; review manually');
    }
    const verifier = scramVerifier(password);
    const attributes = `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT ${limit}`;
    await client.query(
      `${existing ? 'ALTER' : 'CREATE'} ROLE ${ident(user)} ${attributes} PASSWORD ${literal(verifier)}`,
    );
    await client.query(`GRANT noxh_app TO ${ident(user)}`);
    await client.query(`ALTER ROLE ${ident(user)} SET search_path TO public`);
    const org = await client.query('SELECT 1 FROM organizations WHERE id=$1', [organization]);
    if (!org.rowCount) refuse('The instance organization row does not exist yet');
    const registered = await client.query(
      "INSERT INTO identity_private.instance_organizations(organization_id,registered_by) VALUES($1,'runtime-role provision') ON CONFLICT DO NOTHING RETURNING organization_id",
      [organization],
    );
    const others = await client.query(
      'SELECT count(*)::int AS n FROM identity_private.instance_organizations WHERE organization_id<>$1',
      [organization],
    );
    if (harden) {
      const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
      await client.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${ident(db)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${ident(db)} TO noxh_app`);
    }
    await client.query('COMMIT');
    console.log(
      JSON.stringify({
        status: 'PASS',
        action: existing ? 'updated' : 'created',
        role: user,
        group: 'noxh_app',
        organizationRegistered: registered.rowCount === 1 ? 'new' : 'existing',
        otherInstanceOrganizations: others.rows[0].n,
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

async function verify() {
  const url = process.env.RUNTIME_DATABASE_URL;
  if (!url) fail('RUNTIME_DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const checks = {};
  try {
    const [r] = (
      await client.query(
        `SELECT r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole, r.rolreplication,
                pg_has_role(current_user,'noxh_app','USAGE') AS app_member,
                current_user = session_user AS session_is_login,
                NOT EXISTS (SELECT 1 FROM pg_class WHERE relowner=r.oid) AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datdba=r.oid) AS owns_nothing,
                NOT has_schema_privilege('public','CREATE') AND NOT has_schema_privilege('identity_private','CREATE') AS no_ddl,
                has_database_privilege(current_database(),'TEMPORARY') AS can_temp
           FROM pg_roles r WHERE r.rolname=current_user`,
      )
    ).rows;
    checks.notSuperuser = !r.rolsuper;
    checks.noBypassRls = !r.rolbypassrls;
    checks.noCreateDbOrRole = !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication;
    checks.memberOfNoxhApp = r.app_member;
    checks.ownsNothing = r.owns_nothing;
    checks.noDdl = r.no_ddl;
    const [owners] = (
      await client.query(
        "SELECT count(*)::int AS n FROM pg_roles o WHERE (o.rolsuper OR o.rolbypassrls) AND pg_has_role(current_user,o.oid,'MEMBER')",
      )
    ).rows;
    checks.cannotAssumeElevatedRole = owners.n === 0;
    const [rls] = (
      await client.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE c.relkind='r' AND n.nspname IN ('public','identity_private')
            AND c.relname NOT IN ('schema_migrations','instance_organizations')
            AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      )
    ).rows;
    checks.rlsForcedEverywhere = rls.n === 0;
    const [scope] = (
      await client.query('SELECT count(*)::int AS n FROM identity_private.instance_organizations')
    ).rows;
    checks.instanceOrganizationRegistered = scope.n >= 1;
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
    console.log(
      JSON.stringify({
        status: ok ? 'PASS' : 'FAIL',
        checks,
        temporaryTablesAllowed: r.can_temp,
        sessionIsLogin: r.session_is_login,
      }),
    );
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
