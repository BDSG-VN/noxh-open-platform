import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { nativeKernelsAvailable } from './native-kernel';
import { Pool } from 'pg';
import { createClient } from 'redis';
/** Opt-in: readiness fails unless the API connects as a non-elevated member of noxh_app. */
export const requireLeastPrivilege = () => process.env.DATABASE_REQUIRE_LEAST_PRIVILEGE === 'true';

/** True only for a login that is not superuser/bypass/DDL-capable and inherits noxh_app. */
export async function leastPrivilege(pool: Pick<Pool, 'query'>): Promise<boolean> {
  const r = await pool.query(
    `SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
        AND pg_has_role(current_user,'noxh_app','USAGE')
        AND NOT has_schema_privilege('public','CREATE') AND NOT has_schema_privilege('identity_private','CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner=r.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_roles o WHERE (o.rolsuper OR o.rolbypassrls) AND pg_has_role(current_user,o.oid,'MEMBER'))
        AND EXISTS (SELECT 1 FROM identity_private.instance_organizations) AS ok
       FROM pg_roles r WHERE r.rolname=current_user`,
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
        "SELECT version FROM schema_migrations WHERE version IN('001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017','018','019','020','021','022')",
      );
      checks.migration = r.rowCount === 22;
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
