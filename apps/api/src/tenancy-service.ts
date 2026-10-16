import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  TenancyDraftSchema,
  TenancyPaymentSchema,
  TenancyReviewSchema,
  TenancyActionSchema,
  TenancyConfirmationSchema,
  type TenancyView,
  type TenancyDraft,
} from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { event, uuid, record } from './admin-service';
import { seal, unseal, sha, digest } from './identity-crypto';
import type { Staff } from './workforce';
import type { Citizen } from './phone-service';
import { PrivacyService } from './privacy-service';
const notice =
  'DIỄN TẬP: dự thảo, xác nhận và đối soát nội bộ; không phải hợp đồng đã ký, giao dịch ngân hàng hay kế toán pháp định.';
function parse<T>(
  schema: { safeParse: (b: unknown) => { success: boolean; data?: T } },
  b: unknown,
): T {
  const p = schema.safeParse(b);
  if (!p.success) throw new BadRequestException('Thiếu dữ liệu hoặc lịch thu không hợp lệ');
  return p.data!;
}
const str = (v: unknown) => String(v);
const day = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : str(v).slice(0, 10);
function current(r: Row, v: number) {
  if (Number(r.version) !== v)
    throw new ConflictException('Dữ liệu đã thay đổi. Tải lại trước khi thao tác');
}
@Injectable()
export class TenancyService {
  constructor(@Inject(Database) readonly db: Database) {}
  private context(r: Row) {
    return 'tenancy:' + r.organization_id + ':' + r.id;
  }
  private payload(r: Row) {
    return record(JSON.parse(unseal(str(r.payload_cipher), this.context(r))));
  }
  private async scope(q: Sql, s: Staff, project: string, permission: string, explicit = false) {
    project = uuid(project);
    if (s.role !== 'org_admin' && !s.projectIds?.includes(project))
      throw new ForbiddenException('Dự án ngoài phạm vi phiên');
    const p = (
      await q.query(
        'SELECT id,is_synthetic FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR SHARE',
        [project, s.organizationId],
      )
    ).rows[0];
    if (!p) throw new NotFoundException('Không có dự án trong phạm vi');
    if (p.is_synthetic !== true)
      throw new ForbiddenException('Hợp đồng hiện chỉ hỗ trợ dự án giả lập');
    if (s.role === 'org_admin' && !explicit) return;
    const employee = (
      await q.query(
        "SELECT e.permissions FROM identity_private.investor_employees e JOIN investor_employee_projects g ON g.organization_id=e.organization_id AND g.employee_id=e.id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND g.project_id=$3 FOR SHARE OF e,g",
        [s.organizationId, s.subject, project],
      )
    ).rows[0];
    const grants = employee?.permissions as string[] | undefined;
    if (
      !grants ||
      !(
        grants.includes(permission) ||
        (permission === 'records_read' && grants.includes('finance_read'))
      )
    )
      throw new ForbiddenException('Chưa được cấp quyền ' + permission + ' tại dự án');
  }
  private async row(q: Sql, org: string, project: string, id: string) {
    const r = (
      await q.query(
        'SELECT c.*,u.code AS unit_code,a.public_code FROM identity_private.tenancy_contracts c JOIN inventory_units u ON u.id=c.unit_id JOIN applications a ON a.id=c.application_id WHERE c.organization_id=$1 AND c.project_id=$2 AND c.id=$3 FOR UPDATE OF c',
        [org, uuid(project), uuid(id)],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có hợp đồng trong phạm vi');
    return r;
  }
  private async source(q: Sql, r: Row) {
    const a = (
      await q.query(
        "SELECT * FROM applications WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND owner_user_id=$4 AND status='approved' AND synthetic=true FOR SHARE",
        [r.application_id, r.organization_id, r.project_id, r.owner_user_id],
      )
    ).rows[0];
    if (!a) throw new ConflictException('Hồ sơ nguồn không còn được duyệt');
    const p = this.payload(r);
    if (Number(a.version) !== p.applicationVersion || a.snapshot_hash !== p.applicationHash)
      throw new ConflictException('Chứng cứ hồ sơ đã thay đổi');
  }
  private async bump(
    q: Sql,
    r: Row,
    changes: { status?: string; end?: string; total?: string } = {},
  ) {
    await q.query(
      'UPDATE identity_private.tenancy_contracts SET status=$2,ends_on=$3,total_vnd=$4,version=version+1 WHERE id=$1',
      [
        r.id,
        changes.status ?? r.status,
        changes.end ?? r.ends_on,
        changes.total ?? str(r.total_vnd),
      ],
    );
  }
  private async view(q: Sql, r: Row): Promise<TenancyView> {
    const p = this.payload(r);
    const payments = (
      await q.query(
        'SELECT * FROM identity_private.tenancy_payments WHERE contract_id=$1 AND organization_id=$2 ORDER BY created_at,id',
        [r.id, r.organization_id],
      )
    ).rows;
    const dues = (
      await q.query(
        'SELECT * FROM identity_private.tenancy_dues WHERE contract_id=$1 AND organization_id=$2 ORDER BY due_on,id',
        [r.id, r.organization_id],
      )
    ).rows.map((d) => ({
      id: str(d.id),
      dueOn: day(d.due_on),
      label: unseal(str(d.label_cipher), 'tenancy-due:' + d.id),
      amountVnd: str(d.amount_vnd),
      reconciledVnd: str(
        payments
          .filter((t) => t.due_id === d.id && t.status === 'reconciled_demo')
          .reduce((s, t) => s + BigInt(str(t.amount_vnd)), 0n),
      ),
      pendingVnd: str(
        payments
          .filter((t) => t.due_id === d.id && t.status === 'pending')
          .reduce((s, t) => s + BigInt(str(t.amount_vnd)), 0n),
      ),
    }));
    const actions = (
      await q.query(
        'SELECT * FROM identity_private.tenancy_actions WHERE contract_id=$1 AND organization_id=$2 ORDER BY created_at,id',
        [r.id, r.organization_id],
      )
    ).rows.map((a) => ({
      ...record(JSON.parse(unseal(str(a.payload_cipher), 'tenancy-action:' + a.id))),
      id: str(a.id),
      kind: str(a.kind),
      status: str(a.status),
      version: Number(a.version),
      createdBy: str(a.created_by),
      ownerConfirmed: a.owner_confirmed === true,
    }));
    return {
      id: str(r.id),
      projectId: str(r.project_id),
      applicationCode: str(r.public_code),
      unitCode: str(r.unit_code),
      mode: r.mode as TenancyView['mode'],
      title: str(p.title),
      startsOn: day(r.starts_on),
      endsOn: day(r.ends_on),
      terms: str(p.terms),
      basis: str(p.basis),
      evidenceHash: str(p.evidenceHash),
      snapshotHash: str(r.snapshot_hash),
      totalVnd: str(r.total_vnd),
      handoverRequiredVnd: str(r.handover_required_vnd),
      status: str(r.status),
      version: Number(r.version),
      createdBy: str(r.created_by),
      reviewedBy: r.reviewed_by ? str(r.reviewed_by) : null,
      synthetic: true,
      notice,
      dues,
      payments: payments.map((t) => ({
        id: str(t.id),
        dueId: str(t.due_id),
        amountVnd: str(t.amount_vnd),
        status: str(t.status),
        version: Number(t.version),
        createdBy: str(t.created_by),
        reference: unseal(str(t.reference_cipher), 'tenancy-payment:' + t.id),
        evidenceHash: str(t.evidence_hash),
      })),
      actions: actions as TenancyView['actions'],
    };
  }
  async list(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_read');
      const rows = (
        await q.query(
          'SELECT id FROM identity_private.tenancy_contracts WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [s.organizationId, project],
        )
      ).rows;
      return {
        items: await Promise.all(
          rows.map(async (r) =>
            this.view(q, await this.row(q, s.organizationId, project, str(r.id))),
          ),
        ),
        notice,
      };
    });
  }
  async detail(s: Staff, project: string, id: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_read');
      return this.view(q, await this.row(q, s.organizationId, project, id));
    });
  }
  async options(s: Staff, project: string) {
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_read');
      return {
        applications: (
          await q.query(
            "SELECT id,public_code FROM applications WHERE organization_id=$1 AND project_id=$2 AND status='approved' AND synthetic=true ORDER BY submitted_at DESC LIMIT 200",
            [s.organizationId, project],
          )
        ).rows,
        units: (
          await q.query(
            "SELECT u.id,u.code,EXISTS(SELECT 1 FROM identity_private.tenancy_contracts c WHERE c.unit_id=u.id AND c.status NOT IN('rejected','released_demo')) AS reserved FROM inventory_units u WHERE u.organization_id=$1 AND u.project_id=$2 ORDER BY u.code LIMIT 500",
            [s.organizationId, project],
          )
        ).rows,
      };
    });
  }
  async draft(s: Staff, project: string, body: unknown) {
    const b = parse<TenancyDraft>(TenancyDraftSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_write');
      const a = (
        await q.query(
          "SELECT * FROM applications WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='approved' AND synthetic=true",
          [b.applicationId, s.organizationId, project],
        )
      ).rows[0];
      if (!a) throw new ForbiddenException('Cần hồ sơ giả lập đã duyệt đúng dự án');
      await new PrivacyService(this.db).assertProcessing(
        { organizationId: s.organizationId, userId: str(a.owner_user_id) },
        q,
      );
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'tenancy-draft:' + s.organizationId + ':' + b.idempotencyKey,
      ]);
      const replay = (
          await q.query(
            'SELECT id,request_hash FROM identity_private.tenancy_contracts WHERE organization_id=$1 AND idempotency_key=$2',
            [s.organizationId, b.idempotencyKey],
          )
        ).rows[0],
        hash = sha(JSON.stringify({ ...b, project }));
      if (replay) {
        if (replay.request_hash !== hash)
          throw new ConflictException('Khóa gửi lặp có nội dung khác');
        return { id: str(replay.id), replayed: true };
      }
      await q.query('SELECT id FROM applications WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        a.id,
        s.organizationId,
      ]);
      const snapshot = record(
        JSON.parse(unseal(str(a.snapshot_cipher), 'application:' + s.organizationId + ':' + a.id)),
      );
      if (snapshot.mode !== b.mode)
        throw new BadRequestException('Hình thức phải khớp hồ sơ đã duyệt');
      const u = (
        await q.query(
          'SELECT id FROM inventory_units WHERE organization_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',
          [s.organizationId, project, b.unitId],
        )
      ).rows[0];
      if (!u) throw new NotFoundException('Không có căn thuộc dự án');
      if (
        (
          await q.query(
            "SELECT id FROM identity_private.tenancy_contracts WHERE unit_id=$1 AND status NOT IN('rejected','released_demo')",
            [b.unitId],
          )
        ).rows.length
      )
        throw new ConflictException('Căn đang thuộc dự thảo/hợp đồng khác');
      const allocations = (
        await q.query(
          'SELECT a.id,a.quote,q.application_id FROM inventory_allocations a JOIN identity_private.inventory_queue q ON q.id=a.queue_id WHERE a.unit_id=$1',
          [b.unitId],
        )
      ).rows;
      if (
        (b.mode === 'buy' &&
          (!allocations.length || allocations[0]!.application_id !== b.applicationId)) ||
        (b.mode !== 'buy' && allocations.length)
      )
        throw new ConflictException(
          'Căn mua cần allocation đúng hồ sơ; căn thuê không được có allocation mua',
        );
      if (
        (
          await q.query(
            "SELECT id FROM identity_private.tenancy_contracts WHERE organization_id=$1 AND application_id=$2 AND status NOT IN('rejected','released_demo')",
            [s.organizationId, b.applicationId],
          )
        ).rows.length
      )
        throw new ConflictException('Hồ sơ đang có hợp đồng chưa giải phóng');
      const total = b.schedule.reduce((v, i) => v + BigInt(i.amountVnd), 0n).toString();
      const allocationQuote = b.mode === 'buy' ? record(allocations[0]!.quote) : null;
      if (
        allocationQuote &&
        (typeof allocationQuote.totalVnd !== 'string' || allocationQuote.totalVnd !== total)
      )
        throw new ConflictException(
          'Tổng lịch thu mua phải khớp nguyên giá đã phân căn; điều chỉnh cần quy trình riêng',
        );
      const id = randomUUID();
      const payload = {
        ...b,
        applicationVersion: Number(a.version),
        applicationHash: a.snapshot_hash,
        allocationQuote,
      };
      await q.query(
        'INSERT INTO identity_private.tenancy_contracts(id,organization_id,project_id,application_id,dossier_id,owner_user_id,unit_id,mode,payload_cipher,snapshot_hash,starts_on,ends_on,total_vnd,handover_required_vnd,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
        [
          id,
          s.organizationId,
          project,
          b.applicationId,
          a.dossier_id,
          a.owner_user_id,
          b.unitId,
          b.mode,
          seal(JSON.stringify(payload), 'tenancy:' + s.organizationId + ':' + id),
          sha(JSON.stringify(payload)),
          b.startsOn,
          b.endsOn,
          total,
          b.handoverRequiredVnd,
          s.subject,
          b.idempotencyKey,
          hash,
        ],
      );
      await this.addDues(q, s.organizationId, project, id, b.schedule);
      await event(q, s, 'tenancy.draft', id);
      return { id, replayed: false };
    });
  }
  private async addDues(
    q: Sql,
    org: string,
    project: string,
    id: string,
    dues: TenancyDraft['schedule'],
    action: string | null = null,
  ) {
    for (const d of dues) {
      const did = randomUUID();
      await q.query(
        'INSERT INTO identity_private.tenancy_dues(id,organization_id,project_id,contract_id,due_on,amount_vnd,label_cipher,action_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [did, org, project, id, d.dueOn, d.amountVnd, seal(d.label, 'tenancy-due:' + did), action],
      );
    }
  }
  async review(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = parse(TenancyReviewSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_review');
      if (!s.permissions?.includes('form_legal_approver'))
        throw new ForbiddenException('Cần người rà soát pháp lý độc lập');
      const r = await this.row(q, s.organizationId, project, id);
      current(r, expected);
      if (r.status !== 'draft' || r.created_by === s.subject)
        throw new ConflictException('Chỉ người khác tác giả được duyệt bản nháp');
      await this.scope(q, s, project, 'form_legal_approver', true);
      await this.source(q, r);
      await q.query(
        'UPDATE identity_private.tenancy_contracts SET status=$2,reviewed_by=$3,review_cipher=$4,version=version+1 WHERE id=$1',
        [
          r.id,
          b.decision === 'approve' ? 'approved' : 'rejected',
          s.subject,
          seal(b.note, this.context(r) + ':review'),
        ],
      );
      await event(q, s, 'tenancy.' + b.decision, id);
      return { version: expected + 1 };
    });
  }
  async citizenList(c: Citizen) {
    return this.db.tx(async (q) => {
      const rows = (
        await q.query(
          'SELECT id,project_id FROM identity_private.tenancy_contracts WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC,id LIMIT 100',
          [c.organizationId, c.userId],
        )
      ).rows;
      return {
        items: await Promise.all(
          rows.map(async (r) =>
            this.view(q, await this.row(q, c.organizationId, str(r.project_id), str(r.id))),
          ),
        ),
        notice,
      };
    });
  }
  private async owned(q: Sql, c: Citizen, id: string) {
    const r = (
      await q.query(
        'SELECT project_id FROM identity_private.tenancy_contracts WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',
        [uuid(id), c.organizationId, c.userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có hợp đồng của bạn');
    return this.row(q, c.organizationId, str(r.project_id), id);
  }
  async citizenDetail(c: Citizen, id: string) {
    return this.db.tx(async (q) => this.view(q, await this.owned(q, c, id)));
  }
  async confirm(c: Citizen, id: string, body: unknown, expected: number) {
    parse(TenancyConfirmationSchema, body);
    return this.db.tx(async (q) => {
      await new PrivacyService(this.db).assertProcessing(c, q);
      const r = await this.owned(q, c, id);
      current(r, expected);
      if (r.status !== 'approved')
        throw new ConflictException('Chỉ xác nhận dự thảo đã được duyệt');
      await this.source(q, r);
      await this.bump(q, r, { status: 'acknowledged_demo' });
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'tenancy.customer-acknowledged',
        id,
      );
      return { version: expected + 1, notice };
    });
  }
  async payment(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = parse(TenancyPaymentSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'finance_write');
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'tenancy-payment:' + s.organizationId + ':' + b.idempotencyKey,
      ]);
      const r = await this.row(q, s.organizationId, project, id);
      const hash = sha(JSON.stringify({ ...b, contractId: id }));
      const replay = (
        await q.query(
          'SELECT id,request_hash FROM identity_private.tenancy_payments WHERE organization_id=$1 AND idempotency_key=$2',
          [s.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash)
          throw new ConflictException('Khóa thanh toán bị dùng với nội dung khác');
        return { id: str(replay.id), replayed: true };
      }
      current(r, expected);
      if (!['acknowledged_demo', 'handed_over_demo'].includes(str(r.status)))
        throw new ConflictException('Cần khách xác nhận dự thảo trước khi đối soát diễn tập');
      const due = (
        await q.query(
          'SELECT amount_vnd FROM identity_private.tenancy_dues WHERE id=$1 AND contract_id=$2',
          [b.dueId, r.id],
        )
      ).rows[0];
      if (!due) throw new NotFoundException('Kỳ thu không thuộc hợp đồng');
      const paid = (
        await q.query(
          "SELECT COALESCE(sum(amount_vnd),0)::text AS n FROM identity_private.tenancy_payments WHERE due_id=$1 AND status<>'rejected'",
          [b.dueId],
        )
      ).rows[0]!;
      if (BigInt(str(paid.n)) + BigInt(b.amountVnd) > BigInt(str(due.amount_vnd)))
        throw new ConflictException('Khoản ghi nhận vượt số còn lại của kỳ');
      const referenceHash = digest('tenancy-reference', b.reference);
      if (
        (
          await q.query(
            'SELECT id FROM identity_private.tenancy_payments WHERE organization_id=$1 AND reference_hash=$2',
            [s.organizationId, referenceHash],
          )
        ).rows.length
      )
        throw new ConflictException('Tham chiếu đã được ghi nhận');
      const pid = randomUUID();
      await q.query(
        'INSERT INTO identity_private.tenancy_payments(id,organization_id,project_id,contract_id,due_id,amount_vnd,reference_hash,reference_cipher,evidence_hash,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          pid,
          s.organizationId,
          project,
          id,
          b.dueId,
          b.amountVnd,
          referenceHash,
          seal(b.reference, 'tenancy-payment:' + pid),
          b.evidenceHash,
          s.subject,
          b.idempotencyKey,
          hash,
        ],
      );
      await this.bump(q, r);
      await event(q, s, 'tenancy.payment-pending', pid);
      return { id: pid, replayed: false };
    });
  }
  async reviewPayment(s: Staff, project: string, payment: string, body: unknown, expected: number) {
    const b = parse(TenancyReviewSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'finance_post', true);
      const p = (
        await q.query(
          'SELECT contract_id FROM identity_private.tenancy_payments WHERE id=$1 AND organization_id=$2 AND project_id=$3',
          [uuid(payment), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!p) throw new NotFoundException('Không có khoản ghi nhận');
      const r = await this.row(q, s.organizationId, project, str(p.contract_id));
      const t = (
        await q.query('SELECT * FROM identity_private.tenancy_payments WHERE id=$1 FOR UPDATE', [
          payment,
        ])
      ).rows[0]!;
      current(t, expected);
      if (t.status !== 'pending' || t.created_by === s.subject)
        throw new ConflictException('Người lập không được tự đối soát');
      if (!['acknowledged_demo', 'handed_over_demo'].includes(str(r.status)))
        throw new ConflictException('Hợp đồng đã đóng');
      await q.query(
        'UPDATE identity_private.tenancy_payments SET status=$2,reviewed_by=$3,review_cipher=$4,version=version+1 WHERE id=$1',
        [
          payment,
          b.decision === 'approve' ? 'reconciled_demo' : 'rejected',
          s.subject,
          seal(b.note, 'tenancy-payment:' + payment + ':review'),
        ],
      );
      await this.bump(q, r);
      await event(q, s, 'tenancy.payment-' + b.decision, payment);
      return { version: expected + 1 };
    });
  }
  async propose(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = parse(TenancyActionSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_write');
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'tenancy-action:' + s.organizationId + ':' + b.idempotencyKey,
      ]);
      const r = await this.row(q, s.organizationId, project, id),
        hash = sha(JSON.stringify({ ...b, contractId: id }));
      const replay = (
        await q.query(
          'SELECT id,request_hash FROM identity_private.tenancy_actions WHERE organization_id=$1 AND idempotency_key=$2',
          [s.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== hash)
          throw new ConflictException('Khóa sự kiện có nội dung khác');
        return { id: str(replay.id), replayed: true };
      }
      current(r, expected);
      if (!['acknowledged_demo', 'handed_over_demo', 'terminated_demo'].includes(str(r.status)))
        throw new ConflictException('Chưa đủ trạng thái tạo đề nghị');
      if (
        (
          await q.query(
            "SELECT id FROM identity_private.tenancy_actions WHERE contract_id=$1 AND status='pending'",
            [id],
          )
        ).rows.length
      )
        throw new ConflictException('Đang có đề nghị cần xử lý');
      this.validateAction(r, b);
      const aid = randomUUID();
      await q.query(
        'INSERT INTO identity_private.tenancy_actions(id,organization_id,project_id,contract_id,kind,payload_cipher,created_by,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          aid,
          s.organizationId,
          project,
          id,
          b.kind,
          seal(JSON.stringify({ ...b, baseVersion: expected + 1 }), 'tenancy-action:' + aid),
          s.subject,
          b.idempotencyKey,
          hash,
        ],
      );
      await this.bump(q, r);
      await event(q, s, 'tenancy.action-proposed', aid);
      return { id: aid, replayed: false };
    });
  }
  private validateAction(r: Row, b: Record<string, unknown>) {
    if (b.kind === 'handover' && r.status !== 'acknowledged_demo')
      throw new ConflictException('Chỉ bàn giao sau xác nhận dự thảo');
    if (b.kind === 'return' && (r.status !== 'terminated_demo' || r.mode === 'buy'))
      throw new ConflictException('Chỉ trả căn thuê/thuê mua đã chấm dứt; allocation mua bất biến');
    if (
      b.kind === 'terminate' &&
      !['acknowledged_demo', 'handed_over_demo'].includes(str(r.status))
    )
      throw new ConflictException('Hợp đồng chưa ở giai đoạn chấm dứt');
    if (b.kind === 'extend') {
      const end = str(b.newEndsOn),
        old = day(r.ends_on),
        schedule = b.schedule as TenancyDraft['schedule'];
      if (
        r.mode === 'buy' ||
        !['acknowledged_demo', 'handed_over_demo'].includes(str(r.status)) ||
        end <= old ||
        schedule.some((d) => d.dueOn <= old || d.dueOn > end)
      )
        throw new BadRequestException(
          'Gia hạn chỉ cho thuê/thuê mua, ngày và kỳ thu phải sau thời hạn cũ',
        );
    }
  }
  async confirmAction(c: Citizen, id: string, body: unknown, expected: number) {
    parse(TenancyConfirmationSchema, body);
    return this.db.tx(async (q) => {
      await new PrivacyService(this.db).assertProcessing(c, q);
      const a = (
        await q.query(
          'SELECT contract_id FROM identity_private.tenancy_actions WHERE id=$1 AND organization_id=$2',
          [uuid(id), c.organizationId],
        )
      ).rows[0];
      if (!a) throw new NotFoundException('Không có đề nghị');
      await this.owned(q, c, str(a.contract_id));
      const r = (
        await q.query('SELECT * FROM identity_private.tenancy_actions WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]!;
      current(r, expected);
      if (r.status !== 'pending' || r.owner_confirmed === true)
        throw new ConflictException('Đề nghị đã xử lý');
      await q.query(
        'UPDATE identity_private.tenancy_actions SET owner_confirmed=true,version=version+1 WHERE id=$1',
        [id],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'tenancy.action-customer-confirmed',
        id,
      );
      return { version: expected + 1 };
    });
  }
  async reviewAction(s: Staff, project: string, id: string, body: unknown, expected: number) {
    const b = parse(TenancyReviewSchema, body);
    return this.db.tx(async (q) => {
      await this.scope(q, s, project, 'records_review');
      const a = (
        await q.query(
          'SELECT contract_id FROM identity_private.tenancy_actions WHERE id=$1 AND organization_id=$2 AND project_id=$3',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!a) throw new NotFoundException('Không có đề nghị');
      const r = await this.row(q, s.organizationId, project, str(a.contract_id));
      const t = (
        await q.query('SELECT * FROM identity_private.tenancy_actions WHERE id=$1 FOR UPDATE', [id])
      ).rows[0]!;
      current(t, expected);
      if (t.status !== 'pending' || t.created_by === s.subject)
        throw new ConflictException('Cần người duyệt khác người đề nghị');
      const p = record(JSON.parse(unseal(str(t.payload_cipher), 'tenancy-action:' + id)));
      if (b.decision === 'approve') {
        if (Number(r.version) !== p.baseVersion)
          throw new ConflictException('Hợp đồng thay đổi sau đề nghị, cần từ chối và lập lại');
        if (!t.owner_confirmed) throw new ConflictException('Cần khách xác nhận đề nghị diễn tập');
        this.validateAction(r, p);
        const paid = BigInt(
          str(
            (
              await q.query(
                "SELECT COALESCE(sum(amount_vnd),0)::text AS n FROM identity_private.tenancy_payments WHERE contract_id=$1 AND status='reconciled_demo'",
                [r.id],
              )
            ).rows[0]!.n,
          ),
        );
        if (
          (t.kind === 'handover' && paid < BigInt(str(r.handover_required_vnd))) ||
          (['terminate', 'return'].includes(str(t.kind)) && paid !== BigInt(str(r.total_vnd)))
        )
          throw new ConflictException(
            'Chưa đối soát đủ nghĩa vụ; cần xử lý quyết toán trước bước này',
          );
        if (t.kind === 'extend') {
          await this.addDues(
            q,
            s.organizationId,
            project,
            str(r.id),
            p.schedule as TenancyDraft['schedule'],
            id,
          );
          const extra = (p.schedule as TenancyDraft['schedule']).reduce(
            (sum, d) => sum + BigInt(d.amountVnd),
            0n,
          );
          await this.bump(q, r, {
            end: str(p.newEndsOn),
            total: (BigInt(str(r.total_vnd)) + extra).toString(),
          });
        } else
          await this.bump(q, r, {
            status: (
              {
                handover: 'handed_over_demo',
                terminate: 'terminated_demo',
                return: 'released_demo',
              } as Record<string, string>
            )[str(t.kind)],
          });
      } else await this.bump(q, r);
      await q.query(
        'UPDATE identity_private.tenancy_actions SET status=$2,reviewed_by=$3,review_cipher=$4,version=version+1 WHERE id=$1',
        [
          id,
          b.decision === 'approve' ? 'approved' : 'rejected',
          s.subject,
          seal(b.note, 'tenancy-action:' + id + ':review'),
        ],
      );
      await event(q, s, 'tenancy.action-' + b.decision, id);
      return { version: expected + 1 };
    });
  }
}
