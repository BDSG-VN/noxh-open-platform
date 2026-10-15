import { PrivacyService } from './privacy-service';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {
  FormReleaseSchema,
  OnlineCaseSchema,
  onlineProcedures,
  type LegalForm,
} from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { event, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
@Injectable()
export class AssistanceService {
  constructor(@Inject(Database) readonly db: Database) {}
  async catalog() {
    const raw = JSON.parse(
      await readFile(resolve(__dirname, '../../../legal/catalog.json'), 'utf8'),
    ) as { version: string; researchedOn: string; forms: LegalForm[] };
    return {
      ...raw,
      scope:
        'Nguồn trung ương đã tra cứu; cần rà soát địa phương và dự án trước khi áp dụng. Nhóm 13 và chế độ lực lượng vũ trang cần rà soát chuyên biệt.',
    };
  }
  async pdf(id: string) {
    const f = (await this.catalog()).forms.find((f) => f.id === id);
    if (!f || !/^[a-z0-9-]+\.pdf$/.test(f.file)) throw new NotFoundException('Không có biểu mẫu');
    const bytes = await readFile(resolve(__dirname, '../../../legal/forms', f.file));
    if (createHash('sha256').update(bytes).digest('hex') !== f.sha256)
      throw new ConflictException('Mẫu nguồn không khớp bản kiểm chứng');
    return { bytes, file: f.file };
  }
  async owner(q: Sql, c: Citizen, id: string, lock = false) {
    const d = (
      await q.query(
        `SELECT * FROM prep_dossiers WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 ${lock ? 'FOR UPDATE' : ''}`,
        [uuid(id), c.organizationId, c.userId],
      )
    ).rows[0];
    if (!d) throw new NotFoundException('Không có hồ sơ trong tài khoản của bạn');
    return d;
  }
  async projectForms(s: Staff, project: string) {
    if (
      !(
        await this.db.query(
          'SELECT id FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL',
          [uuid(project), s.organizationId],
        )
      ).length
    )
      throw new NotFoundException('Không có dự án');
    return this.db.query(
      'SELECT * FROM project_form_releases WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 200',
      [s.organizationId, project],
    );
  }
  private async releases(org: string, project: string) {
    return this.db.query(
      `SELECT * FROM (SELECT DISTINCT ON(form_id,mode,subject_group) * FROM project_form_releases WHERE organization_id=$1 AND project_id=$2 AND status IN('approved','revoked') AND effective_from<=CURRENT_DATE ORDER BY form_id,mode,subject_group,version DESC) latest WHERE status='approved' AND (effective_to IS NULL OR effective_to>=CURRENT_DATE)`,
      [org, project],
    );
  }
  async publish(s: Staff, project: string, body: unknown) {
    const parsed = FormReleaseSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Kiểm tra cấu hình mẫu và xác nhận đã rà soát pháp lý');
    const b = parsed.data,
      catalog = await this.catalog(),
      f = catalog.forms.find((f) => f.id === b.formId);
    if (!f || !f.modes.includes(b.mode) || !f.groups.includes(b.group))
      throw new BadRequestException(
        'Mẫu không thuộc phạm vi này; cần rà soát riêng, không suy diễn biểu mẫu',
      );
    if (b.group === 11 && b.mode !== 'rent')
      throw new BadRequestException(
        'Đối tượng học sinh, sinh viên áp dụng hình thức thuê; không chọn mua hoặc thuê mua',
      );
    return this.db.tx(async (q) => {
      if (
        !(
          await q.query(
            'SELECT id FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE',
            [uuid(project), s.organizationId],
          )
        ).rows.length
      )
        throw new NotFoundException('Không có dự án');
      const n = (
        await q.query(
          'SELECT COALESCE(max(version),0)::int+1 AS n FROM project_form_releases WHERE organization_id=$1 AND project_id=$2 AND form_id=$3 AND mode=$4 AND subject_group=$5',
          [s.organizationId, project, b.formId, b.mode, b.group],
        )
      ).rows[0]!.n;
      if (b.effectiveTo && b.effectiveTo < b.effectiveFrom)
        throw new BadRequestException('Khoảng ngày hiệu lực không hợp lệ');
      const id = randomUUID();
      await q.query(
        'INSERT INTO project_form_releases(id,organization_id,project_id,form_id,title,source_hash,catalog_version,recipient,instructions,mode,subject_group,created_by,version,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          id,
          s.organizationId,
          project,
          f.id,
          f.title,
          f.sha256,
          catalog.version,
          b.recipient,
          b.instructions,
          b.mode,
          b.group,
          s.subject,
          n,
          b.effectiveFrom,
          b.effectiveTo,
        ],
      );
      await event(q, s, 'form.drafted', id);
      return { id, version: n };
    });
  }
  async review(s: Staff, project: string, id: string, body: unknown) {
    if (!s.permissions?.includes('form_legal_approver'))
      throw new ForbiddenException('Cần quyền form_legal_approver được cấp trong hệ thống nhân sự');
    const b = body as Record<string, unknown>;
    if (
      !b ||
      b.accepted !== true ||
      !['approve', 'revoke'].includes(String(b.action)) ||
      Object.keys(b).some((k) => !['accepted', 'action'].includes(k))
    )
      throw new BadRequestException('Cần quyết định và xác nhận rà soát riêng');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM projects WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        uuid(project),
        s.organizationId,
      ]);
      const r = (
        await q.query(
          'SELECT * FROM project_form_releases WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [uuid(id), s.organizationId, uuid(project)],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có bản hướng dẫn trong dự án');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người soạn không được tự duyệt bản hướng dẫn của mình');
      if (b.action === 'approve') {
        const f = (await this.catalog()).forms.find((f) => f.id === r.form_id);
        if (!f || f.sha256 !== r.source_hash)
          throw new ConflictException('Mẫu nguồn đã thay đổi, cần tạo bản hướng dẫn mới');
        if (r.status !== 'draft') throw new ConflictException('Bản hướng dẫn không còn chờ duyệt');
        await q.query(
          "UPDATE project_form_releases SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1",
          [id, s.subject],
        );
      } else {
        if (r.status !== 'approved') throw new ConflictException('Chỉ thu hồi bản đang được duyệt');
        await q.query("UPDATE project_form_releases SET status='revoked' WHERE id=$1", [id]);
      }
      await event(q, s, b.action === 'approve' ? 'form.approved' : 'form.revoked', id);
      return { id, status: b.action === 'approve' ? 'approved' : 'revoked' };
    });
  }
  private caseView(r: Row) {
    return {
      id: r.id,
      version: r.version,
      updated_at: r.updated_at,
      source: r.source,
      ...JSON.parse(
        unseal(
          String(r.details_cipher),
          'online-case:' + r.organization_id + ':' + r.owner_user_id + ':' + r.id,
        ),
      ),
    };
  }
  async workspace(c: Citizen, id: string) {
    const d = await this.db.tx((q) => this.owner(q, c, id));
    const cases = await this.db.query(
      'SELECT * FROM online_cases WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC LIMIT 50',
      [c.organizationId, id, c.userId],
    );
    return {
      procedures: onlineProcedures,
      cases: cases.map((r) => this.caseView(r)),
      forms: await this.releases(c.organizationId, String(d.project_id)),
      sync: {
        mode: 'manual-handoff',
        connected: false,
        notice:
          'Trạng thái do bạn tự cập nhật. Chưa có kết nối API được cấp quyền để xác minh hoặc đồng bộ tự động từ Cổng Dịch vụ công.',
      },
    };
  }
  async saveCase(c: Citizen, dossier: string, body: unknown, id?: string, expected?: number) {
    const parsed = OnlineCaseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Thông tin biên nhận không hợp lệ');
    return this.db.tx(async (q) => {
      await this.owner(q, c, dossier);
      await new PrivacyService(this.db).assertProcessing(c, q);
      const d = await this.owner(q, c, dossier, true);
      if (
        !id &&
        Number(
          (
            await q.query(
              'SELECT count(*)::int AS n FROM online_cases WHERE dossier_id=$1 AND organization_id=$2 AND owner_user_id=$3',
              [dossier, c.organizationId, c.userId],
            )
          ).rows[0]!.n,
        ) >= 50
      )
        throw new ConflictException('Tối đa 50 biên nhận mỗi hồ sơ');
      const ref = id ? uuid(id) : randomUUID(),
        cipher = seal(
          JSON.stringify(parsed.data),
          'online-case:' + c.organizationId + ':' + c.userId + ':' + ref,
        );
      if (id) {
        const changed = await q.query(
          'UPDATE online_cases SET details_cipher=$5,procedure_id=$7,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND version=$6 RETURNING id',
          [ref, c.organizationId, dossier, c.userId, cipher, expected, parsed.data.procedureId],
        );
        if (!changed.rows.length)
          throw new ConflictException('Biên nhận đã thay đổi hoặc không thuộc hồ sơ');
      } else
        await q.query(
          'INSERT INTO online_cases(id,organization_id,project_id,dossier_id,owner_user_id,procedure_id,details_cipher) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [ref, c.organizationId, d.project_id, dossier, c.userId, parsed.data.procedureId, cipher],
        );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'online-case.' + (id ? 'updated' : 'recorded'),
        ref,
      );
      return { id: ref, version: id ? expected! + 1 : 1, source: 'citizen-reported' };
    });
  }
}
