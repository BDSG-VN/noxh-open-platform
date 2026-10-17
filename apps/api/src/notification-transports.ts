/**
 * Reviewed external delivery adapters. Operator-registered only (never from browser input),
 * default off, synthetic recipients/drill sinks only in this release. Every network call has a
 * deadline, honours the caller's AbortSignal, requires TLS off loopback and follows no redirect.
 * Errors carry short codes only: never addresses, credentials, message content or raw replies.
 */
import { BadRequestException } from '@nestjs/common';
import { connect as netConnect, isIP, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  NotificationEmailProviderSchema,
  NotificationZaloProviderSchema,
  type NotificationEmailProvider,
  type NotificationZaloProvider,
} from '@noxh/contracts';
import type {
  NotificationService,
  NotificationSendInput,
  NotificationSendResult,
  NotificationTransport,
} from './notification-service';

/** `retryable`: the provider certainly did not accept the message. `unknown`: it may have. */
export class NotificationProviderError extends Error {
  constructor(
    readonly kind: 'retryable' | 'unknown',
    readonly code: string,
  ) {
    super('notification provider ' + kind + ' (' + code + ')');
    this.name = 'NotificationProviderError';
  }
}
export const ZALO_TEMPLATE_ENDPOINT = 'https://business.openapi.zalo.me/message/template';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REPLY_BYTES = 16384;
const address =
  /^[^\s@<>,;"'\\()[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const safeRef = /^[A-Za-z0-9 ._:-]{1,120}$/;
/** Stored settings omit the request-time `accepted` confirmation; the API checked it on entry. */
const stored = (raw: unknown) =>
  raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw, accepted: true } : raw;
const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
]);

function deadline(signal: AbortSignal, ms: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear() {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
  };
}

interface SmtpReply {
  code: number;
  lines: string[];
}
/** Minimal SMTP client state machine (RFC 5321/3207/4954) over node:net and node:tls. */
class SmtpSession {
  private socket!: Socket | TLSSocket;
  private buffer = '';
  private waiting: { resolve(r: SmtpReply): void; reject(e: Error): void } | undefined;
  private closed: Error | undefined;
  /** Set once DATA content has been fully written: silence after this point is an unknown outcome. */
  committed = false;
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly tls: { ca?: string; servername?: string },
    private readonly signal: AbortSignal,
  ) {}
  private fail(code: string) {
    return new NotificationProviderError(this.committed ? 'unknown' : 'retryable', code);
  }
  private attach(socket: Socket | TLSSocket) {
    this.socket = socket;
    socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('latin1');
      if (this.buffer.length > MAX_REPLY_BYTES) return this.abort('smtp-oversize');
      this.drain();
    });
    socket.on('error', () => this.abort('smtp-socket'));
    socket.on('close', () => this.abort('smtp-closed'));
  }
  private abort(code: string) {
    if (this.closed) return;
    this.closed = this.fail(code);
    this.socket?.destroy();
    this.waiting?.reject(this.closed);
    this.waiting = undefined;
  }
  private drain() {
    if (!this.waiting) return;
    const lines: string[] = [];
    let rest = this.buffer;
    for (;;) {
      const i = rest.indexOf('\r\n');
      if (i < 0) return;
      const line = rest.slice(0, i);
      rest = rest.slice(i + 2);
      if (!/^\d{3}[ -]/.test(line) && line.length !== 3) return this.abort('smtp-protocol');
      lines.push(line);
      if (line[3] !== '-') break;
    }
    this.buffer = rest;
    const w = this.waiting;
    this.waiting = undefined;
    w.resolve({ code: Number(lines[0]!.slice(0, 3)), lines });
  }
  private reply(): Promise<SmtpReply> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.signal.aborted) {
      this.abort('aborted');
      return Promise.reject(this.closed);
    }
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.drain();
    });
  }
  async connect(implicit: boolean) {
    if (this.signal.aborted) throw new NotificationProviderError('retryable', 'aborted');
    const socket = implicit
      ? tlsConnect({
          host: this.host,
          port: this.port,
          ca: this.tls.ca,
          servername: this.tls.servername,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
        })
      : netConnect({ host: this.host, port: this.port });
    this.attach(socket);
    this.signal.addEventListener('abort', () => this.abort('aborted'), { once: true });
    const greeting = await this.reply().catch((e: NotificationProviderError) => {
      throw implicit && e.code === 'smtp-socket' ? this.fail('smtp-tls') : e;
    });
    if (greeting.code !== 220) throw this.fail('smtp-' + greeting.code);
  }
  async command(line: string, expected: number[]): Promise<SmtpReply> {
    if (this.closed) throw this.closed;
    this.socket.write(line + '\r\n');
    const r = await this.reply();
    if (!expected.includes(r.code)) {
      const error = r.code >= 500 ? new SmtpRejected(r.code) : this.fail('smtp-' + r.code);
      this.socket.destroy();
      throw error;
    }
    return r;
  }
  async ehlo(): Promise<Set<string>> {
    const r = await this.command('EHLO noxh.notification', [250]);
    return new Set(r.lines.slice(1).map((l) => l.slice(4).split(' ')[0]!.toUpperCase()));
  }
  async starttls() {
    await this.command('STARTTLS', [220]);
    const plain = this.socket;
    plain.removeAllListeners('data');
    plain.removeAllListeners('error');
    plain.removeAllListeners('close');
    this.buffer = '';
    const secure = tlsConnect({
      socket: plain,
      host: this.host,
      ca: this.tls.ca,
      servername: this.tls.servername,
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
    });
    this.attach(secure);
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', () => reject(this.fail('smtp-tls')));
      // A handshake cut short (peer drop or deadline abort) must reject, never hang.
      secure.once('close', () => reject(this.closed ?? this.fail('smtp-tls')));
    });
  }
  async data(content: string) {
    await this.command('DATA', [354]);
    // Dot-stuffing (RFC 5321 §4.5.2) then the terminating line; after this the outcome is unknown.
    this.socket.write(content.replace(/\r\n\./g, '\r\n..') + '\r\n.\r\n');
    this.committed = true;
    const r = await this.reply();
    if (r.code >= 500) throw new SmtpRejected(r.code);
    // An explicit transient reply is a definite non-acceptance; only silence is unknown.
    if (r.code !== 250) throw new NotificationProviderError('retryable', 'smtp-' + r.code);
    return r;
  }
  end() {
    if (this.closed) return;
    this.socket.write('QUIT\r\n');
    this.socket.end();
    this.closed = new NotificationProviderError('retryable', 'smtp-closed');
  }
  destroy() {
    if (!this.closed) this.closed = new NotificationProviderError('retryable', 'smtp-closed');
    this.socket?.destroy();
  }
}
class SmtpRejected extends Error {
  constructor(readonly code: number) {
    super('smtp-' + code);
  }
}
const encodeHeader = (v: string) =>
  '=?UTF-8?B?' + Buffer.from(v.replace(/[\r\n]+/g, ' '), 'utf8').toString('base64') + '?=';
const wrap76 = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n');

export interface EmailSmtpAdapterOptions {
  /** Operator allowlist of SMTP hostnames; organization settings may only target these. */
  allowedHosts: string[];
  /** PEM bundle for private relays; public CAs are used otherwise. */
  ca?: string;
  timeoutMs?: number;
}
export class EmailSmtpAdapter implements NotificationTransport {
  readonly channel = 'email' as const;
  readonly supportsIdempotency = true as const;
  readonly allowedHosts: string[];
  constructor(private readonly options: EmailSmtpAdapterOptions) {
    this.allowedHosts = options.allowedHosts.map((h) => h.trim().toLowerCase()).filter(Boolean);
  }
  validateConfig(raw: unknown): NotificationEmailProvider {
    const parsed = NotificationEmailProviderSchema.safeParse(stored(raw));
    if (!parsed.success) throw new BadRequestException('Cấu hình SMTP chưa hợp lệ');
    if (!this.allowedHosts.includes(parsed.data.host.toLowerCase()))
      throw new BadRequestException('Máy chủ SMTP chưa nằm trong danh sách vận hành cho phép');
    return parsed.data;
  }
  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const config = this.validateConfig(input.config);
    if (!address.test(input.recipient) || !address.test(config.from))
      throw new BadRequestException('Địa chỉ email không hợp lệ');
    const timer = deadline(input.signal, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const session = new SmtpSession(
      config.host,
      config.port,
      { ca: this.options.ca, servername: isIP(config.host) ? undefined : config.host },
      timer.signal,
    );
    try {
      await session.connect(config.security === 'tls');
      let caps = await session.ehlo();
      if (config.security === 'starttls') {
        if (!caps.has('STARTTLS'))
          throw new NotificationProviderError('retryable', 'smtp-no-starttls');
        await session.starttls();
        caps = await session.ehlo();
      }
      if (!caps.has('AUTH')) throw new NotificationProviderError('retryable', 'smtp-no-auth');
      await session.command(
        'AUTH PLAIN ' +
          Buffer.from('\0' + config.username + '\0' + config.password).toString('base64'),
        [235],
      );
      await session.command('MAIL FROM:<' + config.from + '>', [250]);
      await session.command('RCPT TO:<' + input.recipient + '>', [250, 251]);
      const content = [
        'From: <' + config.from + '>',
        'To: <' + input.recipient + '>',
        'Subject: ' + encodeHeader(input.title),
        'Message-ID: <' + input.messageId + '@noxh.notification>',
        'Date: ' + new Date().toUTCString(),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'Auto-Submitted: auto-generated',
        '',
        wrap76(Buffer.from(input.body, 'utf8').toString('base64')),
      ].join('\r\n');
      const r = await session.data(content);
      session.end();
      const ref = r.lines[0]!.slice(4);
      return { accepted: true, deliveryRef: safeRef.test(ref) ? 'smtp:' + ref : 'smtp:250' };
    } catch (e) {
      if (e instanceof SmtpRejected) return { accepted: false, deliveryRef: 'smtp-' + e.code };
      if (e instanceof NotificationProviderError || e instanceof BadRequestException) throw e;
      throw new NotificationProviderError(
        session.committed ? 'unknown' : 'retryable',
        'smtp-error',
      );
    } finally {
      session.destroy();
      timer.clear();
    }
  }
}

export interface ZaloOaAdapterOptions {
  endpoint?: string;
  timeoutMs?: number;
}
export class ZaloOaAdapter implements NotificationTransport {
  readonly channel = 'zalo' as const;
  readonly supportsIdempotency = true as const;
  readonly endpoint: string;
  constructor(private readonly options: ZaloOaAdapterOptions = {}) {
    const url = new URL(options.endpoint ?? ZALO_TEMPLATE_ENDPOINT);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname)))
      throw new Error('Zalo endpoint must use TLS outside loopback');
    if (url.username || url.password) throw new Error('Zalo endpoint must not embed credentials');
    this.endpoint = url.toString();
  }
  validateConfig(raw: unknown): NotificationZaloProvider {
    const parsed = NotificationZaloProviderSchema.safeParse(stored(raw));
    if (!parsed.success) throw new BadRequestException('Cấu hình Zalo OA chưa hợp lệ');
    return parsed.data;
  }
  async send(input: NotificationSendInput): Promise<NotificationSendResult> {
    const config = this.validateConfig(input.config);
    if (!/^84[35789][0-9]{8}$/.test(input.recipient))
      throw new BadRequestException('Số nhận Zalo không hợp lệ');
    const timer = deadline(input.signal, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    let sent = false;
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: timer.signal,
        headers: { 'Content-Type': 'application/json', access_token: config.accessToken },
        body: JSON.stringify({
          phone: input.recipient,
          template_id: config.templateId,
          template_data: {
            [config.titleParameter]: input.title,
            [config.bodyParameter]: input.body,
          },
          tracking_id: input.idempotencyKey,
          appsecret_proof: createHmac('sha256', config.appSecret)
            .update(config.accessToken)
            .digest('hex'),
        }),
      });
      sent = true;
      if (response.status >= 500 || response.status === 429) {
        await response.body?.cancel();
        throw new NotificationProviderError('retryable', 'http-' + response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new NotificationProviderError('unknown', 'empty');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const value = await reader.read();
        if (value.done) break;
        size += value.value.byteLength;
        if (size > MAX_REPLY_BYTES) {
          await reader.cancel();
          throw new NotificationProviderError('unknown', 'oversize');
        }
        chunks.push(value.value);
      }
      let result: { error?: unknown; data?: { msg_id?: unknown } };
      try {
        result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new NotificationProviderError('unknown', 'invalid-json');
      }
      if (!result || typeof result.error !== 'number')
        throw new NotificationProviderError('unknown', 'invalid-reply');
      if (!response.ok || result.error !== 0)
        return { accepted: false, deliveryRef: 'zalo-rejected:' + Math.trunc(result.error) };
      const id = result.data?.msg_id;
      return {
        accepted: true,
        deliveryRef:
          typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)
            ? 'zalo:' + id
            : 'zalo:accepted',
      };
    } catch (e) {
      if (e instanceof NotificationProviderError) throw e;
      if (timer.signal.aborted) throw new NotificationProviderError('unknown', 'timeout');
      // Only a failure to reach the provider at all is known not to have delivered anything.
      const root = (e as { cause?: { code?: unknown; errors?: { code?: unknown }[] } }).cause;
      const cause = root?.code ?? root?.errors?.[0]?.code;
      if (!sent && typeof cause === 'string' && UNREACHABLE.has(cause))
        throw new NotificationProviderError('retryable', 'network');
      throw new NotificationProviderError('unknown', sent ? 'read' : 'network');
    } finally {
      timer.clear();
    }
  }
}

/** Bootstrap/worker only. Env is the single source of operator policy; nothing comes from the DB or browser. */
export function registerNotificationAdapters(
  service: NotificationService,
  env: Record<string, string | undefined> = process.env,
) {
  if (env.NOTIFICATIONS_EXTERNAL_ENABLED !== 'true') return;
  let ca: string | undefined;
  if (env.NOTIFICATIONS_SMTP_CA_FILE) {
    try {
      ca = readFileSync(env.NOTIFICATIONS_SMTP_CA_FILE, 'utf8');
    } catch {
      // Startup must fail loudly, but without echoing the configured path into process logs.
      throw new Error('NOTIFICATIONS_SMTP_CA_FILE is not readable');
    }
    if (!ca.includes('-----BEGIN CERTIFICATE-----'))
      throw new Error('NOTIFICATIONS_SMTP_CA_FILE is not a PEM certificate bundle');
  }
  service.transports.set(
    'email-smtp',
    new EmailSmtpAdapter({
      allowedHosts: (env.NOTIFICATIONS_SMTP_ALLOWED_HOSTS ?? '').split(','),
      ca,
    }),
  );
  service.transports.set(
    'zalo-oa',
    new ZaloOaAdapter({ endpoint: env.NOTIFICATIONS_ZALO_ENDPOINT }),
  );
}
