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
  NotificationTemplateSchema,
  NotificationReviewSchema,
  NotificationQueueSchema,
  NotificationPreferenceSchema,
  NotificationTransportSchema,
  NotificationAcceptedSchema,
  type NotificationTemplateView,
  type NotificationMessageView,
  type NotificationAdminWorkspace,
  type NotificationCitizenWorkspace,
  type NotificationChannel,
  type NotificationPurpose,
} from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { event, uuid, record } from './admin-service';
import { seal, unseal, digest } from './identity-crypto';
import type { Staff } from './workforce';
import type { Citizen } from './phone-service';
import { PrivacyService } from './privacy-service';
const notice =
  'Diễn tập: thông báo gắn hồ sơ giả lập. Hộp thư trong ứng dụng hoạt động nội bộ; email/Zalo chỉ dùng adapter được vận hành phê duyệt, mặc định tắt. Không phải thông báo pháp lý đã tống đạt.';
const text = (v: unknown) => String(v);
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : text(v));
const parse = <T>(s: { safeParse(b: unknown): { success: boolean; data?: T } }, b: unknown): T => {
  const r = s.safeParse(b);
  if (!r.success) throw new BadRequestException('Thông tin hoặc xác nhận chưa hợp lệ');
  return r.data!;
};
function current(r: Row | undefined, v: number) {
  if (Number(r?.version ?? 0) !== v)
    throw new ConflictException('Phiên bản đã thay đổi; tải lại trước khi thao tác');
}
export interface NotificationTransport {
  readonly channel: 'email' | 'zalo';
  readonly supportsIdempotency: true;
  send(input: {
    organizationId: string;
    projectId: string;
    userId: string;
    messageId: string;
    idempotencyKey: string;
    title: string;
    body: string;
    synthetic: true;
    signal: AbortSignal;
  }): Promise<{ accepted: boolean; deliveryRef: string }>;
}
@Injectable()
export class NotificationService {
  /** Operator-installed server adapters only. No URL/credentials accepted from browser. */
  readonly transports = new Map<string, NotificationTransport>();
  constructor(@Inject(Database) readonly db: Database) {}
  private async context(q: Sql, org: string) {
    await q.query("SELECT set_config('app.organization_id',$1,true)", [uuid(org)]);
  }
  private async lock(q: Sql, org: string) {
    await q.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [org]);
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['notifications:' + org]);
  }
  private async scope(q: Sql, s: Staff, project: string, permission: string) {
    await this.context(q, s.organizationId);
    if (s.projectIds?.length && !s.projectIds.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi phiên');
    const p = (
      await q.query(
        'SELECT id,name,is_synthetic FROM projects WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL FOR SHARE',
        [s.organizationId, uuid(project)],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Không có dự án trong phạm vi');
    if (p.is_synthetic !== true)
      throw new ForbiddenException('Thông báo hiện chỉ mở cho dự án giả lập');
    const sensitive = ['form_legal_approver', 'privacy_officer'].includes(permission);
    if (sensitive && !s.permissions?.includes(permission))
      throw new ForbiddenException('Cần quyền độc lập ' + permission);
    if (s.role === 'org_admin' && !sensitive) return p;
    if (s.role !== 'org_admin' && !s.projectIds?.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi phiên');
    const e = (
      await q.query(
        "SELECT e.permissions FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.employee_id=e.id AND g.organization_id=e.organization_id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND g.project_id=$3 FOR SHARE OF e,g",
        [s.organizationId, s.subject, project],
      )
    ).rows[0];
    if (!e || !(e.permissions as string[]).includes(permission))
      throw new ForbiddenException('Tài khoản chưa có quyền hiện hành tại dự án');
    return p;
  }
  private async choice(q: Sql, c: Citizen) {
    return (
      await q.query(
        'SELECT id,action,notice_id FROM identity_private.privacy_choices WHERE organization_id=$1 AND user_id=$2 ORDER BY sequence DESC LIMIT 1',
        [c.organizationId, c.userId],
      )
    ).rows[0];
  }
  private async citizenScope(q: Sql, c: Citizen, project: string) {
    await this.context(q, c.organizationId);
    const p = (
      await q.query(
        'SELECT p.id,p.name FROM projects p WHERE p.organization_id=$1 AND p.id=$2 AND p.is_synthetic=true AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM applications a WHERE a.organization_id=p.organization_id AND a.project_id=p.id AND a.owner_user_id=$3 AND a.synthetic=true)',
        [c.organizationId, uuid(project), c.userId],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Chưa có hồ sơ của bạn tại dự án này');
    return p;
  }
  private template(r: Row): NotificationTemplateView {
    return {
      ...record(JSON.parse(unseal(text(r.payload_cipher), 'notification-template:' + r.id))),
      id: text(r.id),
      projectId: text(r.project_id),
      name: text(r.name),
      channel: r.channel as NotificationChannel,
      purpose: r.purpose as NotificationPurpose,
      status: r.status as NotificationTemplateView['status'],
      createdBy: text(r.created_by),
      reviewedBy: r.reviewed_by ? text(r.reviewed_by) : null,
      version: Number(r.version),
    } as NotificationTemplateView;
  }
  private async message(q: Sql, r: Row): Promise<NotificationMessageView> {
    const p = record(
      JSON.parse(
        unseal(text(r.payload_cipher), 'notification-message:' + r.organization_id + ':' + r.id),
      ),
    );
    const attempts = (
      await q.query(
        'SELECT number,outcome,created_at FROM identity_private.notification_attempts WHERE organization_id=$1 AND message_id=$2 ORDER BY number',
        [r.organization_id, r.id],
      )
    ).rows;
    return {
      id: text(r.id),
      projectId: text(r.project_id),
      applicationCode: text(p.applicationCode),
      title: text(p.title),
      body: text(p.body),
      channel: r.channel as NotificationChannel,
      purpose: r.purpose as NotificationPurpose,
      status: r.status as NotificationMessageView['status'],
      version: Number(r.version),
      attemptCount: Number(r.attempt_count),
      createdAt: iso(r.created_at),
      readAt: r.read_at ? iso(r.read_at) : null,
      attempts: attempts.map((a) => ({
        number: Number(a.number),
        outcome: text(a.outcome),
        at: iso(a.created_at),
      })),
    };
  }
  private async row(q: Sql, org: string, project: string, id: string) {
    const r = (
      await q.query(
        'SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
        [org, uuid(project), uuid(id)],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có thông báo trong phạm vi');
    return r;
  }
  async workspace(s: Staff, project: string): Promise<NotificationAdminWorkspace> {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_read');
      const templates = (
        await q.query(
          'SELECT * FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      const rows = (
        await q.query(
          'SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      const applications = (
        await q.query(
          "SELECT id,public_code FROM applications WHERE organization_id=$1 AND project_id=$2 AND synthetic=true AND status<>'withdrawn' ORDER BY submitted_at DESC,id LIMIT 100",
          [s.organizationId, project],
        )
      ).rows;
      const ts = (
        await q.query(
          'SELECT * FROM identity_private.notification_transports WHERE organization_id=$1 AND project_id=$2',
          [s.organizationId, project],
        )
      ).rows;
      return {
        templates: templates.map((r) => this.template(r)),
        messages: await Promise.all(rows.map((r) => this.message(q, r))),
        applications: applications.map((a) => ({ id: text(a.id), code: text(a.public_code) })),
        transports: ts.map((t) => ({
          channel: t.channel as 'email' | 'zalo',
          adapterId: text(t.adapter_id),
          enabled: t.enabled === true,
          maxAttempts: Number(t.max_attempts),
          version: Number(t.version),
        })),
        externalEnabled: process.env.NOTIFICATIONS_EXTERNAL_ENABLED === 'true',
        registeredAdapters: [...this.transports.keys()].sort(),
        notice,
      };
    });
  }
  async draft(s: Staff, project: string, body: unknown) {
    const b = parse(NotificationTemplateSchema, body);
    // Only fixed, non-executable variables. HTML and arbitrary expressions are never evaluated.
    if (
      [b.title, b.body].some(
        (v) =>
          /[<>]/.test(v) ||
          /\{(?!projectName\}|applicationCode\}|reference\})[^}]*\}/.test(v) ||
          /[{}]/.test(v.replace(/\{(?:projectName|applicationCode|reference)\}/g, '')),
      )
    )
      throw new BadRequestException(
        'Chỉ dùng văn bản và biến {projectName}, {applicationCode}, {reference}',
      );
    return this.db.tx(async (q) => {
      await this.lock(q, s.organizationId);
      await this.scope(q, s, project, 'records_write');
      const requestHash = digest('notification-request', JSON.stringify({ project, ...b }));
      const old = (
        await q.query(
          'SELECT * FROM identity_private.notification_templates WHERE organization_id=$1 AND idempotency_key=$2',
          [s.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash || old.created_by !== s.subject)
          throw new ConflictException('Mã yêu cầu đã dùng với nội dung khác');
        return this.template(old);
      }
      const id = randomUUID();
      const payload = { title: b.title, body: b.body, basis: b.basis };
      const r = (
        await q.query(
          'INSERT INTO identity_private.notification_templates(id,organization_id,project_id,name,channel,purpose,payload_cipher,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
          [
            id,
            s.organizationId,
            project,
            b.name,
            b.channel,
            b.purpose,
            seal(JSON.stringify(payload), 'notification-template:' + id),
            s.subject,
            b.idempotencyKey,
            requestHash,
          ],
        )
      ).rows[0]!;
      await event(q, s, 'notification.template-drafted', id);
      return this.template(r);
    });
  }
  async review(s: Staff, project: string, id: string, body: unknown, v: number) {
    const b = parse(NotificationReviewSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, s.organizationId);
      await this.scope(q, s, project, 'form_legal_approver');
      const r = (
        await q.query(
          'SELECT * FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
          [s.organizationId, project, uuid(id)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có mẫu');
      current(r, v);
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người soạn không tự duyệt hoặc thu hồi mẫu');
      if (r.status !== (b.decision === 'revoke' ? 'approved' : 'draft'))
        throw new ConflictException('Trạng thái mẫu không cho phép quyết định này');
      const status =
        b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'revoked';
      const saved = (
        await q.query(
          'UPDATE identity_private.notification_templates SET status=$2,reviewed_by=$3,review_cipher=$4,version=version+1 WHERE id=$1 RETURNING *',
          [id, status, s.subject, seal(b.note, 'notification-review:' + id)],
        )
      ).rows[0]!;
      const reviewId = randomUUID();
      await q.query(
        'INSERT INTO identity_private.notification_template_reviews(id,organization_id,project_id,template_id,decision,reviewed_by,note_cipher,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          reviewId,
          s.organizationId,
          project,
          id,
          b.decision,
          s.subject,
          seal(b.note, 'notification-review-event:' + reviewId),
          saved.version,
        ],
      );
      if (status === 'revoked')
        await q.query(
          "UPDATE identity_private.notification_messages SET status='cancelled',version=version+1 WHERE organization_id=$1 AND template_id=$2 AND status IN('queued','failed')",
          [s.organizationId, id],
        );
      await event(q, s, 'notification.template-' + status, id);
      return this.template(saved);
    });
  }
  async preference(c: Citizen, project: string, body: unknown, v: number) {
    const b = parse(NotificationPreferenceSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, c.organizationId);
      await this.citizenScope(q, c, project);
      const consent = b.enabled ? await new PrivacyService(this.db).assertProcessing(c, q) : null;
      const choice = b.enabled ? await this.choice(q, c) : null;
      const old = (
        await q.query(
          'SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel=$4 AND purpose=$5 FOR UPDATE',
          [c.organizationId, project, c.userId, b.channel, b.purpose],
        )
      ).rows[0];
      current(old, v);
      const r = (
        await q.query(
          'INSERT INTO identity_private.notification_preferences(organization_id,project_id,user_id,channel,purpose,enabled,notice_id,notice_hash,choice_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(organization_id,project_id,user_id,channel,purpose) DO UPDATE SET enabled=excluded.enabled,notice_id=excluded.notice_id,notice_hash=excluded.notice_hash,choice_id=excluded.choice_id,version=notification_preferences.version+1,updated_at=now() RETURNING *',
          [
            c.organizationId,
            project,
            c.userId,
            b.channel,
            b.purpose,
            b.enabled,
            consent?.noticeId ?? null,
            consent?.noticeHash ?? null,
            choice?.id ?? null,
          ],
        )
      ).rows[0]!;
      await q.query(
        'INSERT INTO identity_private.notification_preference_events(id,organization_id,project_id,user_id,channel,purpose,enabled,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          c.organizationId,
          project,
          c.userId,
          b.channel,
          b.purpose,
          b.enabled,
          r.version,
        ],
      );
      // Any preference revision invalidates the old queued authorization, including withdraw/regrant.
      await q.query(
        "UPDATE identity_private.notification_messages SET status='cancelled',version=version+1 WHERE organization_id=$1 AND project_id=$2 AND owner_user_id=$3 AND channel=$4 AND purpose=$5 AND status IN('queued','failed')",
        [c.organizationId, project, c.userId, b.channel, b.purpose],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'notification.preference-' + (b.enabled ? 'granted' : 'withdrawn'),
        project,
      );
      return {
        projectId: project,
        channel: b.channel,
        purpose: b.purpose,
        enabled: b.enabled,
        version: Number(r.version),
      };
    });
  }
  async configure(s: Staff, project: string, body: unknown, v: number) {
    const b = parse(NotificationTransportSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, s.organizationId);
      await this.scope(q, s, project, b.enabled ? 'privacy_officer' : 'records_write');
      const adapter = this.transports.get(b.adapterId);
      if (
        b.enabled &&
        (process.env.NOTIFICATIONS_EXTERNAL_ENABLED !== 'true' ||
          !adapter ||
          adapter.channel !== b.channel ||
          adapter.supportsIdempotency !== true)
      )
        throw new ServiceUnavailableException(
          'Vận hành chưa bật hoặc chưa đăng ký adapter có idempotency cho kênh này',
        );
      const old = (
        await q.query(
          'SELECT * FROM identity_private.notification_transports WHERE organization_id=$1 AND project_id=$2 AND channel=$3 FOR UPDATE',
          [s.organizationId, project, b.channel],
        )
      ).rows[0];
      current(old, v);
      const r = (
        await q.query(
          'INSERT INTO identity_private.notification_transports(organization_id,project_id,channel,enabled,adapter_id,max_attempts) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,project_id,channel) DO UPDATE SET enabled=excluded.enabled,adapter_id=excluded.adapter_id,max_attempts=excluded.max_attempts,version=notification_transports.version+1 RETURNING *',
          [s.organizationId, project, b.channel, b.enabled, b.adapterId, b.maxAttempts],
        )
      ).rows[0]!;
      await event(q, s, 'notification.transport-configured', project);
      return {
        channel: b.channel,
        enabled: b.enabled,
        adapterId: b.adapterId,
        maxAttempts: b.maxAttempts,
        version: Number(r.version),
      };
    });
  }
  async queue(s: Staff, project: string, body: unknown) {
    const b = parse(NotificationQueueSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, s.organizationId);
      const p = await this.scope(q, s, project, 'records_write');
      const requestHash = digest('notification-request', JSON.stringify({ project, ...b }));
      const old = (
        await q.query(
          'SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND idempotency_key=$2',
          [s.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== requestHash || old.created_by !== s.subject)
          throw new ConflictException('Mã yêu cầu đã dùng với nội dung khác');
        return this.message(q, old);
      }
      const t = (
        await q.query(
          "SELECT * FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND status='approved' FOR SHARE",
          [s.organizationId, project, b.templateId],
        )
      ).rows[0];
      if (!t) throw new ConflictException('Mẫu chưa được duyệt hoặc đã thu hồi');
      const a = (
        await q.query(
          "SELECT a.* FROM applications a JOIN users u ON u.organization_id=a.organization_id AND u.id=a.owner_user_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND a.synthetic=true AND a.status<>'withdrawn' AND u.status='active' FOR SHARE OF a,u",
          [s.organizationId, project, b.applicationId],
        )
      ).rows[0];
      if (!a) throw new NotFoundException('Không có hồ sơ giả lập hiện hành trong dự án');
      const c = { organizationId: s.organizationId, userId: text(a.owner_user_id) },
        consent = await new PrivacyService(this.db).assertProcessing(c, q);
      const choice = await this.choice(q, c);
      const pref = (
        await q.query(
          'SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel=$4 AND purpose=$5 FOR SHARE',
          [s.organizationId, project, c.userId, t.channel, t.purpose],
        )
      ).rows[0];
      if (
        pref?.enabled !== true ||
        pref.notice_id !== consent.noticeId ||
        pref.notice_hash !== consent.noticeHash ||
        pref.choice_id !== choice?.id
      )
        throw new HttpException(
          'Khách hàng chưa đồng ý đúng mục đích, kênh và thông báo hiện hành',
          428,
        );
      const template = this.template(t),
        vars: Record<string, string> = {
          projectName: text(p.name),
          applicationCode: text(a.public_code),
          reference: b.reference,
        };
      const render = (v: string) =>
        v.replace(/\{(projectName|applicationCode|reference)\}/g, (_all, k: string) => vars[k]!);
      const id = randomUUID(),
        payload = {
          title: render(template.title),
          body: render(template.body),
          applicationCode: text(a.public_code),
          templateVersion: Number(t.version),
        };
      const r = (
        await q.query(
          'INSERT INTO identity_private.notification_messages(id,organization_id,project_id,template_id,application_id,owner_user_id,channel,purpose,payload_cipher,notice_id,notice_hash,choice_id,preference_version,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',
          [
            id,
            s.organizationId,
            project,
            t.id,
            a.id,
            c.userId,
            t.channel,
            t.purpose,
            seal(JSON.stringify(payload), 'notification-message:' + s.organizationId + ':' + id),
            consent.noticeId,
            consent.noticeHash,
            choice!.id,
            pref.version,
            b.idempotencyKey,
            requestHash,
            s.subject,
          ],
        )
      ).rows[0]!;
      await event(q, s, 'notification.queued', id);
      return this.message(q, r);
    });
  }
  async deliver(s: Staff, project: string, id: string, body: unknown, v: number) {
    parse(NotificationAcceptedSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, s.organizationId);
      await this.scope(q, s, project, 'records_write');
      const r = await this.row(q, s.organizationId, project, id);
      if (r.status === 'delivered') return this.message(q, r);
      current(r, v);
      if (!['queued', 'failed'].includes(text(r.status)))
        throw new ConflictException(
          'Thông báo đã kết thúc hoặc chưa xác định kết quả; không tự gửi lại',
        );
      const c = { organizationId: s.organizationId, userId: text(r.owner_user_id) };
      const choice = await this.choice(q, c);
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
          'SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel=$4 AND purpose=$5 FOR SHARE',
          [s.organizationId, project, c.userId, r.channel, r.purpose],
        )
      ).rows[0];
      const template = (
        await q.query(
          'SELECT status FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR SHARE',
          [s.organizationId, project, r.template_id],
        )
      ).rows[0];
      const application = (
        await q.query(
          "SELECT a.id FROM applications a JOIN users u ON u.organization_id=a.organization_id AND u.id=a.owner_user_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND a.owner_user_id=$4 AND a.synthetic=true AND a.status<>'withdrawn' AND u.status='active' FOR SHARE OF a,u",
          [s.organizationId, project, r.application_id, c.userId],
        )
      ).rows[0];
      if (
        cancelled ||
        pref?.enabled !== true ||
        Number(pref.version) !== Number(r.preference_version) ||
        template?.status !== 'approved' ||
        !application
      ) {
        const saved = (
          await q.query(
            "UPDATE identity_private.notification_messages SET status='cancelled',version=version+1 WHERE id=$1 RETURNING *",
            [r.id],
          )
        ).rows[0]!;
        await event(q, s, 'notification.cancelled', id);
        return this.message(q, saved);
      }
      let adapter: NotificationTransport | undefined,
        maxAttempts = 1;
      if (r.channel !== 'in_app') {
        const config = (
          await q.query(
            'SELECT * FROM identity_private.notification_transports WHERE organization_id=$1 AND project_id=$2 AND channel=$3 FOR SHARE',
            [s.organizationId, project, r.channel],
          )
        ).rows[0];
        adapter = config ? this.transports.get(text(config.adapter_id)) : undefined;
        if (
          process.env.NOTIFICATIONS_EXTERNAL_ENABLED !== 'true' ||
          config?.enabled !== true ||
          !adapter ||
          adapter.channel !== r.channel ||
          adapter.supportsIdempotency !== true
        )
          throw new ServiceUnavailableException(
            'Kênh ngoài chưa được bật và cấu hình adapter hợp lệ',
          );
        maxAttempts = Number(config.max_attempts);
      }
      const number = Number(r.attempt_count) + 1;
      if (number > maxAttempts || number > 3)
        throw new ConflictException('Đã hết số lần thử được phê duyệt');
      let outcome = 'delivered',
        receipt = 'in-app:' + r.id;
      if (adapter) {
        const p = await this.message(q, r),
          abort = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            adapter.send({
              organizationId: s.organizationId,
              projectId: project,
              userId: c.userId,
              messageId: id,
              idempotencyKey: id,
              title: p.title,
              body: p.body,
              synthetic: true,
              signal: abort.signal,
            }),
            new Promise<never>((_ok, reject) => {
              timer = setTimeout(() => {
                abort.abort();
                reject(new Error('deadline'));
              }, 8000);
            }),
          ]);
          if (
            typeof result?.accepted !== 'boolean' ||
            typeof result.deliveryRef !== 'string' ||
            result.deliveryRef.length < 1 ||
            result.deliveryRef.length > 300
          )
            throw new Error('invalid adapter receipt');
          outcome = result.accepted ? 'delivered' : 'failed';
          receipt = result.deliveryRef;
        } catch {
          outcome = 'outcome_unknown';
          receipt = 'Kết quả kênh chưa xác định; cần vận hành đối chiếu, không tự gửi lại';
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      const attempt = randomUUID();
      await q.query(
        'INSERT INTO identity_private.notification_attempts(id,organization_id,project_id,message_id,number,outcome,receipt_cipher) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          attempt,
          s.organizationId,
          project,
          id,
          number,
          outcome,
          seal(receipt, 'notification-attempt:' + attempt),
        ],
      );
      const saved = (
        await q.query(
          'UPDATE identity_private.notification_messages SET status=$2,attempt_count=$3,version=version+1 WHERE id=$1 RETURNING *',
          [id, outcome, number],
        )
      ).rows[0]!;
      await event(q, s, 'notification.' + outcome, id);
      return this.message(q, saved);
    });
  }
  async citizenWorkspace(c: Citizen): Promise<NotificationCitizenWorkspace> {
    return this.db.tx(async (q) => {
      await this.context(q, c.organizationId);
      const projects = (
        await q.query(
          'SELECT DISTINCT p.id,p.name FROM projects p JOIN applications a ON a.project_id=p.id AND a.organization_id=p.organization_id WHERE p.organization_id=$1 AND a.owner_user_id=$2 AND a.synthetic=true AND p.is_synthetic=true AND p.archived_at IS NULL ORDER BY p.name,p.id LIMIT 100',
          [c.organizationId, c.userId],
        )
      ).rows;
      const choice = await this.choice(q, c),
        currentNotice = await new PrivacyService(this.db).current(c.organizationId, q);
      const prefs = (
        await q.query(
          'SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND user_id=$2 AND project_id=ANY($3::uuid[]) ORDER BY project_id,channel,purpose LIMIT 600',
          [c.organizationId, c.userId, projects.map((p) => p.id)],
        )
      ).rows;
      const rows = (
        await q.query(
          "SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND owner_user_id=$2 AND channel='in_app' AND status='delivered' ORDER BY created_at DESC,id LIMIT 100",
          [c.organizationId, c.userId],
        )
      ).rows;
      return {
        items: await Promise.all(rows.map((r) => this.message(q, r))),
        preferences: prefs.map((r) => ({
          projectId: text(r.project_id),
          channel: r.channel as NotificationChannel,
          purpose: r.purpose as NotificationPurpose,
          enabled:
            r.enabled === true &&
            choice?.action === 'grant' &&
            r.choice_id === choice.id &&
            currentNotice?.id === r.notice_id,
          version: Number(r.version),
        })),
        projects: projects.map((p) => ({ id: text(p.id), name: text(p.name) })),
        notice,
      };
    });
  }
  async read(c: Citizen, id: string, body: unknown, v: number) {
    parse(NotificationAcceptedSchema, body);
    return this.db.tx(async (q) => {
      await this.lock(q, c.organizationId);
      await this.context(q, c.organizationId);
      const r = (
        await q.query(
          "SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND owner_user_id=$2 AND id=$3 AND channel='in_app' AND status='delivered' FOR UPDATE",
          [c.organizationId, c.userId, uuid(id)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có thư của bạn');
      if (r.read_at) return this.message(q, r);
      current(r, v);
      const saved = (
        await q.query(
          'UPDATE identity_private.notification_messages SET read_at=now(),version=version+1 WHERE id=$1 RETURNING *',
          [id],
        )
      ).rows[0]!;
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'notification.read',
        id,
      );
      return this.message(q, saved);
    });
  }
}
