/** Connection-pool hardening from the 2026-10-17 review: no masked rollback errors, no crash on idle-client errors. */
import { afterEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Database, poolOptions } from './database';

const original = { ...process.env };
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
});

describe('transactions', () => {
  it('rethrows the work error when ROLLBACK itself fails', async () => {
    const db = new Database();
    const seen: string[] = [];
    db.testExecutor = {
      async query(text: string) {
        seen.push(text);
        if (text === 'ROLLBACK') throw new Error('connection terminated');
        return { rows: [] };
      },
    };
    await expect(
      db.tx(async () => {
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(seen).toEqual(['BEGIN', 'ROLLBACK']);
    // The serialized queue stays usable after a failed rollback.
    await expect(db.tx(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('pool', () => {
  it('attaches an error listener so an idle client error cannot crash the process', () => {
    process.env.DATABASE_URL = 'postgresql://user@127.0.0.1:1/never';
    const db = new Database();
    const pool = Reflect.get(db, 'pool') as EventEmitter;
    expect(pool.listenerCount('error')).toBe(1);
    expect(() => pool.emit('error', new Error('idle client lost'))).not.toThrow();
  });
  it('bounds statements and idle transactions by default and accepts overrides', () => {
    expect(poolOptions({})).toMatchObject({
      max: 10,
      connectionTimeoutMillis: 3000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 60000,
    });
    expect(
      poolOptions({
        DATABASE_POOL_MAX: '4',
        DATABASE_STATEMENT_TIMEOUT_MS: '5000',
        DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: '9000',
      }),
    ).toMatchObject({ max: 4, statement_timeout: 5000, idle_in_transaction_session_timeout: 9000 });
    // Malformed values fall back to the defaults instead of disabling the bound.
    expect(poolOptions({ DATABASE_STATEMENT_TIMEOUT_MS: 'forever' }).statement_timeout).toBe(30000);
    expect(poolOptions({ DATABASE_STATEMENT_TIMEOUT_MS: '0' }).statement_timeout).toBe(30000);
  });
});
