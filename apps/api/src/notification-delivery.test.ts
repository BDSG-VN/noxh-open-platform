/** Worker-driven external delivery (migration 023) on embedded PostgreSQL with fake providers only. */
import 'reflect-metadata';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Database, type Row } from './database';
import type { NotificationTransport } from './notification-service';
import { NotificationDeliveryService } from './notification-delivery-service';
import { NotificationDeliveryLifecycle } from './notification-delivery-lifecycle';
import {
  EmailSmtpAdapter,
  ZaloOaAdapter,
  NotificationProviderError,
} from './notification-transports';
import { PrivacyService } from './privacy-service';
import { seal, unseal } from './identity-crypto';
import { accepted, emailProvider, zaloProvider, ready as makeReady } from './test-notification';
import { startFakeSmtp, testCertificate, type FakeSmtp, type TestCertificate } from './test-smtp';
const prior = { ...process.env };
let pg: PGlite, db: Database;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
}, 90000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
afterEach(() => {
  delete process.env.NOTIFICATIONS_EXTERNAL_ENABLED;
  delete process.env.AUTH_ORGANIZATION_ID;
});
const SECRETS = ['NEVER-LOGGED', 'sink@synthetic.example', '84900000', 'Dự án giả lập'];
const mock = (
  channel: 'email' | 'zalo',
  send: NotificationTransport['send'],
): NotificationTransport => ({ channel, supportsIdempotency: true, send });
/** Flag on, provider entered by the admin, channel enabled by the independent privacy officer. */
async function external(
  channel: 'email' | 'zalo',
  adapter: NotificationTransport,
  maxAttempts = 3,
) {
  const f = await makeReady(db, channel);
  const id = 'test-' + channel;
  f.svc.transports.set(id, adapter);
  const delivery = new NotificationDeliveryService(db, f.svc);
  delivery.backoffMs = () => 0;
  delivery.circuitOpenMs = () => 60000;
  delivery.sendDeadlineMs = 300;
  const logs: Record<string, unknown>[] = [];
  delivery.log = (entry) => logs.push(entry);
  process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'true';
  process.env.AUTH_ORGANIZATION_ID = f.org;
  await delivery.configureProvider(
    f.maker,
    channel,
    channel === 'email' ? emailProvider(id) : zaloProvider(id, '84900000002'),
    0,
  );
  await f.svc.configure(
    f.reviewer,
    f.project,
    { channel, enabled: true, adapterId: id, maxAttempts, accepted: true },
    0,
  );
  const queue = async () => {
    const m = await f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() });
    return f.svc.deliver(f.maker, f.project, m.id, accepted, m.version);
  };
  const job = async (id: string) =>
    (
      await db.query('SELECT * FROM identity_private.notification_deliveries WHERE message_id=$1', [
        id,
      ])
    )[0]!;
  const message = async (id: string) =>
    (await f.svc.workspace(f.maker, f.project)).messages.find((m) => m.id === id)!;
  return { ...f, delivery, logs, queue, job, message, adapterId: id };
}

it('retries retryable provider failures with backoff, dead-letters after the approved budget and allows one bounded operator requeue', async () => {
  const calls: string[] = [];
  let mode: 'retryable' | 'accept' = 'retryable';
  const f = await external(
    'email',
    mock('email', async (input) => {
      calls.push(input.idempotencyKey);
      if (mode === 'retryable') throw new NotificationProviderError('retryable', 'smtp-451');
      return { accepted: true, deliveryRef: 'smtp:queued as synthetic-' + calls.length };
    }),
    2,
  );
  f.delivery.backoffMs = (attempt) => 60000 * attempt;
  const a = await f.queue();
  expect(a.status).toBe('queued');
  let batch = await f.delivery.runConfiguredBatch();
  expect(batch).toMatchObject({ claimed: 1, failed: 1, deadLettered: 0 });
  expect((await f.message(a.id)).status).toBe('failed');
  const retry = await f.job(a.id);
  expect(retry).toMatchObject({ status: 'queued', reason: 'provider_unavailable' });
  // Backoff: the next attempt is scheduled in the future, so nothing is claimable right now.
  expect(new Date(String(retry.next_attempt_at)).getTime()).toBeGreaterThan(Date.now() + 30000);
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 0 });
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 2)).resolves.toMatchObject({
    status: 'failed',
  });
  await db.query(
    'UPDATE identity_private.notification_deliveries SET next_attempt_at=now(),version=version+1 WHERE message_id=$1',
    [a.id],
  );
  batch = await f.delivery.runConfiguredBatch();
  expect(batch).toMatchObject({ claimed: 1, failed: 0, deadLettered: 1 });
  const dead = await f.job(a.id);
  expect(dead).toMatchObject({ status: 'dead_letter', reason: 'attempts_exhausted' });
  expect((await f.message(a.id)).attempts.map((x) => x.outcome)).toEqual(['failed', 'failed']);
  expect(calls).toEqual([a.id, a.id]);
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 3)).rejects.toMatchObject({
    status: 409,
  });
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 0 });
  const workspace = await f.delivery.deliveries(f.maker, f.project);
  expect(workspace.deadLetters).toBe(1);
  expect(workspace.items[0]).toMatchObject({
    messageId: a.id,
    status: 'dead_letter',
    attemptCount: 2,
    requeueCount: 0,
  });
  await expect(
    f.delivery.requeue(f.maker, f.project, a.id, accepted, Number(dead.version) - 1),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    f.delivery.requeue(f.maker, f.project, a.id, {}, Number(dead.version)),
  ).rejects.toMatchObject({
    status: 400,
  });
  mode = 'accept';
  const requeued = await f.delivery.requeue(
    f.maker,
    f.project,
    a.id,
    accepted,
    Number(dead.version),
  );
  expect(requeued).toMatchObject({
    status: 'queued',
    reason: 'requeued',
    requeueCount: 1,
    attemptBudget: 3,
  });
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, delivered: 1 });
  expect((await f.message(a.id)).status).toBe('delivered');
  expect(await f.job(a.id)).toMatchObject({ status: 'delivered' });
  expect(calls).toEqual([a.id, a.id, a.id]);
  // Terminal jobs are final: no requeue, no second send, and the receipt is stored encrypted only.
  await expect(
    f.delivery.requeue(f.maker, f.project, a.id, accepted, Number((await f.job(a.id)).version)),
  ).rejects.toMatchObject({ status: 409 });
  const [raw] = await db.query(
    'SELECT receipt_cipher FROM identity_private.notification_attempts WHERE message_id=$1 AND number=3',
    [a.id],
  );
  expect(String(raw!.receipt_cipher)).not.toContain('queued as');
  await expect(
    db.query(
      "UPDATE identity_private.notification_deliveries SET status='queued',version=version+1 WHERE message_id=$1",
      [a.id],
    ),
  ).rejects.toThrow('final');
  for (const entry of f.logs) {
    const text = JSON.stringify(entry);
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(entry.messageId).toBe(a.id);
  }
  expect(f.logs.map((l) => l.outcome)).toEqual(['failed', 'dead_letter', 'delivered']);
});

it('treats explicit provider rejection as final, provider silence as outcome_unknown and keeps idempotency keys stable', async () => {
  let behaviour: 'reject' | 'hang' | 'unknown' = 'reject';
  const f = await external(
    'zalo',
    mock('zalo', async (input) => {
      if (behaviour === 'hang') return new Promise(() => undefined);
      if (behaviour === 'unknown') throw new Error('provider-private-secret must never leak');
      expect(input.recipient).toBe('84900000002');
      expect(input.idempotencyKey).toBe(input.messageId);
      return { accepted: false, deliveryRef: 'zalo-rejected:-124' };
    }),
  );
  const a = await f.queue();
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, deadLettered: 1 });
  expect(await f.job(a.id)).toMatchObject({ status: 'dead_letter', reason: 'provider_rejected' });
  expect((await f.message(a.id)).status).toBe('failed');
  behaviour = 'hang';
  const b = await f.queue();
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, unknown: 1 });
  expect((await f.message(b.id)).status).toBe('outcome_unknown');
  expect(await f.job(b.id)).toMatchObject({ status: 'outcome_unknown', reason: 'timeout' });
  await expect(f.svc.deliver(f.maker, f.project, b.id, accepted, 2)).rejects.toMatchObject({
    status: 409,
  });
  behaviour = 'unknown';
  const c = await f.queue();
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, unknown: 1 });
  expect((await f.message(c.id)).status).toBe('outcome_unknown');
  const workspace = await f.delivery.deliveries(f.maker, f.project);
  expect(JSON.stringify(workspace)).not.toContain('private-secret');
  for (const s of SECRETS) expect(JSON.stringify(workspace)).not.toContain(s);
  expect(JSON.stringify(f.logs)).not.toContain('private-secret');
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 0 });
  // A definite rejection is not a provider outage: only the two unknown outcomes count.
  const [state] = await db.query(
    "SELECT failure_streak,open_until FROM identity_private.notification_channel_state WHERE organization_id=$1 AND channel='zalo'",
    [f.org],
  );
  expect(state).toMatchObject({ failure_streak: 2, open_until: null });
});

it('applies the per-organization/channel token bucket and opens the circuit after repeated provider failures', async () => {
  let calls = 0;
  const f = await external(
    'email',
    mock('email', async () => {
      calls++;
      throw new NotificationProviderError('retryable', 'smtp-421');
    }),
    1,
  );
  await db.query(
    'UPDATE identity_private.notification_provider_settings SET rate_per_minute=2,version=version+1 WHERE organization_id=$1',
    [f.org],
  );
  const ids = [await f.queue(), await f.queue(), await f.queue(), await f.queue()].map((m) => m.id);
  const batch = await f.delivery.runConfiguredBatch();
  expect(batch).toMatchObject({ claimed: 4, deadLettered: 2, rateLimited: 2 });
  expect(calls).toBe(2);
  const deferred = await Promise.all(ids.slice(2).map((id) => f.job(id)));
  expect(deferred.map((j) => j.status)).toEqual(['queued', 'queued']);
  expect(deferred.map((j) => j.reason)).toEqual(['rate_limited', 'rate_limited']);
  expect(new Date(String(deferred[0]!.next_attempt_at)).getTime()).toBeGreaterThan(Date.now());
  await db.query(
    "UPDATE identity_private.notification_channel_state SET tokens=10,refilled_at=now(),updated_at=now() WHERE organization_id=$1 AND channel='email'",
    [f.org],
  );
  await db.query(
    'UPDATE identity_private.notification_deliveries SET next_attempt_at=now(),version=version+1 WHERE organization_id=$1',
    [f.org],
  );
  const third = await f.delivery.runConfiguredBatch();
  expect(third).toMatchObject({ claimed: 2, deadLettered: 1, circuitOpen: 1 });
  expect(calls).toBe(3);
  const [state] = await db.query(
    "SELECT failure_streak,open_until FROM identity_private.notification_channel_state WHERE organization_id=$1 AND channel='email'",
    [f.org],
  );
  expect(Number(state!.failure_streak)).toBe(3);
  expect(new Date(String(state!.open_until)).getTime()).toBeGreaterThan(Date.now());
  const workspace = await f.delivery.deliveries(f.maker, f.project);
  expect(workspace.channels[0]).toMatchObject({ channel: 'email', failureStreak: 3 });
  expect(workspace.channels[0]!.circuitOpenUntil).not.toBeNull();
  const tail = await Promise.all(ids.slice(2).map((id) => f.job(id)));
  expect(tail.map((j) => j.reason).sort()).toEqual(['attempts_exhausted', 'circuit_open']);
  expect(f.delivery.metrics).toMatchObject({ rateLimited: 2, circuitOpen: 1 });
});

it('cancels a job when consent, preference or transport changed between confirmation and send', async () => {
  let calls = 0;
  const f = await external(
    'zalo',
    mock('zalo', async () => {
      calls++;
      return { accepted: true, deliveryRef: 'zalo:synthetic' };
    }),
  );
  const a = await f.queue();
  await new PrivacyService(db).withdraw(f.citizen);
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, cancelled: 1 });
  expect((await f.message(a.id)).status).toBe('cancelled');
  expect(await f.job(a.id)).toMatchObject({ status: 'cancelled', reason: 'consent_unavailable' });
  const privacy = new PrivacyService(db),
    n = (await privacy.current(f.org))!;
  await privacy.choose(f.citizen, { noticeId: n.id, contentHash: n.content_hash, accepted: true });
  await f.svc.preference(f.citizen, f.project, f.prefs, 1);
  const b = await f.queue();
  await f.svc.preference(f.citizen, f.project, { ...f.prefs, enabled: false }, 2);
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, cancelled: 1 });
  expect(await f.job(b.id)).toMatchObject({ status: 'cancelled' });
  await f.svc.preference(f.citizen, f.project, f.prefs, 3);
  const c = await f.queue();
  await f.svc.configure(
    f.reviewer,
    f.project,
    { channel: 'zalo', enabled: false, adapterId: f.adapterId, maxAttempts: 3, accepted: true },
    1,
  );
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, deadLettered: 1 });
  expect(await f.job(c.id)).toMatchObject({ status: 'dead_letter', reason: 'transport_disabled' });
  expect((await f.message(c.id)).status).toBe('queued');
  await expect(
    f.delivery.requeue(f.maker, f.project, c.id, accepted, Number((await f.job(c.id)).version)),
  ).rejects.toMatchObject({ status: 503 });
  expect(calls).toBe(0);
});

it('denies cross-organization access, non-admin provider entry and worker claims outside the configured organization', async () => {
  const a = await external(
    'email',
    mock('email', async () => ({ accepted: true, deliveryRef: 'smtp:ok' })),
  );
  const b = await makeReady(db, 'email');
  const m = await a.queue();
  await expect(a.delivery.deliveries(b.maker, a.project)).rejects.toMatchObject({ status: 404 });
  await expect(a.delivery.requeue(b.maker, a.project, m.id, accepted, 1)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    a.delivery.requeue({ ...a.maker, projectIds: [randomUUID()] }, a.project, m.id, accepted, 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    a.delivery.configureProvider({ ...a.maker, role: 'staff' }, 'email', emailProvider('x'), 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    a.delivery.configureProvider(a.maker, 'zalo', emailProvider(a.adapterId), 0),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    a.delivery.configureProvider(a.maker, 'email', emailProvider(a.adapterId), 0),
  ).rejects.toMatchObject({ status: 409 });
  expect((await a.delivery.providers(b.maker)).items).toEqual([]);
  const own = await a.delivery.providers(a.maker);
  expect(own.items).toHaveLength(1);
  for (const s of SECRETS) expect(JSON.stringify(own)).not.toContain(s);
  await expect(a.delivery.claimNext(b.org)).rejects.toMatchObject({ status: 403 });
  process.env.AUTH_ORGANIZATION_ID = b.org;
  expect(await a.delivery.runConfiguredBatch()).toMatchObject({ claimed: 0 });
  process.env.AUTH_ORGANIZATION_ID = a.org;
  expect(await a.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, delivered: 1 });
  process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'maybe';
  expect(() => a.delivery.configuredOrganization()).toThrow();
  delete process.env.AUTH_ORGANIZATION_ID;
  process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'true';
  expect(() => a.delivery.configuredOrganization()).toThrow();
});

it('reschedules a crashed worker claim with fencing and dead-letters after repeated worker failures', async () => {
  const f = await external(
    'email',
    mock('email', async () => ({ accepted: true, deliveryRef: 'smtp:ok' })),
  );
  const a = await f.queue();
  const original = f.delivery.processClaim.bind(f.delivery);
  f.delivery.processClaim = async () => {
    throw new Error('synthetic worker crash');
  };
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, workerFailures: 1 });
  expect(await f.job(a.id)).toMatchObject({
    status: 'queued',
    reason: 'processing_failed',
    worker_failures: 1,
  });
  // A stale lease token cannot complete or fail the job.
  f.delivery.processClaim = original;
  expect(
    await f.delivery.processClaim({
      messageId: a.id,
      organizationId: f.org,
      leaseToken: randomUUID(),
    }),
  ).toBe('lost');
  await db.query(
    'UPDATE identity_private.notification_deliveries SET next_attempt_at=now(),worker_failures=4,version=version+1 WHERE message_id=$1',
    [a.id],
  );
  f.delivery.processClaim = async () => {
    throw new Error('synthetic worker crash');
  };
  expect(await f.delivery.runConfiguredBatch()).toMatchObject({ claimed: 1, workerFailures: 1 });
  expect(await f.job(a.id)).toMatchObject({ status: 'dead_letter', reason: 'processing_failed' });
  expect((await f.message(a.id)).attempts).toHaveLength(0);
  // Crashes are never silent, but only the error class reaches the log.
  const crashes = f.logs.filter((l) => l.event === 'notification.delivery-worker-failure');
  expect(crashes).toHaveLength(2);
  expect(crashes[0]).toMatchObject({ messageId: a.id, error: 'Error' });
  expect(JSON.stringify(f.logs)).not.toContain('synthetic worker crash');
});

it('delivers through the real SMTP and Zalo adapters against local fake providers, resolving the verified phone', async () => {
  const tls: TestCertificate = testCertificate();
  const smtp: FakeSmtp = await startFakeSmtp(tls, { starttls: true, implicit: false });
  const requests: Record<string, unknown>[] = [];
  const http: HttpServer = createHttpServer((request, response) => {
    let raw = '';
    request.on('data', (c) => (raw += c));
    request.on('end', () => {
      requests.push(JSON.parse(raw));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 0, data: { msg_id: 'synthetic-real' } }));
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  const port = (http.address() as { port: number }).port;
  try {
    const email = await external(
      'email',
      new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: tls.cert }),
    );
    await email.delivery.configureProvider(
      email.maker,
      'email',
      emailProvider(email.adapterId, '127.0.0.1', smtp.port),
      1,
    );
    email.delivery.sendDeadlineMs = 5000;
    const m = await email.queue();
    expect(await email.delivery.runConfiguredBatch()).toMatchObject({ delivered: 1 });
    expect(await email.job(m.id)).toMatchObject({ status: 'delivered' });
    expect(smtp.messages.at(-1)).toContain('Message-ID: <' + m.id + '@noxh.notification>');
    const [attempt] = await db.query(
      'SELECT id,receipt_cipher FROM identity_private.notification_attempts WHERE message_id=$1',
      [m.id],
    );
    expect(
      unseal(String(attempt!.receipt_cipher), 'notification-attempt:' + attempt!.id),
    ).toContain('queued as');
    // Host allowlist is enforced at entry: a relay outside the operator list is refused.
    await expect(
      email.delivery.configureProvider(
        email.maker,
        'email',
        emailProvider(email.adapterId, 'smtp.other.example', smtp.port),
        2,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const zalo = await external(
      'zalo',
      new ZaloOaAdapter({ endpoint: `http://127.0.0.1:${port}/message/template` }),
    );
    await zalo.delivery.configureProvider(zalo.maker, 'zalo', zaloProvider(zalo.adapterId), 1);
    const z = await zalo.queue();
    // No sink: the customer's OTP-verified phone is the only recipient source.
    expect(await zalo.delivery.runConfiguredBatch()).toMatchObject({ deadLettered: 1 });
    expect(await zalo.job(z.id)).toMatchObject({
      status: 'dead_letter',
      reason: 'recipient_unavailable',
    });
    await db.query(
      'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
      [zalo.org, zalo.user, 'ref-' + zalo.user, seal('84900000009', 'phone:' + zalo.org)],
    );
    const z2 = await zalo.queue();
    expect(await zalo.delivery.runConfiguredBatch()).toMatchObject({ delivered: 1 });
    expect(requests.at(-1)).toMatchObject({ phone: '84900000009', tracking_id: z2.id });
    expect(JSON.stringify(zalo.logs)).not.toContain('84900000009');
  } finally {
    await smtp.close();
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
    tls.dispose();
  }
});

it('exposes counters only on the worker health status and never overlaps batches', async () => {
  vi.useFakeTimers();
  try {
    const service = {
      configuredOrganization: vi.fn(() => '10000000-0000-4000-8000-000000000001'),
      metrics: { claimed: 1 },
      runConfiguredBatch: vi.fn(async () => ({ claimed: 1, delivered: 1 })),
    };
    const lifecycle = new NotificationDeliveryLifecycle(
      service as unknown as NotificationDeliveryService,
    );
    lifecycle.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(11000);
    expect(service.runConfiguredBatch).toHaveBeenCalledTimes(2);
    const status = lifecycle.status();
    expect(status).toMatchObject({ enabled: true, error: false, counters: { claimed: 1 } });
    expect(JSON.stringify(status)).not.toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-4/);
    await lifecycle.onModuleDestroy();
    const disabled = new NotificationDeliveryLifecycle({
      configuredOrganization: () => null,
      metrics: {},
      runConfiguredBatch: vi.fn(),
    } as unknown as NotificationDeliveryService);
    disabled.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(11000);
    expect(disabled.status().enabled).toBe(false);
    await disabled.onModuleDestroy();
  } finally {
    vi.useRealTimers();
  }
});
