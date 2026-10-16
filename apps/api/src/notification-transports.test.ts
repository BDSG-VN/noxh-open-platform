/** Provider adapters against local fake servers only: no network, no real provider, synthetic data. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { startFakeSmtp, testCertificate, type FakeSmtp, type TestCertificate } from './test-smtp';
import {
  EmailSmtpAdapter,
  ZaloOaAdapter,
  NotificationProviderError,
  registerNotificationAdapters,
} from './notification-transports';
import { NotificationService } from './notification-service';
import { Database } from './database';

let tls: TestCertificate, cert: string, smtp: FakeSmtp;
const SECRET = 'synthetic-smtp-password-NEVER-LOGGED';
const startSmtp = (options: { starttls: boolean; implicit: boolean }) =>
  startFakeSmtp(tls, options);
beforeAll(async () => {
  tls = testCertificate();
  cert = tls.cert;
  smtp = await startSmtp({ starttls: true, implicit: false });
});
afterAll(async () => {
  await smtp.close();
  tls.dispose();
});
const input = (overrides: Partial<Parameters<EmailSmtpAdapter['send']>[0]> = {}) => ({
  organizationId: randomUUID(),
  projectId: randomUUID(),
  userId: randomUUID(),
  messageId: randomUUID(),
  idempotencyKey: randomUUID(),
  title: 'Hồ sơ DEMO-1 (diễn tập)',
  body: 'Nội dung giả lập.\r\n.Dòng bắt đầu bằng dấu chấm\nKhông phải thông báo pháp lý.',
  synthetic: true as const,
  signal: new AbortController().signal,
  recipient: 'sink@synthetic.example',
  config: {} as Record<string, unknown>,
  ...overrides,
});
const emailConfig = (port: number, security: 'starttls' | 'tls' = 'starttls') => ({
  channel: 'email',
  adapterId: 'email-smtp',
  host: '127.0.0.1',
  port,
  security,
  username: 'synthetic-user',
  password: SECRET,
  from: 'noxh@synthetic.example',
  sinkAddress: 'sink@synthetic.example',
  ratePerMinute: 60,
  accepted: true,
});

describe('EmailSmtpAdapter', () => {
  it('delivers over STARTTLS with a stable Message-ID, encoded headers and dot-stuffed body', async () => {
    const adapter = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: cert });
    smtp.behaviour = 'accept';
    smtp.transcript.length = 0;
    const id = randomUUID();
    const result = await adapter.send(
      input({ messageId: id, idempotencyKey: id, config: emailConfig(smtp.port) }),
    );
    expect(result.accepted).toBe(true);
    expect(result.deliveryRef).toContain('queued as synthetic-');
    expect(smtp.transcript.some((l) => l.startsWith('STARTTLS'))).toBe(true);
    const auth = smtp.transcript.find((l) => l.startsWith('AUTH PLAIN '))!;
    expect(Buffer.from(auth.slice(11), 'base64').toString('utf8')).toBe(
      '\0synthetic-user\0' + SECRET,
    );
    expect(smtp.transcript.indexOf(auth)).toBeGreaterThan(
      smtp.transcript.findIndex((l) => l.startsWith('STARTTLS')),
    );
    const mail = smtp.messages.at(-1)!;
    expect(mail).toContain('Message-ID: <' + id + '@noxh.notification>');
    expect(mail).toContain('To: <sink@synthetic.example>');
    expect(mail).toContain('Subject: =?UTF-8?B?');
    expect(mail).not.toContain('Hồ sơ');
    expect(mail).toContain('Content-Transfer-Encoding: base64');
    expect(mail).not.toMatch(/^\.Dòng/m);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
  it('delivers over implicit TLS and refuses hosts outside the operator allowlist', async () => {
    const implicit = await startSmtp({ starttls: false, implicit: true });
    try {
      const adapter = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: cert });
      const ok = await adapter.send(input({ config: emailConfig(implicit.port, 'tls') }));
      expect(ok.accepted).toBe(true);
      const denied = new EmailSmtpAdapter({ allowedHosts: ['smtp.synthetic.example'], ca: cert });
      await expect(
        denied.send(input({ config: emailConfig(implicit.port, 'tls') })),
      ).rejects.toThrow(/danh sách/);
      expect(() => denied.validateConfig(emailConfig(implicit.port))).toThrow(/danh sách/);
    } finally {
      await implicit.close();
    }
  });
  it('refuses to send when the server offers no STARTTLS or presents an untrusted certificate', async () => {
    const plain = await startSmtp({ starttls: false, implicit: false });
    try {
      const adapter = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: cert });
      await expect(adapter.send(input({ config: emailConfig(plain.port) }))).rejects.toMatchObject({
        kind: 'retryable',
        code: 'smtp-no-starttls',
      });
      expect(plain.transcript.some((l) => l.startsWith('AUTH'))).toBe(false);
      const untrusted = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'] });
      await expect(untrusted.send(input({ config: emailConfig(smtp.port) }))).rejects.toMatchObject(
        {
          kind: 'retryable',
          code: 'smtp-tls',
        },
      );
    } finally {
      await plain.close();
    }
  });
  it('maps permanent rejection to failed, temporary failure to retryable and post-DATA silence to unknown', async () => {
    const adapter = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: cert, timeoutMs: 400 });
    smtp.behaviour = 'reject';
    const rejected = await adapter.send(input({ config: emailConfig(smtp.port) }));
    expect(rejected).toEqual({ accepted: false, deliveryRef: 'smtp-550' });
    smtp.behaviour = 'temporary';
    await expect(adapter.send(input({ config: emailConfig(smtp.port) }))).rejects.toMatchObject({
      kind: 'retryable',
      code: 'smtp-451',
    });
    smtp.behaviour = 'drop-before-data';
    await expect(adapter.send(input({ config: emailConfig(smtp.port) }))).rejects.toMatchObject({
      kind: 'retryable',
    });
    smtp.behaviour = 'drop-on-starttls';
    await expect(adapter.send(input({ config: emailConfig(smtp.port) }))).rejects.toMatchObject({
      kind: 'retryable',
    });
    smtp.behaviour = 'hang-after-data';
    const error = await adapter.send(input({ config: emailConfig(smtp.port) })).catch((e) => e);
    expect(error).toBeInstanceOf(NotificationProviderError);
    expect(error.kind).toBe('unknown');
    expect(String(error.message) + String(error.code)).not.toContain(SECRET);
    smtp.behaviour = 'accept';
  });
  it('honours the caller abort signal and rejects header injection in addresses', async () => {
    const adapter = new EmailSmtpAdapter({ allowedHosts: ['127.0.0.1'], ca: cert });
    const abort = new AbortController();
    abort.abort();
    await expect(
      adapter.send(input({ config: emailConfig(smtp.port), signal: abort.signal })),
    ).rejects.toMatchObject({ kind: 'retryable', code: 'aborted' });
    await expect(
      adapter.send(
        input({ config: emailConfig(smtp.port), recipient: 'a@b.example\r\nRCPT TO:<x>' }),
      ),
    ).rejects.toThrow();
    await expect(
      adapter.send(input({ config: { ...emailConfig(smtp.port), from: 'bad\nfrom@x' } })),
    ).rejects.toThrow();
  });
});

describe('ZaloOaAdapter', () => {
  let http: HttpServer, port: number;
  let status = 200,
    payload: unknown = { error: 0, message: 'Success', data: { msg_id: 'synthetic-msg-1' } };
  const requests: { headers: Record<string, unknown>; body: Record<string, unknown> }[] = [];
  beforeAll(async () => {
    http = createHttpServer((request, response) => {
      let raw = '';
      request.on('data', (c) => (raw += c));
      request.on('end', () => {
        requests.push({ headers: request.headers, body: JSON.parse(raw) });
        if (status === 0) return; // never answer: timeout path
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
      });
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    port = (http.address() as { port: number }).port;
  });
  afterAll(async () => {
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  });
  const zaloConfig = (sink?: string) => ({
    channel: 'zalo',
    adapterId: 'zalo-oa',
    accessToken: 'synthetic-access-token-NEVER-LOGGED',
    appSecret: 'synthetic-app-secret-NEVER-LOGGED',
    templateId: 'tpl-synthetic',
    titleParameter: 'title',
    bodyParameter: 'content',
    ...(sink ? { sinkPhone: sink } : {}),
    ratePerMinute: 30,
    accepted: true,
  });
  it('posts the template message with tracking id and appsecret proof, accepting only error 0', async () => {
    const adapter = new ZaloOaAdapter({ endpoint: `http://127.0.0.1:${port}/message/template` });
    const id = randomUUID();
    const result = await adapter.send(
      input({ messageId: id, idempotencyKey: id, recipient: '84900000001', config: zaloConfig() }),
    );
    expect(result).toEqual({ accepted: true, deliveryRef: 'zalo:synthetic-msg-1' });
    const last = requests.at(-1)!;
    expect(last.headers.access_token).toBe('synthetic-access-token-NEVER-LOGGED');
    expect(last.body).toMatchObject({
      phone: '84900000001',
      template_id: 'tpl-synthetic',
      tracking_id: id,
      template_data: { title: 'Hồ sơ DEMO-1 (diễn tập)' },
    });
    expect(typeof last.body.appsecret_proof).toBe('string');
    status = 200;
    payload = { error: -124, message: 'private provider detail' };
    expect(await adapter.send(input({ recipient: '84900000001', config: zaloConfig() }))).toEqual({
      accepted: false,
      deliveryRef: 'zalo-rejected:-124',
    });
    status = 400;
    payload = { error: -201 };
    expect(
      (await adapter.send(input({ recipient: '84900000001', config: zaloConfig() }))).accepted,
    ).toBe(false);
    status = 503;
    payload = { error: -1 };
    await expect(
      adapter.send(input({ recipient: '84900000001', config: zaloConfig() })),
    ).rejects.toMatchObject({ kind: 'retryable', code: 'http-503' });
    status = 429;
    await expect(
      adapter.send(input({ recipient: '84900000001', config: zaloConfig() })),
    ).rejects.toMatchObject({ kind: 'retryable', code: 'http-429' });
    status = 200;
    payload = '{not json';
    await expect(
      adapter.send(input({ recipient: '84900000001', config: zaloConfig() })),
    ).rejects.toMatchObject({ kind: 'unknown' });
    payload = { error: 0, data: { msg_id: 'synthetic-msg-1' } };
  });
  it('treats a silent provider as unknown and a refused connection as retryable; requires TLS off-loopback', async () => {
    const adapter = new ZaloOaAdapter({
      endpoint: `http://127.0.0.1:${port}/message/template`,
      timeoutMs: 300,
    });
    status = 0;
    const error = await adapter
      .send(input({ recipient: '84900000001', config: zaloConfig() }))
      .catch((e) => e);
    expect(error).toMatchObject({ kind: 'unknown', code: 'timeout' });
    expect(JSON.stringify(error)).not.toContain('NEVER-LOGGED');
    status = 200;
    const closed = createHttpServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', r));
    const dead = (closed.address() as { port: number }).port;
    await new Promise((r) => closed.close(r));
    const refused = new ZaloOaAdapter({ endpoint: `http://127.0.0.1:${dead}/message/template` });
    await expect(
      refused.send(input({ recipient: '84900000001', config: zaloConfig() })),
    ).rejects.toMatchObject({ kind: 'retryable', code: 'network' });
    expect(() => new ZaloOaAdapter({ endpoint: 'http://business.openapi.zalo.me/x' })).toThrow();
    expect(new ZaloOaAdapter().endpoint).toBe('https://business.openapi.zalo.me/message/template');
    expect(() => adapter.validateConfig({ ...zaloConfig(), extra: 1 })).toThrow();
  });
});

describe('registerNotificationAdapters', () => {
  it('registers nothing unless the deployment flag is on, then exactly the two reviewed adapters', () => {
    const service = new NotificationService(new Database());
    registerNotificationAdapters(service, {});
    expect(service.transports.size).toBe(0);
    registerNotificationAdapters(service, {
      NOTIFICATIONS_EXTERNAL_ENABLED: 'true',
      NOTIFICATIONS_SMTP_ALLOWED_HOSTS: 'smtp.synthetic.example, Relay.Internal',
    });
    expect([...service.transports.keys()].sort()).toEqual(['email-smtp', 'zalo-oa']);
    const email = service.transports.get('email-smtp') as EmailSmtpAdapter;
    expect(email.allowedHosts).toEqual(['smtp.synthetic.example', 'relay.internal']);
    expect(() =>
      registerNotificationAdapters(new NotificationService(new Database()), {
        NOTIFICATIONS_EXTERNAL_ENABLED: 'true',
        NOTIFICATIONS_ZALO_ENDPOINT: 'http://evil.example/',
      }),
    ).toThrow();
    const missing = '/nonexistent/secret-path/' + randomUUID() + '.pem';
    expect(() =>
      registerNotificationAdapters(new NotificationService(new Database()), {
        NOTIFICATIONS_EXTERNAL_ENABLED: 'true',
        NOTIFICATIONS_SMTP_CA_FILE: missing,
      }),
    ).toThrow(/not readable/);
    try {
      registerNotificationAdapters(new NotificationService(new Database()), {
        NOTIFICATIONS_EXTERNAL_ENABLED: 'true',
        NOTIFICATIONS_SMTP_CA_FILE: missing,
      });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret-path');
    }
  });
});
