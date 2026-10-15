import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { nativeKernelsAvailable } from './native-kernel';
import { Pool } from 'pg';
import { createClient } from 'redis';
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
    };
    try {
      await this.pool.query('SELECT 1');
      checks.postgres = true;
      const r = await this.pool.query(
        "SELECT version FROM schema_migrations WHERE version IN('001','002','003','004','005','006','007','008','009','010','011','012','013','014')",
      );
      checks.migration = r.rowCount === 14;
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
