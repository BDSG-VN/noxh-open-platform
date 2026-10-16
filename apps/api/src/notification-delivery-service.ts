/**
 * Worker-owned external delivery (migration 023): organization provider settings, bounded retry
 * with exponential backoff and jitter, lease fencing, per-organization/channel token bucket and
 * circuit breaker, dead-letter queue with operator-confirmed bounded requeue. Default off; only the
 * configured organization, synthetic projects, drill sinks and OTP-verified phones. Logs and views
 * carry identifiers and codes only: never addresses, credentials, receipts or message content.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  NotificationAcceptedSchema,
  NotificationProviderSchema,
  type NotificationDeliveryReason,
  type NotificationDeliveryView,
  type NotificationDeliveryWorkspace,
  type NotificationMessageView,
  type NotificationProviderView,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, uuid, record } from './admin-service';
import { seal, unseal } from './identity-crypto';
import { PrivacyService } from './privacy-service';
import type { Staff } from './workforce';
import { NotificationService, type NotificationSendResult } from './notification-service';
import { NotificationProviderError } from './notification-transports';

export interface NotificationDeliveryClaim {
  messageId: string;
  organizationId: string;
  leaseToken: string;
}
export type NotificationDeliveryOutcome =
  | 'delivered'
  | 'failed'
  | 'dead_letter'
  | 'outcome_unknown'
  | 'cancelled'
  | 'deferred'
  | 'lost';
export interface NotificationDeliveryMetrics {
  claimed: number;
  delivered: number;
  failed: number;
  deadLettered: number;
  unknown: number;
  cancelled: number;
  rateLimited: number;
  circuitOpen: number;
  workerFailures: number;
}
export const emptyDeliveryMetrics = (): NotificationDeliveryMetrics => ({
  claimed: 0,
  delivered: 0,
  failed: 0,
  deadLettered: 0,
  unknown: 0,
  cancelled: 0,
  rateLimited: 0,
  circuitOpen: 0,
  workerFailures: 0,
});
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const LEASE = "interval '30 seconds'";
const CIRCUIT_THRESHOLD = 3;
const notice =
  'Hàng đợi gửi email/Zalo do worker xử lý: thử lại có giới hạn, giới hạn tần suất và ngắt mạch theo tổ chức/kênh. Mặc định tắt; chỉ hộp thư diễn tập hoặc số điện thoại đã xác minh; chưa nghiệm thu nhà cung cấp thật.';

@Injectable()
export class NotificationDeliveryService {
  readonly metrics = emptyDeliveryMetrics();
  /** Hard deadline per adapter call; the adapter's own timeout is bounded by the same value. */
  sendDeadlineMs = 8000;
  /** Structured, identifier-only log sink; tests capture it. */
  log: (entry: Record<string, string | number | boolean | null>) => void = (entry) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  /** Exponential backoff with jitter: 10s, 20s (+0–50%). Tests shorten it. */
  backoffMs = (attempt: number) => {
    const base = 10000 * 2 ** Math.max(0, attempt - 1);
    return Math.round(base * (1 + Math.random() * 0.5));
  };
  /** Circuit open window after repeated provider failures: 30s doubling, capped at 5 minutes. */
  circuitOpenMs = (streak: number) =>
    Math.min(300000, 30000 * 2 ** Math.max(0, streak - CIRCUIT_THRESHOLD));
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(NotificationService) readonly notifications: NotificationService,
  ) {}
  private providerContext(org: string, channel: string) {
    return 'notification-provider:' + org + ':' + channel;
  }
  private providerView(r: Row): NotificationProviderView {
    const config = record(
      JSON.parse(
        unseal(
          String(r.config_cipher),
          this.providerContext(String(r.organization_id), String(r.channel)),
        ),
      ),
    );
    return {
      channel: r.channel as 'email' | 'zalo',
      adapterId: String(r.adapter_id),
      ratePerMinute: Number(r.rate_per_minute),
      configuredBy: String(r.configured_by),
      hasSecret: true,
      version: Number(r.version),
      summary:
        r.channel === 'email'
          ? {
              host: String(config.host),
              port: Number(config.port),
              security: String(config.security),
            }
          : { templateId: String(config.templateId) },
    };
  }
  private admin(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức nhập cấu hình nhà cung cấp');
  }
  async providers(s: Staff) {
    this.admin(s);
    return this.db.tx(async (q) => {
      await this.notifications.context(q, s.organizationId);
      const rows = (
        await q.query(
          'SELECT * FROM identity_private.notification_provider_settings WHERE organization_id=$1 ORDER BY channel',
          [s.organizationId],
        )
      ).rows;
      return {
        items: rows.map((r) => this.providerView(r)),
        registeredAdapters: [...this.notifications.transports.keys()].sort(),
        externalEnabled: process.env.NOTIFICATIONS_EXTERNAL_ENABLED === 'true',
        notice,
      };
    });
  }
  /** Organization administrator enters provider settings; stored encrypted, never echoed back. */
  async configureProvider(s: Staff, channel: string, body: unknown, v: number) {
    this.admin(s);
    const parsed = NotificationProviderSchema.safeParse(body);
    if (!parsed.success || parsed.data.channel !== channel)
      throw new BadRequestException('Cấu hình nhà cung cấp chưa hợp lệ cho kênh này');
    const b = parsed.data;
    const adapter = this.notifications.transports.get(b.adapterId);
    if (
      process.env.NOTIFICATIONS_EXTERNAL_ENABLED !== 'true' ||
      !adapter ||
      adapter.channel !== b.channel ||
      adapter.supportsIdempotency !== true
    )
      throw new ServiceUnavailableException(
        'Vận hành chưa bật hoặc chưa đăng ký adapter có idempotency cho kênh này',
      );
    // The registered adapter applies operator allowlists (e.g. SMTP hosts) before anything is stored.
    const config: Record<string, unknown> = { ...(adapter.validateConfig?.(b) ?? b) };
    delete config.accepted;
    return this.db.tx(async (q) => {
      await this.notifications.lock(q, s.organizationId);
      const old = (
        await q.query(
          'SELECT version FROM identity_private.notification_provider_settings WHERE organization_id=$1 AND channel=$2 FOR UPDATE',
          [s.organizationId, b.channel],
        )
      ).rows[0];
      if (Number(old?.version ?? 0) !== v)
        throw new ConflictException('Phiên bản cấu hình đã thay đổi; tải lại trước khi thao tác');
      const r = (
        await q.query(
          'INSERT INTO identity_private.notification_provider_settings(organization_id,channel,adapter_id,config_cipher,rate_per_minute,configured_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,channel) DO UPDATE SET adapter_id=excluded.adapter_id,config_cipher=excluded.config_cipher,rate_per_minute=excluded.rate_per_minute,configured_by=excluded.configured_by,version=notification_provider_settings.version+1,updated_at=now() RETURNING *',
          [
            s.organizationId,
            b.channel,
            b.adapterId,
            seal(JSON.stringify(config), this.providerContext(s.organizationId, b.channel)),
            b.ratePerMinute,
            s.subject,
          ],
        )
      ).rows[0]!;
      await event(q, s, 'notification.provider-configured', b.channel);
      return this.providerView(r);
    });
  }
  private view(r: Row): NotificationDeliveryView {
    return {
      messageId: String(r.message_id),
      projectId: String(r.project_id),
      channel: r.channel as 'email' | 'zalo',
      status: r.status as NotificationDeliveryView['status'],
      reason: (r.reason as NotificationDeliveryReason | null) ?? null,
      attemptCount: Number(r.attempt_count),
      attemptBudget: Number(r.attempt_budget),
      requeueCount: Number(r.requeue_count),
      nextAttemptAt: r.status === 'queued' ? iso(r.next_attempt_at) : null,
      messageStatus: r.message_status as NotificationMessageView['status'],
      messageVersion: Number(r.message_version),
      version: Number(r.version),
      updatedAt: iso(r.updated_at),
    };
  }
  async deliveries(s: Staff, project: string): Promise<NotificationDeliveryWorkspace> {
    return this.db.tx(async (q) => {
      await this.notifications.scope(q, s, project, 'records_read');
      const rows = (
        await q.query(
          'SELECT d.*,m.status AS message_status,m.attempt_count,m.version AS message_version FROM identity_private.notification_deliveries d JOIN identity_private.notification_messages m ON m.organization_id=d.organization_id AND m.project_id=d.project_id AND m.id=d.message_id WHERE d.organization_id=$1 AND d.project_id=$2 ORDER BY d.updated_at DESC,d.message_id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      const [dead] = (
        await q.query(
          "SELECT count(*)::int AS n FROM identity_private.notification_deliveries WHERE organization_id=$1 AND project_id=$2 AND status='dead_letter'",
          [s.organizationId, project],
        )
      ).rows;
      const channels = (
        await q.query(
          'SELECT channel,failure_streak,open_until,tokens FROM identity_private.notification_channel_state WHERE organization_id=$1 ORDER BY channel',
          [s.organizationId],
        )
      ).rows;
      return {
        items: rows.map((r) => this.view(r)),
        deadLetters: Number(dead?.n ?? 0),
        channels: channels.map((c) => ({
          channel: c.channel as 'email' | 'zalo',
          failureStreak: Number(c.failure_streak),
          circuitOpenUntil:
            c.open_until && new Date(String(c.open_until)).getTime() > Date.now()
              ? iso(c.open_until)
              : null,
          tokens: Math.floor(Number(c.tokens)),
        })),
        notice,
      };
    });
  }
  /** Operator-confirmed, version-bound, bounded requeue of a dead-lettered job. */
  async requeue(s: Staff, project: string, messageId: string, body: unknown, v: number) {
    if (!NotificationAcceptedSchema.safeParse(body).success)
      throw new BadRequestException('Cần xác nhận rõ thao tác gửi lại');
    return this.db.tx(async (q) => {
      await this.notifications.lock(q, s.organizationId);
      await this.notifications.scope(q, s, project, 'records_write');
      const r = (
        await q.query(
          'SELECT d.*,m.status AS message_status,m.attempt_count,m.version AS message_version FROM identity_private.notification_deliveries d JOIN identity_private.notification_messages m ON m.organization_id=d.organization_id AND m.project_id=d.project_id AND m.id=d.message_id WHERE d.organization_id=$1 AND d.project_id=$2 AND d.message_id=$3 FOR UPDATE OF d',
          [s.organizationId, uuid(project), uuid(messageId)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có tác vụ gửi trong phạm vi');
      if (Number(r.version) !== v)
        throw new ConflictException('Phiên bản đã thay đổi; tải lại trước khi thao tác');
      if (r.status !== 'dead_letter')
        throw new ConflictException('Chỉ gửi lại tác vụ đang ở hàng chờ lỗi');
      if (
        !['queued', 'failed'].includes(String(r.message_status)) ||
        Number(r.attempt_count) >= 3 ||
        Number(r.requeue_count) >= 2
      )
        throw new ConflictException('Đã hết ngân sách gửi lại; cần lập thư mới');
      const config = (
        await q.query(
          'SELECT enabled,adapter_id,max_attempts FROM identity_private.notification_transports WHERE organization_id=$1 AND project_id=$2 AND channel=$3 FOR SHARE',
          [s.organizationId, project, r.channel],
        )
      ).rows[0];
      const adapter = config
        ? this.notifications.transports.get(String(config.adapter_id))
        : undefined;
      if (
        process.env.NOTIFICATIONS_EXTERNAL_ENABLED !== 'true' ||
        config?.enabled !== true ||
        !adapter ||
        adapter.channel !== r.channel
      )
        throw new ServiceUnavailableException(
          'Kênh ngoài chưa được bật và cấu hình adapter hợp lệ',
        );
      const saved = (
        await q.query(
          "UPDATE identity_private.notification_deliveries SET status='queued',reason='requeued',attempt_budget=$2,requeue_count=requeue_count+1,worker_failures=0,next_attempt_at=now(),lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE message_id=$1 RETURNING *",
          [r.message_id, Math.min(3, Number(r.attempt_count) + Number(config.max_attempts))],
        )
      ).rows[0]!;
      await event(q, s, 'notification.delivery-requeued', String(r.message_id));
      return this.view({
        ...saved,
        message_status: r.message_status,
        attempt_count: r.attempt_count,
        message_version: r.message_version,
      });
    });
  }
  private actor(org: string) {
    return { organizationId: org, subject: 'system:notification-delivery' };
  }
  configuredOrganization() {
    const flag = process.env.NOTIFICATIONS_EXTERNAL_ENABLED;
    if (flag === undefined || flag === 'false') return null;
    if (flag !== 'true')
      throw new ServiceUnavailableException('Cờ kênh ngoài phải là true hoặc false');
    const org = process.env.AUTH_ORGANIZATION_ID;
    if (!org || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(org))
      throw new ServiceUnavailableException(
        'Worker gửi ngoài cần tổ chức máy chủ được cấu hình rõ',
      );
    return uuid(org);
  }
  /** Internal worker capability: bound by the configured organization, never by browser identity. */
  async claimNext(organizationId: string): Promise<NotificationDeliveryClaim | null> {
    const org = uuid(organizationId),
      configured = this.configuredOrganization();
    if (!configured) return null;
    if (configured !== org)
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    return this.db.tx(async (q) => {
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      await this.notifications.context(q, org);
      const r = (
        await q.query(
          "SELECT message_id FROM identity_private.notification_deliveries WHERE organization_id=$1 AND ((status='queued' AND next_attempt_at<=now()) OR (status='processing' AND lease_until<=now())) ORDER BY next_attempt_at,message_id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [org],
        )
      ).rows[0];
      if (!r) return null;
      const leaseToken = randomUUID();
      await q.query(
        `UPDATE identity_private.notification_deliveries SET status='processing',lease_token=$2,lease_until=now()+${LEASE},version=version+1,updated_at=now() WHERE message_id=$1`,
        [r.message_id, leaseToken],
      );
      return { messageId: String(r.message_id), organizationId: org, leaseToken };
    });
  }
  private async job(q: Sql, r: Row, status: string, reason: NotificationDeliveryReason | null) {
    await q.query(
      'UPDATE identity_private.notification_deliveries SET status=$2,reason=$3,lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE message_id=$1',
      [r.message_id, status, reason],
    );
  }
  private async terminal(
    q: Sql,
    d: Row,
    status: 'dead_letter' | 'cancelled',
    reason: NotificationDeliveryReason,
    org: string,
  ) {
    await this.job(q, d, status, reason);
    await event(
      q,
      this.actor(org),
      'notification.delivery-' + status.replace('_', '-'),
      String(d.message_id),
    );
    this.emit(d, status, reason);
    return status;
  }
  private async defer(q: Sql, r: Row, reason: NotificationDeliveryReason, untilMs: number) {
    await q.query(
      "UPDATE identity_private.notification_deliveries SET status='queued',reason=$2,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+($3::int*interval '1 millisecond'),version=version+1,updated_at=now() WHERE message_id=$1",
      [r.message_id, reason, Math.max(0, Math.round(untilMs))],
    );
  }
  private emit(r: Row, outcome: string, reason: string | null, extra: Record<string, number> = {}) {
    this.log({
      event: 'notification.delivery',
      messageId: String(r.message_id),
      organizationId: String(r.organization_id),
      projectId: String(r.project_id),
      channel: String(r.channel),
      outcome,
      reason,
      ...extra,
    });
  }
  async processClaim(claim: NotificationDeliveryClaim): Promise<NotificationDeliveryOutcome> {
    const org = this.configuredOrganization();
    if (!org) return 'lost';
    if (org !== uuid(claim.organizationId))
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    const outcome = await this.db.tx(async (q) => {
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      await this.notifications.context(q, org);
      await this.notifications.lock(q, org);
      const d = (
        await q.query(
          "SELECT * FROM identity_private.notification_deliveries WHERE organization_id=$1 AND message_id=$2 AND status='processing' AND lease_token=$3 AND lease_until>now() FOR UPDATE",
          [org, uuid(claim.messageId), uuid(claim.leaseToken)],
        )
      ).rows[0];
      if (!d) return 'lost' as const;
      const r = (
        await q.query(
          'SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
          [org, d.project_id, d.message_id],
        )
      ).rows[0];
      const sys = this.actor(org);
      if (!r) return this.terminal(q, d, 'cancelled', 'recipient_unavailable', org);
      if (r.status === 'delivered' || r.status === 'outcome_unknown') {
        // A previous worker completed the send but lost its lease before updating the job.
        await this.job(q, d, String(r.status), null);
        return r.status === 'delivered' ? ('delivered' as const) : ('outcome_unknown' as const);
      }
      if (r.status !== 'queued' && r.status !== 'failed')
        return this.terminal(q, d, 'cancelled', 'consent_unavailable', org);
      // Same re-verification as the explicit in-app confirmation: consent, preference, template,
      // application and customer must still be current at send time.
      const c = { organizationId: org, userId: String(r.owner_user_id) };
      const choice = await this.notifications.choice(q, c);
      let cancelled = choice?.action !== 'grant' || choice.id !== r.choice_id;
      try {
        const consent = await new PrivacyService(this.db).assertProcessing(c, q);
        cancelled =
          cancelled || consent.noticeId !== r.notice_id || consent.noticeHash !== r.notice_hash;
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() < 500) cancelled = true;
        else throw e;
      }
      const pref = (
        await q.query(
          'SELECT enabled,version FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel=$4 AND purpose=$5 FOR SHARE',
          [org, r.project_id, c.userId, r.channel, r.purpose],
        )
      ).rows[0];
      const template = (
        await q.query(
          'SELECT status FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR SHARE',
          [org, r.project_id, r.template_id],
        )
      ).rows[0];
      const application = (
        await q.query(
          "SELECT a.id FROM applications a JOIN users u ON u.organization_id=a.organization_id AND u.id=a.owner_user_id JOIN projects p ON p.organization_id=a.organization_id AND p.id=a.project_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND a.owner_user_id=$4 AND a.synthetic=true AND a.status<>'withdrawn' AND u.status='active' AND p.is_synthetic=true AND p.archived_at IS NULL FOR SHARE OF a,u,p",
          [org, r.project_id, r.application_id, c.userId],
        )
      ).rows[0];
      if (
        cancelled ||
        pref?.enabled !== true ||
        Number(pref.version) !== Number(r.preference_version) ||
        template?.status !== 'approved' ||
        !application
      ) {
        await q.query(
          "UPDATE identity_private.notification_messages SET status='cancelled',version=version+1 WHERE id=$1",
          [r.id],
        );
        await event(q, sys, 'notification.cancelled', String(r.id));
        return this.terminal(q, d, 'cancelled', 'consent_unavailable', org);
      }
      const config = (
        await q.query(
          'SELECT enabled,adapter_id FROM identity_private.notification_transports WHERE organization_id=$1 AND project_id=$2 AND channel=$3 FOR SHARE',
          [org, r.project_id, r.channel],
        )
      ).rows[0];
      const adapter = config
        ? this.notifications.transports.get(String(config.adapter_id))
        : undefined;
      const provider = (
        await q.query(
          'SELECT * FROM identity_private.notification_provider_settings WHERE organization_id=$1 AND channel=$2 FOR SHARE',
          [org, r.channel],
        )
      ).rows[0];
      if (
        config?.enabled !== true ||
        !adapter ||
        adapter.channel !== r.channel ||
        !provider ||
        provider.adapter_id !== config.adapter_id
      )
        return this.terminal(q, d, 'dead_letter', 'transport_disabled', org);
      const number = Number(r.attempt_count) + 1;
      if (number > Number(d.attempt_budget) || number > 3)
        return this.terminal(q, d, 'dead_letter', 'attempts_exhausted', org);
      // Token bucket and circuit breaker per organization and channel, serialized by the row lock.
      const capacity = Number(provider.rate_per_minute);
      const state = (
        await q.query(
          'INSERT INTO identity_private.notification_channel_state(organization_id,channel,tokens) VALUES($1,$2,$3) ON CONFLICT(organization_id,channel) DO UPDATE SET tokens=LEAST($3::double precision,notification_channel_state.tokens+EXTRACT(EPOCH FROM (now()-notification_channel_state.refilled_at))*$3::double precision/60),refilled_at=now(),updated_at=now() RETURNING *',
          [org, r.channel, capacity],
        )
      ).rows[0]!;
      const openUntil = state.open_until ? new Date(String(state.open_until)).getTime() : 0;
      if (openUntil > Date.now()) {
        await this.defer(q, d, 'circuit_open', openUntil - Date.now());
        return 'deferred:circuit' as const;
      }
      const tokens = Number(state.tokens);
      if (tokens < 1) {
        await this.defer(q, d, 'rate_limited', Math.ceil(((1 - tokens) * 60000) / capacity));
        return 'deferred:rate' as const;
      }
      await q.query(
        'UPDATE identity_private.notification_channel_state SET tokens=tokens-1,updated_at=now() WHERE organization_id=$1 AND channel=$2',
        [org, r.channel],
      );
      const settings = record(
        JSON.parse(
          unseal(String(provider.config_cipher), this.providerContext(org, String(r.channel))),
        ),
      );
      let recipient = '';
      if (r.channel === 'email') recipient = String(settings.sinkAddress ?? '');
      else if (typeof settings.sinkPhone === 'string') recipient = settings.sinkPhone;
      else {
        const account = (
          await q.query(
            'SELECT phone_cipher FROM identity_private.phone_accounts WHERE organization_id=$1 AND user_id=$2',
            [org, c.userId],
          )
        ).rows[0];
        recipient = account ? unseal(String(account.phone_cipher), 'phone:' + org) : '';
      }
      if (!recipient) return this.terminal(q, d, 'dead_letter', 'recipient_unavailable', org);
      try {
        adapter.validateConfig?.(settings);
      } catch (e) {
        // Stored settings no longer pass the operator policy (e.g. host allowlist changed).
        if (!(e instanceof HttpException && e.getStatus() < 500)) throw e;
        return this.terminal(q, d, 'dead_letter', 'transport_disabled', org);
      }
      const p = await this.notifications.message(q, r),
        abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let outcome: 'delivered' | 'failed' | 'outcome_unknown' = 'outcome_unknown';
      let reason: NotificationDeliveryReason | null = 'timeout';
      let receipt = 'Kết quả kênh chưa xác định; cần vận hành đối chiếu, không tự gửi lại';
      let retryable = false;
      try {
        const result = await Promise.race<NotificationSendResult>([
          adapter.send({
            organizationId: org,
            projectId: String(r.project_id),
            userId: c.userId,
            messageId: String(r.id),
            idempotencyKey: String(r.id),
            title: p.title,
            body: p.body,
            synthetic: true,
            signal: abort.signal,
            recipient,
            config: settings,
          }),
          new Promise<never>((_ok, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(new NotificationProviderError('unknown', 'deadline'));
            }, this.sendDeadlineMs);
          }),
        ]);
        if (
          typeof result?.accepted !== 'boolean' ||
          typeof result.deliveryRef !== 'string' ||
          result.deliveryRef.length < 1 ||
          result.deliveryRef.length > 300
        )
          throw new NotificationProviderError('unknown', 'invalid-receipt');
        outcome = result.accepted ? 'delivered' : 'failed';
        reason = result.accepted ? null : 'provider_rejected';
        receipt = result.deliveryRef;
      } catch (e) {
        if (e instanceof NotificationProviderError && e.kind === 'retryable') {
          outcome = 'failed';
          reason = 'provider_unavailable';
          retryable = true;
          receipt = 'retryable:' + e.code;
        } else if (e instanceof HttpException && e.getStatus() < 500) {
          // Adapter refused the input before contacting the provider: definite, not retryable.
          outcome = 'failed';
          reason = 'recipient_unavailable';
          receipt = 'invalid-input:' + e.getStatus();
        } else {
          outcome = 'outcome_unknown';
          reason = 'timeout';
          receipt =
            'Kết quả kênh chưa xác định (' +
            (e instanceof NotificationProviderError ? e.code : 'error') +
            '); cần vận hành đối chiếu, không tự gửi lại';
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
      const attempt = randomUUID();
      await q.query(
        'INSERT INTO identity_private.notification_attempts(id,organization_id,project_id,message_id,number,outcome,receipt_cipher) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          attempt,
          org,
          r.project_id,
          r.id,
          number,
          outcome,
          seal(receipt, 'notification-attempt:' + attempt),
        ],
      );
      await q.query(
        'UPDATE identity_private.notification_messages SET status=$2,attempt_count=$3,version=version+1 WHERE id=$1',
        [r.id, outcome, number],
      );
      let result: NotificationDeliveryOutcome;
      if (outcome === 'delivered') {
        await q.query(
          'UPDATE identity_private.notification_channel_state SET failure_streak=0,open_until=NULL,updated_at=now() WHERE organization_id=$1 AND channel=$2',
          [org, r.channel],
        );
        await this.job(q, d, 'delivered', null);
        result = 'delivered';
      } else {
        // Only transient failures (5xx/429/4yz, unreachable, silence) count towards the circuit:
        // a definite rejection of one message says nothing about provider health.
        if (retryable || outcome === 'outcome_unknown') {
          const streak = Number(state.failure_streak) + 1;
          const open = streak >= CIRCUIT_THRESHOLD ? this.circuitOpenMs(streak) : 0;
          await q.query(
            "UPDATE identity_private.notification_channel_state SET failure_streak=$3,open_until=CASE WHEN $4::int>0 THEN now()+($4::int*interval '1 millisecond') ELSE NULL END,updated_at=now() WHERE organization_id=$1 AND channel=$2",
            [org, r.channel, streak, open],
          );
        }
        if (outcome === 'outcome_unknown') {
          await this.job(q, d, 'outcome_unknown', 'timeout');
          result = 'outcome_unknown';
        } else if (retryable && number < Number(d.attempt_budget) && number < 3) {
          await this.defer(q, d, 'provider_unavailable', this.backoffMs(number));
          result = 'failed';
        } else {
          await this.job(q, d, 'dead_letter', retryable ? 'attempts_exhausted' : reason);
          result = 'dead_letter';
        }
      }
      await event(q, sys, 'notification.' + outcome, String(r.id));
      if (result === 'dead_letter')
        await event(q, sys, 'notification.delivery-dead-letter', String(r.id));
      this.emit(d, result, retryable && result === 'dead_letter' ? 'attempts_exhausted' : reason, {
        attempt: number,
      });
      return result;
    });
    if (outcome === 'deferred:circuit') {
      this.metrics.circuitOpen++;
      return 'deferred';
    }
    if (outcome === 'deferred:rate') {
      this.metrics.rateLimited++;
      return 'deferred';
    }
    if (outcome === 'delivered') this.metrics.delivered++;
    else if (outcome === 'failed') this.metrics.failed++;
    else if (outcome === 'dead_letter') this.metrics.deadLettered++;
    else if (outcome === 'outcome_unknown') this.metrics.unknown++;
    else if (outcome === 'cancelled') this.metrics.cancelled++;
    return outcome;
  }
  private async failure(claim: NotificationDeliveryClaim) {
    await this.db.tx(async (q) => {
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      await this.notifications.context(q, claim.organizationId);
      const r = (
        await q.query(
          "SELECT * FROM identity_private.notification_deliveries WHERE organization_id=$1 AND message_id=$2 AND status='processing' AND lease_token=$3 FOR UPDATE",
          [claim.organizationId, claim.messageId, claim.leaseToken],
        )
      ).rows[0];
      if (!r) return;
      const failures = Number(r.worker_failures) + 1;
      const dead = failures >= 5;
      await q.query(
        "UPDATE identity_private.notification_deliveries SET status=$2,reason='processing_failed',worker_failures=$3,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '30 seconds',version=version+1,updated_at=now() WHERE message_id=$1",
        [claim.messageId, dead ? 'dead_letter' : 'queued', Math.min(5, failures)],
      );
      await event(
        q,
        this.actor(claim.organizationId),
        dead ? 'notification.delivery-dead-letter' : 'notification.delivery-processing-failed',
        claim.messageId,
      );
      this.emit(r, dead ? 'dead_letter' : 'retry', 'processing_failed', {
        workerFailures: failures,
      });
    });
  }
  async runConfiguredBatch(shouldContinue: () => boolean = () => true) {
    const before = { ...this.metrics };
    const org = this.configuredOrganization();
    if (org)
      for (let i = 0; i < 10 && shouldContinue(); i++) {
        const claim = await this.claimNext(org);
        if (!claim) break;
        this.metrics.claimed++;
        try {
          await this.processClaim(claim);
        } catch (e) {
          // Error class only: messages could carry connection, provider or address details.
          this.metrics.workerFailures++;
          this.log({
            event: 'notification.delivery-worker-failure',
            messageId: claim.messageId,
            organizationId: claim.organizationId,
            error: e instanceof Error ? e.name : 'unknown',
          });
          await this.failure(claim);
        }
      }
    const batch = emptyDeliveryMetrics();
    for (const k of Object.keys(batch) as (keyof NotificationDeliveryMetrics)[])
      batch[k] = this.metrics[k] - before[k];
    return batch;
  }
}
