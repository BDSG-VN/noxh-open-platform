import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { nativeKernelsAvailable } from './native-kernel';
import { Pool } from 'pg';
import { createClient } from 'redis';
/** Opt-in: readiness fails unless the API connects as a non-elevated member of noxh_app. */
export const requireLeastPrivilege = () => process.env.DATABASE_REQUIRE_LEAST_PRIVILEGE === 'true';

/**
 * True only for a login that inherits noxh_app and nothing else elevated: not superuser/bypass,
 * no DDL or temporary objects, triggers enforced, and AUTH_ORGANIZATION_ID registered for it.
 * `node scripts/runtime-role.mjs verify` performs the exhaustive privilege comparison.
 */
export async function leastPrivilege(pool: Pick<Pool, 'query'>): Promise<boolean> {
  const r = await pool.query(
    `SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
        AND pg_has_role(current_user,'noxh_app','USAGE')
        AND NOT EXISTS (SELECT 1 FROM pg_roles g WHERE g.rolname NOT IN (current_user,'noxh_app') AND pg_has_role(current_user,g.oid,'MEMBER'))
        AND NOT has_schema_privilege('public','CREATE') AND NOT has_schema_privilege('identity_private','CREATE')
        AND NOT has_database_privilege(current_database(),'CREATE') AND NOT has_database_privilege(current_database(),'TEMPORARY')
        AND current_setting('session_replication_role') = 'origin'
        AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
        AND EXISTS (SELECT 1 FROM identity_private.instance_organizations i WHERE i.runtime_role=current_user AND i.organization_id::text=$1) AS ok
       FROM pg_roles r WHERE r.rolname=current_user`,
    [(process.env.AUTH_ORGANIZATION_ID ?? '').toLowerCase()],
  );
  return r.rows[0]?.ok === true;
}

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    max: 2,
  });
  async check() {
    const checks: Record<string, boolean> = {
      postgres: false,
      redis: false,
      migration: false,
      rust: false,
      ...(requireLeastPrivilege() ? { leastPrivilege: false } : {}),
    };
    try {
      await this.pool.query('SELECT 1');
      checks.postgres = true;
      const r = await this.pool.query(
        "SELECT version FROM schema_migrations WHERE version IN('001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','021','022','023','024')",
      );
      checks.migration = r.rowCount === 24;
      if (requireLeastPrivilege()) checks.leastPrivilege = await leastPrivilege(this.pool);
    } catch {
      /* readiness stays false; never expose connection errors */
    }
    checks.rust = await nativeKernelsAvailable();
    const client = createClient({
      url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      socket: { connectTimeout: 2000, reconnectStrategy: false },
    });
    client.on('error', () => {
      /* no connection secrets in logs */
    });
    try {
      await client.connect();
      checks.redis = (await client.ping()) === 'PONG';
    } catch {
      /* fail closed */
    } finally {
      if (client.isOpen) await client.destroy();
    }
    return { status: Object.values(checks).every(Boolean) ? 'ready' : 'not-ready', checks };
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
