import { Injectable, OnModuleDestroy } from '@nestjs/common';
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
    const checks: Record<string, boolean> = { postgres: false, redis: false, migration: false };
    try {
      await this.pool.query('SELECT 1');
      checks.postgres = true;
      const r = await this.pool.query("SELECT version FROM schema_migrations WHERE version='001'");
      checks.migration = r.rowCount === 1;
    } catch {
      /* readiness stays false; never expose connection errors */
    }
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
