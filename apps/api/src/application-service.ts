import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ApplicationSubmissionSchema,
  SupplementSchema,
  RecommendationSchema,
  ApplicationDecisionSchema,
} from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { DossierService } from './dossier-service';
import { PrivacyService } from './privacy-service';
import { event, record, text, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const scope = (org: string, id: string) => 'application:' + uuid(org) + ':' + uuid(id);
const read = (r: Row, key: string) =>
  r[key]
    ? JSON.parse(unseal(String(r[key]), scope(String(r.organization_id), String(r.id))))
    : null;
@Injectable()
export class ApplicationService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(DossierService) readonly dossiers: DossierService,
    @Inject(PrivacyService) readonly privacy: PrivacyService,
  ) {}
  private permission(s: Staff, roles: string[]) {
    if (!roles.some((r) => s.permissions?.includes(r)))
      throw new ForbiddenException(
        'Cần quyền tiếp nhận, thẩm định, phê duyệt hoặc kiểm tra tương ứng được cấp riêng.',
      );
  }
  private project(s: Staff, id: string) {
    if (s.role !== 'org_admin' && !s.projectIds?.includes(id))
      throw new NotFoundException('Không có hồ sơ trong dự án được giao');
  }
  private view(r: Row, staff = false) {
    return {
      id: r.id,
      project_id: r.project_id,
      round_id: r.round_id,
      dossier_id: r.dossier_id,
      receipt_code: r.receipt_code,
      public_code: r.public_code,
      status: r.status,
      version: r.version,
      synthetic: r.synthetic,
      submitted_at: r.submitted_at,
      project_name: r.project_name,
      round_name: r.round_name,
      assigned_reviewer: staff ? r.assigned_reviewer : null,
      recommendation_id: staff ? r.recommendation_id : null,
      decision_reason: read(r, 'decision_reason_cipher'),
      snapshot_hash: r.snapshot_hash,
    };
  }
  private async row(q: Sql, org: string, id: string, owner?: string, lock = false) {
    const r = (
      await q.query(
        `SELECT a.*,p.name AS project_name,r.name AS round_name FROM applications a JOIN projects p ON p.id=a.project_id AND p.organization_id=a.organization_id JOIN intake_rounds r ON r.id=a.round_id AND r.organization_id=a.organization_id WHERE a.id=$1 AND a.organization_id=$2 ${owner ? 'AND a.owner_user_id=$3' : ''} ${lock ? 'FOR UPDATE OF a' : ''}`,
        [uuid(id), org, ...(owner ? [owner] : [])],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có hồ sơ đã nộp trong phạm vi tài khoản');
    return r;
  }
  private async evidence(
    q: Sql,
    c: Citizen,
    dossier: string,
    docIds: string[],
    formIds: string[],
    mode: string,
    subjectGroup: number,
  ) {
    const docs: Row[] = [],
      forms: Row[] = [];
    const current = (
      await q.query(
        'SELECT version,project_id FROM prep_dossiers WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 FOR UPDATE',
        [dossier, c.organizationId, c.userId],
      )
    ).rows[0];
    if (!current) throw new NotFoundException('Không có hồ sơ chuẩn bị');
    for (const id of [...docIds].map(uuid).sort()) {
      const r = (
        await q.query(
          "SELECT id,sha256,type FROM documents WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND scan_status='clean' AND deleted_at IS NULL FOR UPDATE",
          [id, c.organizationId, dossier, c.userId],
        )
      ).rows[0];
      if (!r)
        throw new BadRequestException(
          'Giấy tờ chưa quét an toàn, đã thu hồi hoặc không thuộc hồ sơ',
        );
      docs.push(r);
    }
    for (const id of [...formIds].map(uuid).sort()) {
      const r = (
        await q.query(
          "SELECT f.id,f.sha256,f.mapping_id FROM generated_forms f JOIN form_field_mappings m ON m.id=f.mapping_id AND m.organization_id=f.organization_id JOIN project_form_releases rel ON rel.id=m.release_id AND rel.organization_id=m.organization_id WHERE f.id=$1 AND f.organization_id=$2 AND f.dossier_id=$3 AND f.owner_user_id=$4 AND f.status='confirmed' AND f.input_version=$5 AND rel.mode=$6 AND rel.subject_group=$7 AND rel.project_id=$8 AND m.status='approved' AND m.effective_from<=CURRENT_DATE AND(m.effective_to IS NULL OR m.effective_to>=CURRENT_DATE) AND rel.status='approved' AND rel.effective_from<=CURRENT_DATE AND(rel.effective_to IS NULL OR rel.effective_to>=CURRENT_DATE) AND NOT EXISTS(SELECT 1 FROM form_field_mappings newer WHERE newer.organization_id=m.organization_id AND newer.release_id=m.release_id AND newer.version>m.version AND newer.status IN('approved','revoked') AND newer.effective_from<=CURRENT_DATE) AND NOT EXISTS(SELECT 1 FROM project_form_releases newer WHERE newer.organization_id=rel.organization_id AND newer.project_id=rel.project_id AND newer.form_id=rel.form_id AND newer.mode=rel.mode AND newer.subject_group=rel.subject_group AND newer.version>rel.version AND newer.status IN('approved','revoked') AND newer.effective_from<=CURRENT_DATE) FOR SHARE OF f,m,rel",
          [
            id,
            c.organizationId,
            dossier,
            c.userId,
            current.version,
            mode,
            subjectGroup,
            current.project_id,
          ],
        )
      ).rows[0];
      if (!r)
        throw new BadRequestException(
          'Mẫu chưa xác nhận, đã thay đổi bản khai, hết hiệu lực hoặc bị thay thế/thu hồi',
        );
      forms.push(r);
    }
    return {
      documents: docs.map((r) => ({ id: r.id, sha256: r.sha256, type: r.type })),
      forms: forms.map((r) => ({ id: r.id, sha256: r.sha256, mappingId: r.mapping_id })),
    };
  }
  private async bind(q: Sql, c: Citizen, r: Row, proof: { documents: Row[]; forms: Row[] }) {
    for (const doc of proof.documents) {
      await q.query(
        'INSERT INTO application_documents(application_id,document_id,organization_id,project_id,dossier_id,sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(application_id,document_id) DO NOTHING',
        [r.id, doc.id, c.organizationId, r.project_id, r.dossier_id, doc.sha256],
      );
      await q.query('UPDATE documents SET retained=true WHERE id=$1 AND organization_id=$2', [
        doc.id,
        c.organizationId,
      ]);
    }
    for (const form of proof.forms)
      await q.query(
        'INSERT INTO application_generated_forms(application_id,form_id,sha256) VALUES($1,$2,$3) ON CONFLICT(application_id,form_id) DO NOTHING',
        [r.id, form.id, form.sha256],
      );
  }
  async submit(c: Citizen, dossierId: string, body: unknown, key: unknown) {
    const p = ApplicationSubmissionSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Cần xác nhận bản khai, giấy tờ, hình thức, nhóm đối tượng và cam kết không đăng ký đồng thời',
      );
    const b = p.data;
    dossierId = uuid(dossierId);
    const idempotency = uuid(key),
      requestHash = sha({
        ...b,
        roundId: uuid(b.roundId),
        noticeId: uuid(b.noticeId),
        documentIds: b.documentIds.map(uuid).sort(),
        generatedFormIds: b.generatedFormIds.map(uuid).sort(),
        dossierId,
      });
    if (b.subjectGroup === 11 && b.mode !== 'rent')
      throw new BadRequestException(
        'Đối tượng học sinh, sinh viên thuộc hình thức thuê; không dùng luồng mua hoặc thuê mua.',
      );
    if (b.subjectGroup === 12)
      throw new BadRequestException(
        'Đối tượng doanh nghiệp/hợp tác xã trong khu công nghiệp cần luồng nhà lưu trú công nhân và tư cách tổ chức riêng; không dùng đăng ký cá nhân mua NOXH.',
      );
    await this.privacy.assertProcessing(c);
    const w = await this.privacy.workspace(c);
    if (w.notice?.id !== uuid(b.noticeId))
      throw new ConflictException('Cần đọc đúng thông báo bảo vệ dữ liệu hiện hành');
    const d = await this.dossiers.detail(c, dossierId);
    return this.db.tx(async (q) => {
      const consent = await this.privacy.assertProcessing(c, q);
      if (consent.noticeId !== uuid(b.noticeId))
        throw new ConflictException('Thông báo dữ liệu đã thay đổi; cần xác nhận lại');
      await q.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        c.userId,
        c.organizationId,
      ]);
      const previous = (
        await q.query(
          'SELECT id,request_hash FROM applications WHERE organization_id=$1 AND owner_user_id=$2 AND idempotency_key=$3',
          [c.organizationId, c.userId, idempotency],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new ConflictException('Khóa gửi lại đã dùng cho nội dung khác');
        return this.view(await this.row(q, c.organizationId, String(previous.id), c.userId));
      }
      const current = (
        await q.query(
          'SELECT version FROM prep_dossiers WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 FOR UPDATE',
          [dossierId, c.organizationId, c.userId],
        )
      ).rows[0];
      if (
        !current ||
        Number(current.version) !== b.inputVersion ||
        Number(d.version) !== b.inputVersion
      )
        throw new ConflictException('Bản khai đã thay đổi, xem và xác nhận lại trước khi nộp');
      if (
        !d.declaration.confirmed ||
        !d.declaration.fullName ||
        !d.declaration.dateOfBirth ||
        !d.declaration.address
      )
        throw new BadRequestException(
          'Cần khai và xác nhận thông tin cơ bản; điểm AI không quyết định việc nộp',
        );
      const round = (
        await q.query(
          'SELECT r.*,p.is_synthetic,p.publication_status,p.archived_at FROM intake_rounds r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.id=$1 AND r.organization_id=$2 AND r.project_id=$3 FOR SHARE OF r,p',
          [uuid(b.roundId), c.organizationId, d.project_id],
        )
      ).rows[0];
      if (
        !round ||
        round.status !== 'open' ||
        round.publication_status !== 'published' ||
        round.archived_at ||
        new Date(String(round.opens_at)).getTime() > Date.now() ||
        new Date(String(round.closes_at)).getTime() <= Date.now()
      )
        throw new ConflictException('Đợt tiếp nhận chưa mở, đã đóng hoặc không thuộc dự án');
      if (!round.is_synthetic && process.env.OFFICIAL_SUBMISSION_ENABLED !== 'true')
        throw new ServiceUnavailableException(
          'Tiếp nhận hồ sơ thật chưa được quản trị triển khai mở sau rà soát pháp lý',
        );
      if (
        (
          await q.query(
            "SELECT id FROM applications WHERE organization_id=$1 AND owner_user_id=$2 AND status IN('submitted','under_review','supplement','recommended','approved')",
            [c.organizationId, c.userId],
          )
        ).rows.length
      )
        throw new ConflictException(
          'Tài khoản đang có hồ sơ trong quy trình. Không gửi đăng ký đồng thời; xem hồ sơ đã nộp.',
        );
      const proof = await this.evidence(
          q,
          c,
          dossierId,
          b.documentIds,
          b.generatedFormIds,
          b.mode,
          b.subjectGroup,
        ),
        id = randomUUID(),
        snapshot = {
          declaration: d.declaration,
          mode: b.mode,
          subjectGroup: b.subjectGroup,
          inputVersion: b.inputVersion,
          documents: proof.documents,
          forms: proof.forms,
          noConcurrentHouseholdApplication: true,
          privacyNoticeId: uuid(b.noticeId),
        },
        hash = sha(snapshot),
        receipt =
          (round.is_synthetic ? 'NOXH-DEMO-' : 'NOXH-') +
          new Date().toISOString().slice(0, 10).replace(/-/g, '') +
          '-' +
          id.replace(/-/g, '').slice(0, 12).toUpperCase();
      await q.query(
        'INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash,public_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          id,
          c.organizationId,
          d.project_id,
          uuid(b.roundId),
          dossierId,
          c.userId,
          receipt,
          seal(JSON.stringify(snapshot), scope(c.organizationId, id)),
          hash,
          b.inputVersion,
          uuid(b.noticeId),
          Boolean(round.is_synthetic),
          idempotency,
          requestHash,
          (round.is_synthetic ? 'DEMO-' : 'HS-') +
            createHash('sha256').update(id).digest('hex').slice(0, 24).toUpperCase(),
        ],
      );
      const row = await this.row(q, c.organizationId, id, c.userId);
      await this.bind(q, c, row, proof);
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'application.submitted',
        id,
      );
      return this.view(row);
    });
  }
  async mine(c: Citizen) {
    return {
      items: (
        await this.db.query(
          'SELECT a.*,p.name AS project_name,r.name AS round_name FROM applications a JOIN projects p ON p.id=a.project_id AND p.organization_id=a.organization_id JOIN intake_rounds r ON r.id=a.round_id AND r.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.owner_user_id=$2 ORDER BY a.submitted_at DESC LIMIT 100',
          [c.organizationId, c.userId],
        )
      ).map((r) => this.view(r)),
    };
  }
  async submissionWorkspace(c: Citizen, id: string) {
    const d = await this.dossiers.detail(c, id),
      w = await this.privacy.workspace(c);
    return {
      inputVersion: d.version,
      confirmed: d.declaration.confirmed,
      noticeId: w.notice?.id ?? null,
      privacyAccepted: w.accepted && !w.restricted,
      rounds: await this.db.query(
        "SELECT id,name,status,opens_at,closes_at FROM intake_rounds WHERE organization_id=$1 AND project_id=$2 AND status='open' AND opens_at<=now() AND closes_at>now() ORDER BY opens_at DESC",
        [c.organizationId, d.project_id],
      ),
      documents: await this.db.query(
        "SELECT id,type,sha256,mime,created_at FROM documents WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 AND scan_status='clean' AND deleted_at IS NULL ORDER BY created_at DESC",
        [c.organizationId, uuid(id), c.userId],
      ),
      forms: await this.db.query(
        "SELECT id,mapping_id,input_version,sha256,created_at FROM generated_forms WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 AND status='confirmed' ORDER BY created_at DESC",
        [c.organizationId, uuid(id), c.userId],
      ),
    };
  }
  async list(s: Staff) {
    this.permission(s, ['intake_officer', 'reviewer', 'approver', 'auditor']);
    const values: unknown[] = [s.organizationId];
    let extra = '';
    if (s.role !== 'org_admin') {
      values.push(s.projectIds ?? []);
      extra += ' AND a.project_id=ANY($2::uuid[])';
    }
    if (!s.permissions?.some((p) => ['intake_officer', 'approver', 'auditor'].includes(p))) {
      values.push(s.subject);
      extra += ' AND a.assigned_reviewer=$' + values.length;
    }
    return {
      items: (
        await this.db.query(
          'SELECT a.*,p.name AS project_name,r.name AS round_name FROM applications a JOIN projects p ON p.id=a.project_id AND p.organization_id=a.organization_id JOIN intake_rounds r ON r.id=a.round_id AND r.organization_id=a.organization_id WHERE a.organization_id=$1' +
            extra +
            ' ORDER BY a.submitted_at DESC LIMIT 200',
          values,
        )
      ).map((r) => this.view(r, true)),
    };
  }
  private access(s: Staff, r: Row) {
    this.permission(s, ['intake_officer', 'reviewer', 'approver', 'auditor']);
    this.project(s, String(r.project_id));
    if (
      !s.permissions?.some((p) => ['intake_officer', 'approver', 'auditor'].includes(p)) &&
      r.assigned_reviewer !== s.subject
    )
      throw new NotFoundException('Hồ sơ chưa được giao cho bạn');
  }
  private async details(q: Sql, r: Row, staff: boolean) {
    const supplements = (
      await q.query(
        'SELECT * FROM application_supplements WHERE application_id=$1 AND organization_id=$2 ORDER BY created_at,id',
        [r.id, r.organization_id],
      )
    ).rows.map((x) => ({
      id: x.id,
      created_at: x.created_at,
      ...JSON.parse(
        unseal(String(x.payload_cipher), scope(String(r.organization_id), String(r.id))),
      ),
    }));
    const reviews = staff
      ? (
          await q.query(
            'SELECT * FROM application_reviews WHERE application_id=$1 AND organization_id=$2 ORDER BY created_at,id',
            [r.id, r.organization_id],
          )
        ).rows.map((x) => ({
          id: x.id,
          reviewer: x.reviewer,
          created_at: x.created_at,
          eligible: x.eligible,
          ...JSON.parse(
            unseal(String(x.payload_cipher), scope(String(r.organization_id), String(r.id))),
          ),
        }))
      : [];
    const appeals = (
      await q.query(
        'SELECT * FROM application_appeals WHERE application_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 50',
        [r.id, r.organization_id],
      )
    ).rows.map((x) => ({
      id: x.id,
      created_at: x.created_at,
      status: x.status,
      version: x.version,
      message: unseal(String(x.message_cipher), scope(String(r.organization_id), String(r.id))),
      reply: x.reply_cipher
        ? unseal(String(x.reply_cipher), scope(String(r.organization_id), String(r.id)))
        : null,
    }));
    return {
      ...this.view(r, staff),
      snapshot: read(r, 'snapshot_cipher'),
      supplements,
      reviews,
      appeals,
    };
  }
  async detail(c: Citizen, id: string) {
    return this.db.tx(async (q) =>
      this.details(q, await this.row(q, c.organizationId, id, c.userId), false),
    );
  }
  async staffDetail(s: Staff, id: string) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id);
      this.access(s, r);
      await event(q, s, 'application.staff-read', uuid(id));
      return this.details(q, r, true);
    });
  }
  async supplement(c: Citizen, id: string, body: unknown, expected: number) {
    const p = SupplementSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần tài liệu bổ sung, nội dung và xác nhận');
    await this.privacy.assertProcessing(c);
    return this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      const r = await this.row(q, c.organizationId, id, c.userId, true);
      if (Number(r.version) !== expected || r.status !== 'supplement')
        throw new ConflictException('Hồ sơ không còn ở bước bổ sung hoặc đã thay đổi');
      const original = read(r, 'snapshot_cipher');
      const proof = await this.evidence(
          q,
          c,
          String(r.dossier_id),
          p.data.documentIds,
          p.data.generatedFormIds,
          original.mode,
          original.subjectGroup,
        ),
        payload = {
          message: p.data.message,
          documentIds: proof.documents.map((d) => d.id),
          formIds: proof.forms.map((f) => f.id),
          documents: proof.documents,
          forms: proof.forms,
        },
        ref = randomUUID();
      await q.query(
        'INSERT INTO application_supplements(id,application_id,organization_id,payload_cipher,payload_hash,input_version) VALUES($1,$2,$3,$4,$5,$6)',
        [
          ref,
          r.id,
          c.organizationId,
          seal(JSON.stringify(payload), scope(c.organizationId, String(r.id))),
          sha(payload),
          r.version,
        ],
      );
      await this.bind(q, c, r, proof);
      await q.query(
        "UPDATE applications SET status='submitted',recommendation_id=NULL,version=version+1,updated_at=now() WHERE id=$1",
        [r.id],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'application.supplemented',
        String(r.id),
      );
      return { saved: true, version: expected + 1 };
    });
  }
  async withdraw(c: Citizen, id: string, expected: number) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, c.organizationId, id, c.userId, true);
      if (
        Number(r.version) !== expected ||
        !['submitted', 'under_review', 'supplement', 'recommended'].includes(String(r.status))
      )
        throw new ConflictException(
          'Không thể tự rút hồ sơ tại trạng thái này; hãy gửi yêu cầu chủ đầu tư giải quyết',
        );
      await q.query(
        "UPDATE applications SET status='withdrawn',version=version+1,updated_at=now() WHERE id=$1",
        [r.id],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'application.withdrawn',
        String(r.id),
      );
      return { withdrawn: true };
    });
  }
  async assign(s: Staff, id: string, body: unknown, expected: number) {
    this.permission(s, ['intake_officer']);
    const b = record(body),
      subject = text(b.reviewerSubject, 200);
    if (Object.keys(b).some((k) => k !== 'reviewerSubject'))
      throw new BadRequestException('Chỉ chọn người thẩm định');
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (
        Number(r.version) !== expected ||
        !['submitted', 'under_review', 'recommended'].includes(String(r.status))
      )
        throw new ConflictException('Không thể phân công ở phiên bản hoặc giai đoạn này');
      if (
        !(
          await q.query(
            "SELECT e.id FROM identity_private.investor_employees e JOIN investor_employee_projects ep ON ep.employee_id=e.id AND ep.organization_id=e.organization_id WHERE e.organization_id=$1 AND e.subject=$2 AND e.status='active' AND ep.project_id=$3",
            [s.organizationId, subject, r.project_id],
          )
        ).rows.length
      )
        throw new BadRequestException(
          'Chọn nhân viên đang hoạt động và được giao dự án; quyền thẩm định phải được cấp riêng trong Keycloak',
        );
      await q.query(
        "UPDATE applications SET assigned_reviewer=$2,status='under_review',recommendation_id=NULL,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, subject],
      );
      await event(q, s, 'application.assigned', String(r.id));
      return { saved: true };
    });
  }
  async requestSupplement(s: Staff, id: string, body: unknown, expected: number) {
    this.permission(s, ['reviewer']);
    const b = record(body),
      message = text(b.message, 2000);
    if (Object.keys(b).some((k) => k !== 'message'))
      throw new BadRequestException('Nội dung yêu cầu không hợp lệ');
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (r.assigned_reviewer !== s.subject)
        throw new ForbiddenException('Chỉ người được giao thẩm định yêu cầu bổ sung');
      if (Number(r.version) !== expected || r.status !== 'under_review')
        throw new ConflictException('Sai giai đoạn hoặc phiên bản');
      await q.query(
        "UPDATE applications SET status='supplement',decision_reason_cipher=$2,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, seal(JSON.stringify(message), scope(s.organizationId, String(r.id)))],
      );
      await event(q, s, 'application.supplement-requested', String(r.id));
      return { saved: true };
    });
  }
  async recommend(s: Staff, id: string, body: unknown, expected: number) {
    this.permission(s, ['reviewer']);
    const p = RecommendationSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Cần kết luận người thẩm định, lý do, căn cứ chứng cứ và xác nhận',
      );
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (r.assigned_reviewer !== s.subject)
        throw new ForbiddenException('Chỉ người được giao thẩm định được lập đề xuất');
      if (Number(r.version) !== expected || r.status !== 'under_review')
        throw new ConflictException('Sai phiên bản hoặc giai đoạn');
      const ref = randomUUID(),
        proof = (
          await q.query(
            'SELECT payload_hash FROM application_supplements WHERE application_id=$1 ORDER BY created_at,id',
            [r.id],
          )
        ).rows.map((x) => x.payload_hash),
        payload = {
          reasonCode: p.data.reasonCode,
          reason: p.data.reason,
          evidenceRefs: p.data.evidenceRefs,
          evidenceBundleHash: sha([r.snapshot_hash, proof]),
        };
      await q.query(
        'INSERT INTO application_reviews(id,application_id,organization_id,input_version,eligible,reviewer,payload_cipher) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          ref,
          r.id,
          s.organizationId,
          r.version,
          p.data.eligible,
          s.subject,
          seal(JSON.stringify(payload), scope(s.organizationId, String(r.id))),
        ],
      );
      await q.query(
        "UPDATE applications SET status='recommended',recommendation_id=$2,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, ref],
      );
      await event(q, s, 'application.recommended', String(r.id));
      return { id: ref, saved: true };
    });
  }
  private async lockDecisionRound(q: Sql, s: Staff, id: string) {
    const org = s.organizationId,
      initial = await this.row(q, org, id);
    this.project(s, String(initial.project_id));
    await q.query('SELECT id FROM intake_rounds WHERE id=$1 AND organization_id=$2 FOR SHARE', [
      initial.round_id,
      org,
    ]);
    const frozen = (
      await q.query(
        "SELECT w.id FROM lottery_workspaces w JOIN lottery_cohorts c ON c.id=w.cohort_id AND c.organization_id=w.organization_id WHERE c.organization_id=$1 AND c.round_id=$2 AND c.mode=$3 AND w.status IN('frozen','seeded','drawn','certified','published') LIMIT 1",
        [org, initial.round_id, read(initial, 'snapshot_cipher').mode],
      )
    ).rows;
    if (frozen.length)
      throw new ConflictException(
        'Đợt đã khóa danh sách bốc thăm; cần quy trình hủy có giám sát trước khi thay đổi kết quả xét duyệt. Khách vẫn được gửi đề nghị xem xét lại.',
      );
  }
  async decide(s: Staff, id: string, body: unknown, expected: number) {
    this.permission(s, ['approver']);
    const p = ApplicationDecisionSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Cần đề xuất đúng phiên bản, căn cứ quyết định và lý do gửi khách',
      );
    return this.db.tx(async (q) => {
      await this.lockDecisionRound(q, s, id);
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (
        Number(r.version) !== expected ||
        r.status !== 'recommended' ||
        r.recommendation_id !== uuid(p.data.recommendationId)
      )
        throw new ConflictException('Đề xuất hoặc hồ sơ đã thay đổi');
      const v = (
        await q.query(
          'SELECT * FROM application_reviews WHERE id=$1 AND application_id=$2 AND organization_id=$3',
          [r.recommendation_id, r.id, s.organizationId],
        )
      ).rows[0];
      if (!v || Number(v.input_version) !== Number(r.version) - 1)
        throw new ConflictException('Đề xuất không gắn đúng phiên bản');
      if (v.reviewer === s.subject)
        throw new ForbiddenException('Người đề xuất không được tự phê duyệt');
      if (v.eligible) {
        const evidence = (
          await q.query(
            'SELECT d.scan_status,d.deleted_at,d.sha256,ad.sha256 AS submitted_hash FROM application_documents ad JOIN documents d ON d.id=ad.document_id AND d.organization_id=ad.organization_id WHERE ad.application_id=$1 ORDER BY d.id FOR SHARE OF d',
            [r.id],
          )
        ).rows;
        if (
          evidence.some(
            (d) =>
              d.scan_status !== 'clean' || d.deleted_at !== null || d.sha256 !== d.submitted_hash,
          )
        )
          throw new ConflictException('Chứng cứ có thay đổi an toàn hoặc toàn vẹn; chưa phê duyệt');
      }
      const ref = randomUUID(),
        reason = seal(JSON.stringify(p.data.publicReason), scope(s.organizationId, String(r.id))),
        reference = seal(
          JSON.stringify(p.data.decisionReference),
          scope(s.organizationId, String(r.id)),
        );
      await q.query(
        'INSERT INTO application_decisions(id,application_id,organization_id,recommendation_id,approved,approver,reference_cipher,reason_cipher) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [ref, r.id, s.organizationId, v.id, v.eligible, s.subject, reference, reason],
      );
      await q.query(
        'UPDATE applications SET status=$2,decision_reason_cipher=$3,decision_reference_cipher=$4,decided_by=$5,version=version+1,updated_at=now() WHERE id=$1',
        [r.id, v.eligible ? 'approved' : 'rejected', reason, reference, s.subject],
      );
      await event(q, s, v.eligible ? 'application.approved' : 'application.rejected', String(r.id));
      return { saved: true, decisionId: ref };
    });
  }
  async appeal(c: Citizen, id: string, body: unknown) {
    const b = record(body),
      message = text(b.message, 3000);
    if (b.accepted !== true || Object.keys(b).some((k) => !['accepted', 'message'].includes(k)))
      throw new BadRequestException('Cần nội dung đề nghị và xác nhận gửi');
    return this.db.tx(async (q) => {
      const r = await this.row(q, c.organizationId, id, c.userId, true);
      if (!['approved', 'rejected'].includes(String(r.status)))
        throw new ConflictException('Đề nghị xem xét lại áp dụng sau khi có quyết định');
      if (
        (
          await q.query(
            "SELECT id FROM application_appeals WHERE application_id=$1 AND status='open'",
            [r.id],
          )
        ).rows.length
      )
        throw new ConflictException('Đã có đề nghị đang chờ trả lời');
      const ref = randomUUID();
      await q.query(
        'INSERT INTO application_appeals(id,application_id,organization_id,owner_user_id,message_cipher) VALUES($1,$2,$3,$4,$5)',
        [
          ref,
          r.id,
          c.organizationId,
          c.userId,
          seal(message, scope(c.organizationId, String(r.id))),
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'application.reconsideration-requested',
        String(r.id),
      );
      return { id: ref };
    });
  }
  async respondAppeal(s: Staff, id: string, appealId: string, body: unknown, expected: number) {
    this.permission(s, ['approver']);
    const b = record(body),
      reply = text(b.reply, 3000);
    if (Object.keys(b).some((k) => k !== 'reply'))
      throw new BadRequestException('Nội dung phản hồi không hợp lệ');
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (r.decided_by === s.subject)
        throw new ForbiddenException(
          'Cần người khác người đã quyết định để phản hồi đề nghị xem xét lại',
        );
      const a = (
        await q.query(
          'SELECT * FROM application_appeals WHERE id=$1 AND application_id=$2 AND organization_id=$3 FOR UPDATE',
          [uuid(appealId), r.id, s.organizationId],
        )
      ).rows[0];
      if (!a || a.status !== 'open' || Number(a.version) !== expected)
        throw new ConflictException('Đề nghị đã thay đổi');
      await q.query(
        "UPDATE application_appeals SET reply_cipher=$2,status='responded',version=version+1,updated_at=now() WHERE id=$1",
        [a.id, seal(reply, scope(s.organizationId, String(r.id)))],
      );
      await event(q, s, 'application.reconsideration-responded', String(r.id));
      return { saved: true };
    });
  }
  async reopen(s: Staff, id: string, body: unknown, expected: number) {
    this.permission(s, ['approver']);
    const b = record(body),
      reason = text(b.reason, 2000);
    if (b.accepted !== true) throw new BadRequestException('Cần xác nhận mở thẩm định lại');
    return this.db.tx(async (q) => {
      await this.lockDecisionRound(q, s, id);
      const r = await this.row(q, s.organizationId, id, undefined, true);
      this.project(s, String(r.project_id));
      if (r.status !== 'rejected' || Number(r.version) !== expected)
        throw new ConflictException(
          'Chỉ mở thẩm định lại hồ sơ đã từ chối; không tự thu hồi suất đã phê duyệt',
        );
      await q.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        r.owner_user_id,
        s.organizationId,
      ]);
      if (
        (
          await q.query(
            "SELECT id FROM applications WHERE organization_id=$1 AND owner_user_id=$2 AND status IN('submitted','under_review','supplement','recommended','approved')",
            [s.organizationId, r.owner_user_id],
          )
        ).rows.length
      )
        throw new ConflictException(
          'Tài khoản có hồ sơ khác đang thực hiện; cần xử lý theo quy trình tránh đăng ký đồng thời',
        );
      await q.query(
        "UPDATE applications SET status='under_review',recommendation_id=NULL,decision_reason_cipher=$2,version=version+1,updated_at=now() WHERE id=$1",
        [r.id, seal(JSON.stringify(reason), scope(s.organizationId, String(r.id)))],
      );
      await event(q, s, 'application.reopened', String(r.id));
      return { saved: true };
    });
  }
  async authorizeDocument(s: Staff, id: string, documentId: string) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id);
      this.access(s, r);
      const f = (
        await q.query(
          'SELECT document_id FROM application_documents WHERE application_id=$1 AND document_id=$2 AND organization_id=$3',
          [r.id, uuid(documentId), s.organizationId],
        )
      ).rows[0];
      if (!f) throw new NotFoundException('Giấy tờ không nằm trong hồ sơ được phân quyền');
      await event(q, s, 'application.document-read', uuid(documentId));
      return true;
    });
  }
  async authorizeForm(s: Staff, id: string, formId: string) {
    return this.db.tx(async (q) => {
      const r = await this.row(q, s.organizationId, id);
      this.access(s, r);
      if (
        !(
          await q.query(
            'SELECT form_id FROM application_generated_forms WHERE application_id=$1 AND form_id=$2',
            [r.id, uuid(formId)],
          )
        ).rows.length
      )
        throw new NotFoundException('Biểu mẫu không nằm trong hồ sơ được giao');
      await event(q, s, 'application.form-read', uuid(formId));
      return true;
    });
  }
}
