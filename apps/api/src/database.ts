import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
export type Row = Record<string, unknown>;
export interface Sql {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
/**
 * Pool bounds. Every statement and every idle-in-transaction wait has a server-side deadline so a
 * stuck request or a lost client cannot hold a connection (and its row locks) indefinitely.
 */
export function poolOptions(env: NodeJS.ProcessEnv): PoolConfig {
  return {
    max: positive(env.DATABASE_POOL_MAX, 10),
    connectionTimeoutMillis: 3000,
    statement_timeout: positive(env.DATABASE_STATEMENT_TIMEOUT_MS, 30000),
    idle_in_transaction_session_timeout: positive(
      env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      60000,
    ),
  };
}
@Injectable()
export class Database implements OnModuleDestroy {
  private static readonly logger = new Logger('Database');
  private readonly pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ...poolOptions(process.env) })
    : undefined;
  testExecutor?: Sql;
  private queue: Promise<unknown> = Promise.resolve();
  constructor() {
    // An idle client that loses its connection emits on the pool; without a listener Node exits.
    this.pool?.on('error', (e) => Database.logger.warn('Idle connection error: ' + e.name));
  }
  get available() {
    return Boolean(this.pool || this.testExecutor);
  }
  async query(text: string, values: unknown[] = []): Promise<Row[]> {
    if (this.testExecutor) return (await this.testExecutor.query(text, values)).rows;
    if (!this.pool) throw new ServiceUnavailableException('Cơ sở dữ liệu chưa được cấu hình');
    return (await this.pool.query(text, values)).rows as Row[];
  }
  /** Rolls back after a failed unit of work; the original error always wins over a rollback error. */
  private static async rollback(sql: Sql, onFailure?: () => void): Promise<void> {
    try {
      await sql.query('ROLLBACK');
    } catch (e) {
      Database.logger.warn('Rollback failed: ' + (e instanceof Error ? e.name : 'unknown'));
      onFailure?.();
    }
  }
  async tx<T>(work: (sql: Sql) => Promise<T>): Promise<T> {
    if (this.testExecutor) {
      const execute = async () => {
        const sql = this.testExecutor!;
        await sql.query('BEGIN');
        try {
          const result = await work(sql);
          await sql.query('COMMIT');
          return result;
        } catch (e) {
          await Database.rollback(sql);
          throw e;
        }
      };
      const result = this.queue.then(execute);
      this.queue = result.catch(() => {});
      return result;
    }
    if (!this.pool) throw new ServiceUnavailableException('Cơ sở dữ liệu chưa được cấu hình');
    const c = await this.pool.connect();
    let broken = false;
    const sql: Sql = {
      query: async (text, values = []) => ({ rows: (await c.query(text, values)).rows as Row[] }),
    };
    try {
      await sql.query('BEGIN');
      const value = await work(sql);
      await sql.query('COMMIT');
      return value;
    } catch (e) {
      // A client whose rollback failed sits on a dead or unknown-state socket; the pool discards it.
      await Database.rollback(sql, () => (broken = true));
      throw e;
    } finally {
      c.release(broken ? new Error('rollback failed') : undefined);
    }
  }
  async onModuleDestroy() {
    await this.pool?.end();
  }
}
