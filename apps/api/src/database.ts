import { Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';
export type Row = Record<string, unknown>;
export interface Sql {
  query(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}
@Injectable()
export class Database implements OnModuleDestroy {
  private readonly pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        connectionTimeoutMillis: 3000,
      })
    : undefined;
  testExecutor?: Sql;
  private queue: Promise<unknown> = Promise.resolve();
  get available() {
    return Boolean(this.pool || this.testExecutor);
  }
  async query(text: string, values: unknown[] = []): Promise<Row[]> {
    if (this.testExecutor) return (await this.testExecutor.query(text, values)).rows;
    if (!this.pool) throw new ServiceUnavailableException('Cơ sở dữ liệu chưa được cấu hình');
    return (await this.pool.query(text, values)).rows as Row[];
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
          await sql.query('ROLLBACK');
          throw e;
        }
      };
      const result = this.queue.then(execute);
      this.queue = result.catch(() => {});
      return result;
    }
    if (!this.pool) throw new ServiceUnavailableException('Cơ sở dữ liệu chưa được cấu hình');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const value = await work({
        query: async (text, values = []) => ({ rows: (await c.query(text, values)).rows as Row[] }),
      });
      await c.query('COMMIT');
      return value;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool?.end();
  }
}
