import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  NotificationAutomationPolicySchema,
  NotificationAutomationReviewSchema,
  type NotificationAutomationWorkspace,
  type NotificationAutomationPolicyView,
  type NotificationAutomationEventView,
  type NotificationAutomationReason,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, uuid, record } from './admin-service';
import { digest, seal, unseal } from './identity-crypto';
import { PrivacyService } from './privacy-service';
import type { Staff } from './workforce';
import { notificationAutomationEnabled } from './notification-automation-producer';
export interface NotificationAutomationClaim {
  id: string;
  organizationId: string;
  leaseToken: string;
}
export interface NotificationAutomationBatch {
  claimed: number;
  delivered: number;
  skipped: number;
  failed: number;
}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const notice =
  'Chỉ thông báo diễn tập trong ứng dụng cho yêu cầu bổ sung và quyết định hồ sơ. Mặc định tắt; không gửi email/Zalo, không phải tống đạt pháp lý. Sự kiện thiếu quy tắc hoặc đồng ý sẽ không tự phát lại.';
const refs: Record<string, string> = {
  'application.supplement-requested':
    'Hồ sơ diễn tập có yêu cầu bổ sung; mở hồ sơ của bạn để xem chi tiết.',
  'application.approved':
    'Hồ sơ diễn tập đã có quyết định chấp thuận; mở hồ sơ của bạn để đối chiếu.',
  'application.rejected': 'Hồ sơ diễn tập đã có quyết định từ chối; mở hồ sơ của bạn để đối chiếu.',
};
function parse<T>(
  schema: { safeParse(b: unknown): { success: boolean; data?: T } },
  b: unknown,
): T {
  const v = schema.safeParse(b);
  if (!v.success) throw new BadRequestException('Thông tin quy tắc hoặc xác nhận chưa hợp lệ');
  return v.data!;
}
@Injectable()
export class NotificationAutomationService {
  constructor(@Inject(Database) readonly db: Database) {}
  private async context(q: Sql, org: string) {
    await q.query("SELECT set_config('app.organization_id',$1,true)", [uuid(org)]);
  }
  private async locks(q: Sql, org: string) {
    await this.context(q, org);
    await q.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [org]);
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['notifications:' + org]);
  }
  private async scope(q: Sql, s: Staff, project: string, permission: string) {
    if (s.projectIds?.length && !s.projectIds.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi phiên');
    const p = (
      await q.query(
        'SELECT id FROM projects WHERE organization_id=$1 AND id=$2 AND is_synthetic=true AND archived_at IS NULL FOR SHARE',
        [s.organizationId, uuid(project)],
      )
    ).rows[0];
    if (!p)
      throw new NotFoundException('Chỉ mở thông báo tự động cho dự án diễn tập trong phạm vi');
    const sensitive = permission === 'form_legal_approver';
    if (sensitive && !s.permissions?.includes(permission))
      throw new ForbiddenException('Cần quyền pháp chế độc lập trong phiên');
    if (s.role === 'org_admin' && !sensitive) return;
    if (s.role !== 'org_admin' && !s.projectIds?.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi phiên');
    const e = (
      await q.query(
        "SELECT e.id,e.version,e.permissions FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.organization_id=e.organization_id AND g.employee_id=e.id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND g.project_id=$3 FOR SHARE OF e,g",
        [s.organizationId, s.subject, project],
      )
    ).rows[0];
    if (!e || !(e.permissions as string[]).includes(permission))
      throw new ForbiddenException('Nhân sự chưa có quyền hiện hành tại dự án');
    return e;
  }
  private policy(r: Row): NotificationAutomationPolicyView {
    return {
      id: String(r.id),
      eventType: r.event_type as NotificationAutomationPolicyView['eventType'],
      templateId: String(r.template_id),
      templateName: String(r.template_name),
      status: r.status as NotificationAutomationPolicyView['status'],
      version: Number(r.version),
      createdBy: String(r.created_by),
      reviewedBy: r.reviewed_by ? String(r.reviewed_by) : null,
      note: r.review_cipher
        ? unseal(String(r.review_cipher), 'notification-automation-review:' + r.id)
        : null,
    };
  }
  private async policyRow(q: Sql, org: string, project: string, id: string, lock = false) {
    const r = (
      await q.query(
        `SELECT r.*,t.name AS template_name FROM identity_private.notification_automation_policies r JOIN identity_private.notification_templates t ON t.organization_id=r.organization_id AND t.project_id=r.project_id AND t.id=r.template_id WHERE r.organization_id=$1 AND r.project_id=$2 AND r.id=$3 ${lock ? 'FOR UPDATE OF r' : ''}`,
        [org, uuid(project), uuid(id)],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có quy tắc trong phạm vi');
    return r;
  }
  async workspace(s: Staff, project: string): Promise<NotificationAutomationWorkspace> {
    return this.db.tx(async (q) => {
      await this.context(q, s.organizationId);
      await this.scope(q, s, project, 'records_read');
      const policies = (
        await q.query(
          'SELECT r.*,t.name AS template_name FROM identity_private.notification_automation_policies r JOIN identity_private.notification_templates t ON t.organization_id=r.organization_id AND t.project_id=r.project_id AND t.id=r.template_id WHERE r.organization_id=$1 AND r.project_id=$2 ORDER BY r.created_at DESC,r.id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      const rows = (
        await q.query(
          'SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      const stats = { pending: 0, processing: 0, delivered: 0, skipped: 0, failed: 0 };
      for (const r of (
        await q.query(
          'SELECT status,count(*)::int AS n FROM identity_private.notification_automation_events WHERE organization_id=$1 AND project_id=$2 GROUP BY status',
          [s.organizationId, project],
        )
      ).rows)
        stats[r.status as keyof typeof stats] = Number(r.n);
      return {
        policies: policies.map((r) => this.policy(r)),
        events: rows.map((r) => ({
          id: String(r.id),
          eventType: r.event_type as NotificationAutomationEventView['eventType'],
          applicationCode: String(r.application_code),
          applicationVersion: Number(r.application_version),
          status: r.status as NotificationAutomationEventView['status'],
          reason: r.reason as NotificationAutomationReason | null,
          attemptCount: Number(r.attempt_count),
          createdAt: iso(r.created_at),
          processedAt: r.processed_at ? iso(r.processed_at) : null,
          messageId: r.message_id ? String(r.message_id) : null,
        })),
        stats,
        enabled: notificationAutomationEnabled(),
        notice,
      };
    });
  }
  async draft(s: Staff, project: string, body: unknown) {
    const b = parse(NotificationAutomationPolicySchema, body);
    return this.db.tx(async (q) => {
      await this.locks(q, s.organizationId);
      await this.scope(q, s, project, 'records_write');
      const hash = digest('notification-automation-policy', JSON.stringify({ project, ...b }));
      const old = (
        await q.query(
          'SELECT id,request_hash,created_by FROM identity_private.notification_automation_policies WHERE organization_id=$1 AND idempotency_key=$2',
          [s.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (old) {
        if (old.request_hash !== hash || old.created_by !== s.subject)
          throw new ConflictException('Khóa yêu cầu đã được dùng với nội dung khác');
        return this.policy(await this.policyRow(q, s.organizationId, project, String(old.id)));
      }
      const t = (
        await q.query(
          "SELECT id,version FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND status='approved' AND channel='in_app' AND purpose='transactional' FOR SHARE",
          [s.organizationId, project, b.templateId],
        )
      ).rows[0];
      if (!t)
        throw new ConflictException(
          'Cần mẫu trong ứng dụng, đúng mục đích nghiệp vụ và đã được duyệt',
        );
      const id = randomUUID();
      await q.query(
        'INSERT INTO identity_private.notification_automation_policies(id,organization_id,project_id,event_type,template_id,template_version,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          id,
          s.organizationId,
          project,
          b.eventType,
          t.id,
          t.version,
          s.subject,
          b.idempotencyKey,
          hash,
        ],
      );
      await event(q, s, 'notification.automation-policy-drafted', id);
      return this.policy(await this.policyRow(q, s.organizationId, project, id));
    });
  }
  async review(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = parse(NotificationAutomationReviewSchema, body);
    return this.db.tx(async (q) => {
      await this.locks(q, s.organizationId);
      const reviewer = (await this.scope(q, s, project, 'form_legal_approver'))!;
      const r = await this.policyRow(q, s.organizationId, project, id, true);
      if (Number(r.version) !== expected)
        throw new ConflictException('Phiên bản quy tắc đã thay đổi');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người lập không tự duyệt hoặc thu hồi quy tắc của mình');
      if (
        (b.decision === 'revoke' && r.status !== 'approved') ||
        (b.decision !== 'revoke' && r.status !== 'draft')
      )
        throw new ConflictException('Quy tắc không ở giai đoạn phù hợp');
      const status =
        b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'revoked';
      if (status === 'approved') {
        const t = (
          await q.query(
            "SELECT version FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND status='approved' AND channel='in_app' AND purpose='transactional' FOR SHARE",
            [s.organizationId, project, r.template_id],
          )
        ).rows[0];
        if (!t || Number(t.version) !== Number(r.template_version))
          throw new ConflictException('Mẫu nguồn đã đổi hoặc bị thu hồi');
        if (
          (
            await q.query(
              "SELECT id FROM identity_private.notification_automation_policies WHERE organization_id=$1 AND project_id=$2 AND event_type=$3 AND status='approved'",
              [s.organizationId, project, r.event_type],
            )
          ).rows.length
        )
          throw new ConflictException('Phải thu hồi quy tắc đang áp dụng trước khi duyệt bản khác');
      }
      const cipher = seal(b.note, 'notification-automation-review:' + id);
      await q.query(
        'INSERT INTO identity_private.notification_automation_reviews(id,organization_id,project_id,policy_id,decision,reviewed_by,note_cipher,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          s.organizationId,
          project,
          id,
          b.decision,
          s.subject,
          cipher,
          Number(r.version) + 1,
        ],
      );
      await q.query(
        'UPDATE identity_private.notification_automation_policies SET status=$2,reviewed_by=$3,review_cipher=$4,reviewed_employee_id=$5,reviewed_employee_version=$6,version=version+1 WHERE id=$1',
        [id, status, s.subject, cipher, reviewer.id, reviewer.version],
      );
      if (status === 'revoked')
        await q.query(
          "UPDATE identity_private.notification_automation_events SET status='skipped',reason='rule_unavailable',lease_token=NULL,lease_until=NULL,processed_at=now(),version=version+1 WHERE organization_id=$1 AND project_id=$2 AND policy_id=$3 AND status IN('pending','processing')",
          [s.organizationId, project, id],
        );
      await event(q, s, 'notification.automation-policy-' + status, id);
      return this.policy(await this.policyRow(q, s.organizationId, project, id));
    });
  }
  private actor(org: string) {
    return { organizationId: org, subject: 'system:notification-automation' };
  }
  /** Internal worker capability: bound by configured org, never accepts browser identity or Staff. */
  async claimNext(organizationId: string): Promise<NotificationAutomationClaim | null> {
    const org = uuid(organizationId),
      configured = this.configuredOrganization();
    if (!configured) return null;
    if (configured !== org)
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    return this.db.tx(async (q) => {
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      await this.context(q, org);
      const expired = (
        await q.query(
          "SELECT id FROM identity_private.notification_automation_events WHERE organization_id=$1 AND attempt_count>=3 AND (status='pending' OR(status='processing' AND lease_until<=now())) ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED",
          [org],
        )
      ).rows;
      for (const e of expired)
        await q.query(
          "UPDATE identity_private.notification_automation_events SET status='failed',reason='attempts_exhausted',lease_token=NULL,lease_until=NULL,processed_at=now(),version=version+1 WHERE id=$1",
          [e.id],
        );
      const r = (
        await q.query(
          "SELECT id FROM identity_private.notification_automation_events WHERE organization_id=$1 AND attempt_count<3 AND ((status='pending' AND next_attempt_at<=now()) OR(status='processing' AND lease_until<=now())) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [org],
        )
      ).rows[0];
      const leaseToken = randomUUID();
      if (r)
        await q.query(
          "UPDATE identity_private.notification_automation_events SET status='processing',reason=NULL,lease_token=$2,lease_until=now()+interval '30 seconds',attempt_count=attempt_count+1,version=version+1 WHERE id=$1",
          [r.id, leaseToken],
        );
      // Audit is last: never acquire another event row after the audit chain lock.
      for (const e of expired)
        await event(q, this.actor(org), 'notification.automation-attempts-exhausted', String(e.id));
      if (!r) return null;
      await event(q, this.actor(org), 'notification.automation-claimed', String(r.id));
      return { id: String(r.id), organizationId: org, leaseToken };
    });
  }
  private async terminal(q: Sql, r: Row, reason: NotificationAutomationReason) {
    await q.query(
      "UPDATE identity_private.notification_automation_events SET status='skipped',reason=$2,lease_token=NULL,lease_until=NULL,processed_at=now(),version=version+1 WHERE id=$1",
      [r.id, reason],
    );
    await event(
      q,
      this.actor(String(r.organization_id)),
      'notification.automation-skipped:' + reason,
      String(r.id),
    );
    return 'skipped' as const;
  }
  async processClaim(
    claim: NotificationAutomationClaim,
  ): Promise<'delivered' | 'skipped' | 'lost'> {
    const org = this.configuredOrganization();
    if (!org) return 'lost';
    if (org !== uuid(claim.organizationId))
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    return this.db.tx(async (q) => {
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      await this.locks(q, uuid(claim.organizationId));
      const r = (
        await q.query(
          "SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1 AND id=$2 AND status='processing' AND lease_token=$3 AND lease_until>now() FOR UPDATE",
          [claim.organizationId, uuid(claim.id), uuid(claim.leaseToken)],
        )
      ).rows[0];
      if (!r) return 'lost';
      const p = (
        await q.query(
          'SELECT id,name FROM projects WHERE organization_id=$1 AND id=$2 AND is_synthetic=true AND archived_at IS NULL FOR SHARE',
          [r.organization_id, r.project_id],
        )
      ).rows[0];
      const a = (
        await q.query(
          'SELECT a.*,u.status AS user_status FROM applications a JOIN users u ON u.id=a.owner_user_id AND u.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND a.owner_user_id=$4 FOR SHARE OF a,u',
          [r.organization_id, r.project_id, r.application_id, r.owner_user_id],
        )
      ).rows[0];
      if (!p || !a || a.synthetic !== true || a.user_status !== 'active')
        return this.terminal(q, r, 'recipient_unavailable');
      const expectedStatus = {
        'application.supplement-requested': 'supplement',
        'application.approved': 'approved',
        'application.rejected': 'rejected',
      }[String(r.event_type)];
      if (Number(a.version) !== Number(r.application_version) || a.status !== expectedStatus)
        return this.terminal(q, r, 'application_stale');
      const policy = (
        await q.query(
          'SELECT status,version,template_id,template_version,reviewed_by,reviewed_employee_id,reviewed_employee_version FROM identity_private.notification_automation_policies WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR SHARE',
          [r.organization_id, r.project_id, r.policy_id],
        )
      ).rows[0];
      if (
        !policy ||
        policy.status !== 'approved' ||
        Number(policy.version) !== Number(r.policy_version) ||
        policy.template_id !== r.template_id
      )
        return this.terminal(q, r, 'rule_unavailable');
      const reviewer = (
        await q.query(
          "SELECT e.id,e.version FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.organization_id=e.organization_id AND g.employee_id=e.id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND 'form_legal_approver'=ANY(e.permissions) AND g.project_id=$3 FOR SHARE OF e,g",
          [r.organization_id, policy.reviewed_by, r.project_id],
        )
      ).rows[0];
      if (
        !reviewer ||
        reviewer.id !== policy.reviewed_employee_id ||
        Number(reviewer.version) !== Number(policy.reviewed_employee_version)
      )
        return this.terminal(q, r, 'rule_unavailable');
      const template = (
        await q.query(
          'SELECT * FROM identity_private.notification_templates WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR SHARE',
          [r.organization_id, r.project_id, r.template_id],
        )
      ).rows[0];
      if (
        !template ||
        template.status !== 'approved' ||
        Number(template.version) !== Number(r.template_version) ||
        template.channel !== 'in_app' ||
        template.purpose !== 'transactional'
      )
        return this.terminal(q, r, 'template_unavailable');
      const citizen = {
        organizationId: String(r.organization_id),
        userId: String(r.owner_user_id),
      };
      try {
        const consent = await new PrivacyService(this.db).assertProcessing(citizen, q);
        if (consent.noticeId !== r.notice_id || consent.noticeHash !== r.notice_hash)
          return this.terminal(q, r, 'consent_unavailable');
      } catch (e) {
        if (e instanceof ForbiddenException) return this.terminal(q, r, 'processing_restricted');
        if (
          e instanceof Error &&
          'getStatus' in e &&
          typeof e.getStatus === 'function' &&
          e.getStatus() < 500
        )
          return this.terminal(q, r, 'consent_unavailable');
        throw e;
      }
      const choice = (
        await q.query(
          'SELECT id,action FROM identity_private.privacy_choices WHERE organization_id=$1 AND user_id=$2 ORDER BY sequence DESC LIMIT 1',
          [r.organization_id, r.owner_user_id],
        )
      ).rows[0];
      const pref = (
        await q.query(
          "SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel='in_app' AND purpose='transactional' FOR SHARE",
          [r.organization_id, r.project_id, r.owner_user_id],
        )
      ).rows[0];
      if (
        choice?.id !== r.choice_id ||
        choice?.action !== 'grant' ||
        pref?.enabled !== true ||
        Number(pref.version) !== Number(r.preference_version) ||
        pref.choice_id !== r.choice_id ||
        pref.notice_id !== r.notice_id ||
        pref.notice_hash !== r.notice_hash
      )
        return this.terminal(q, r, 'preference_unavailable');
      const existing = (
        await q.query(
          'SELECT id FROM identity_private.notification_messages WHERE organization_id=$1 AND idempotency_key=$2',
          [r.organization_id, r.id],
        )
      ).rows[0];
      if (existing) return this.terminal(q, r, 'idempotency_conflict');
      const source = record(
        JSON.parse(unseal(String(template.payload_cipher), 'notification-template:' + template.id)),
      );
      const vars: Record<string, string> = {
        projectName: String(p.name),
        applicationCode: String(r.application_code),
        reference: refs[String(r.event_type)]!,
      };
      const render = (value: unknown) =>
        String(value).replace(
          /\{(projectName|applicationCode|reference)\}/g,
          (_all, k: string) => vars[k]!,
        );
      const payload = {
        title: render(source.title),
        body: render(source.body),
        applicationCode: String(r.application_code),
        templateVersion: Number(template.version),
      };
      const id = String(r.id),
        hash = digest(
          'notification-automation-message',
          JSON.stringify([r.id, r.policy_id, r.application_version]),
        );
      await q.query(
        "INSERT INTO identity_private.notification_messages(id,organization_id,project_id,template_id,application_id,owner_user_id,channel,purpose,payload_cipher,notice_id,notice_hash,choice_id,preference_version,idempotency_key,request_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,'in_app','transactional',$7,$8,$9,$10,$11,$1,$12,'system:notification-automation')",
        [
          id,
          r.organization_id,
          r.project_id,
          r.template_id,
          r.application_id,
          r.owner_user_id,
          seal(JSON.stringify(payload), 'notification-message:' + r.organization_id + ':' + id),
          r.notice_id,
          r.notice_hash,
          r.choice_id,
          r.preference_version,
          hash,
        ],
      );
      const attempt = randomUUID();
      await q.query(
        "INSERT INTO identity_private.notification_attempts(id,organization_id,project_id,message_id,number,outcome,receipt_cipher) VALUES($1,$2,$3,$4,1,'delivered',$5)",
        [
          attempt,
          r.organization_id,
          r.project_id,
          id,
          seal('in-app:' + id, 'notification-attempt:' + attempt),
        ],
      );
      await q.query(
        "UPDATE identity_private.notification_messages SET status='delivered',attempt_count=1,version=version+1 WHERE id=$1",
        [id],
      );
      await q.query(
        "UPDATE identity_private.notification_automation_events SET status='delivered',message_id=$2,reason=NULL,lease_token=NULL,lease_until=NULL,processed_at=now(),version=version+1 WHERE id=$1",
        [id, id],
      );
      await event(
        q,
        this.actor(String(r.organization_id)),
        'notification.automation-delivered',
        id,
      );
      return 'delivered';
    });
  }
  private async failure(claim: NotificationAutomationClaim) {
    await this.db.tx(async (q) => {
      await this.context(q, claim.organizationId);
      await q.query("SET LOCAL lock_timeout='2s'");
      await q.query("SET LOCAL statement_timeout='5s'");
      const r = (
        await q.query(
          "SELECT attempt_count FROM identity_private.notification_automation_events WHERE organization_id=$1 AND id=$2 AND status='processing' AND lease_token=$3 FOR UPDATE",
          [claim.organizationId, claim.id, claim.leaseToken],
        )
      ).rows[0];
      if (!r) return;
      const failed = Number(r.attempt_count) >= 3;
      await q.query(
        "UPDATE identity_private.notification_automation_events SET status=$2,reason=$3,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '5 seconds'*attempt_count,processed_at=CASE WHEN $2='failed' THEN now() ELSE NULL END,version=version+1 WHERE id=$1",
        [
          claim.id,
          failed ? 'failed' : 'pending',
          failed ? 'attempts_exhausted' : 'processing_failed',
        ],
      );
      await event(
        q,
        this.actor(claim.organizationId),
        'notification.automation-processing-failed',
        claim.id,
      );
    });
  }
  configuredOrganization() {
    if (!notificationAutomationEnabled()) return null;
    const org = process.env.AUTH_ORGANIZATION_ID;
    if (!org || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(org))
      throw new ServiceUnavailableException(
        'Thông báo tự động cần tổ chức máy chủ được cấu hình rõ',
      );
    return uuid(org);
  }
  async runConfiguredBatch(
    shouldContinue: () => boolean = () => true,
  ): Promise<NotificationAutomationBatch> {
    const stats = { claimed: 0, delivered: 0, skipped: 0, failed: 0 };
    const org = this.configuredOrganization();
    if (!org) return stats;
    for (let i = 0; i < 10 && shouldContinue(); i++) {
      const claim = await this.claimNext(org);
      if (!claim) break;
      stats.claimed++;
      try {
        const result = await this.processClaim(claim);
        if (result === 'delivered') stats.delivered++;
        else if (result === 'skipped') stats.skipped++;
      } catch {
        stats.failed++;
        await this.failure(claim);
      }
    }
    return stats;
  }
}
