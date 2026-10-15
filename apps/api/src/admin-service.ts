import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Database, type Sql } from './database';
import type { Staff } from './workforce';
import { seal, unseal } from './identity-crypto';
import { appendAudit } from './audit';
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('JSON không hợp lệ');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new BadRequestException('Trường văn bản không hợp lệ');
  return value.trim();
}
export function uuid(value: unknown) {
  const s = text(value, 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s))
    throw new BadRequestException('Mã định danh không hợp lệ');
  return s.toLowerCase();
}
export function version(value: unknown) {
  if (typeof value !== 'string' || !/^"?\d+"?$/.test(value))
    throw new HttpException('Cần phiên bản If-Match', 428);
  return Number(value.replace(/"/g, ''));
}
export async function event(
  sql: Sql,
  staff: { organizationId: string; subject: string },
  action: string,
  resource: string,
) {
  const id = randomUUID();
  await sql.query(
    'INSERT INTO identity_private.operations(id,organization_id,actor_ref,action,resource_ref) VALUES($1,$2,$3,$4,$5)',
    [id, staff.organizationId, staff.subject, action, resource],
  );
  await appendAudit(sql, id, staff.organizationId, staff.subject, action, resource);
}
export interface ZaloSettings {
  enabled: boolean;
  oaId: string;
  appId: string;
  templateId: string;
  otpParameter: string;
  accessToken?: string;
  appSecret?: string;
}
@Injectable()
export class AdminService {
  constructor(@Inject(Database) readonly db: Database) {}
  async dashboard(s: Staff) {
    const [row] = await this.db.query(
      `SELECT (SELECT count(*)::int FROM projects WHERE organization_id=$1 AND archived_at IS NULL) AS projects,(SELECT count(*)::int FROM intake_rounds r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.status='open' AND p.archived_at IS NULL AND r.opens_at<=now() AND r.closes_at>now()) AS open_rounds,(SELECT count(*)::int FROM prep_dossiers WHERE organization_id=$1) AS preparatory_dossiers,(SELECT count(*)::int FROM identity_private.phone_accounts WHERE organization_id=$1) AS citizen_accounts`,
      [s.organizationId],
    );
    return { ...row, officialApplicationsAvailable: false };
  }
  async projects(s: Staff) {
    return this.db.query(
      'SELECT id,name,locality,publication_status,is_synthetic,version FROM projects WHERE organization_id=$1 AND archived_at IS NULL ORDER BY created_at DESC',
      [s.organizationId],
    );
  }
  async createProject(s: Staff, body: unknown) {
    const b = record(body);
    const id = randomUUID();
    return this.db.tx(async (q) => {
      const r = await q.query(
        'INSERT INTO projects(id,organization_id,name,locality) VALUES($1,$2,$3,$4) RETURNING id,name,locality,publication_status,version',
        [id, s.organizationId, text(b.name), text(b.locality)],
      );
      await event(q, s, 'project.created', id);
      return r.rows[0];
    });
  }
  async updateProject(s: Staff, id: string, body: unknown, expected: number, archive = false) {
    uuid(id);
    const b = record(body);
    const status = archive ? 'draft' : text(b.publicationStatus, 20);
    if (!['draft', 'published'].includes(status))
      throw new BadRequestException('Trạng thái không hợp lệ');
    return this.db.tx(async (q) => {
      const found = (
        await q.query(
          'SELECT version FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE',
          [id, s.organizationId],
        )
      ).rows[0];
      if (!found) throw new NotFoundException('Không có dự án trong phạm vi của bạn');
      if (found.version !== expected) throw new ConflictException('Dự án đã thay đổi, hãy tải lại');
      const r = await q.query(
        'UPDATE projects SET name=COALESCE($3,name),locality=COALESCE($4,locality),publication_status=$5,archived_at=CASE WHEN $6 THEN now() ELSE NULL END,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,name,locality,publication_status,version',
        [
          id,
          s.organizationId,
          archive ? null : text(b.name),
          archive ? null : text(b.locality),
          status,
          archive,
        ],
      );
      await event(q, s, archive ? 'project.archived' : 'project.updated', id);
      return r.rows[0];
    });
  }
  async rounds(s: Staff) {
    return this.db.query(
      'SELECT r.id,r.project_id,p.name AS project_name,r.name,r.status,r.opens_at,r.closes_at,r.version FROM intake_rounds r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND p.archived_at IS NULL ORDER BY r.created_at DESC',
      [s.organizationId],
    );
  }
  async saveRound(s: Staff, body: unknown, id?: string, expected?: number) {
    const b = record(body);
    const project = uuid(b.projectId);
    const opens = text(b.opensAt, 40),
      closes = text(b.closesAt, 40);
    if (
      !Number.isFinite(Date.parse(opens)) ||
      !Number.isFinite(Date.parse(closes)) ||
      Date.parse(closes) <= Date.parse(opens)
    )
      throw new BadRequestException('Thời gian tiếp nhận không hợp lệ');
    const status = text(b.status, 10);
    if (!['draft', 'open', 'closed'].includes(status))
      throw new BadRequestException('Trạng thái không hợp lệ');
    return this.db.tx(async (q) => {
      if (
        !(
          await q.query(
            'SELECT id FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL',
            [project, s.organizationId],
          )
        ).rows.length
      )
        throw new NotFoundException('Không có dự án trong phạm vi');
      const rid = id ? uuid(id) : randomUUID();
      let result;
      if (id) {
        result = await q.query(
          'UPDATE intake_rounds SET name=$3,status=$4,opens_at=$5,closes_at=$6,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND project_id=$7 AND version=$8 RETURNING *',
          [rid, s.organizationId, text(b.name), status, opens, closes, project, expected],
        );
        if (!result.rows.length)
          throw new ConflictException('Đợt tiếp nhận không tồn tại hoặc đã thay đổi');
      } else
        result = await q.query(
          'INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [rid, s.organizationId, project, text(b.name), status, opens, closes],
        );
      await event(q, s, id ? 'round.updated' : 'round.created', rid);
      return result.rows[0];
    });
  }
  async settings(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức được cấu hình Zalo');
    const [row] = await this.db.query(
      'SELECT organization_id,oa_id,app_id,template_id,otp_parameter,enabled,version,updated_at FROM identity_private.zalo_settings WHERE organization_id=$1',
      [s.organizationId],
    );
    return row ?? { enabled: false, version: 0, configured: false };
  }
  async saveSettings(s: Staff, body: unknown, expected: number) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức được cấu hình Zalo');
    const b = record(body);
    if (typeof b.enabled !== 'boolean') throw new BadRequestException('Cờ kích hoạt không hợp lệ');
    const oaId = text(b.oaId, 100),
      appId = text(b.appId, 100),
      templateId = text(b.templateId, 100),
      otpParameter = text(b.otpParameter, 64);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(otpParameter))
      throw new BadRequestException('Tên biến OTP không hợp lệ');
    await this.db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalo:' + s.organizationId]);
      const old = (
        await q.query(
          'SELECT * FROM identity_private.zalo_settings WHERE organization_id=$1 FOR UPDATE',
          [s.organizationId],
        )
      ).rows[0];
      if (Number(old?.version ?? 0) !== expected)
        throw new ConflictException('Cấu hình đã thay đổi, hãy tải lại');
      const secrets: Record<string, string> = old
        ? JSON.parse(unseal(String(old.secret_cipher), 'zalo:' + s.organizationId))
        : {};
      if (b.accessToken) secrets.accessToken = text(b.accessToken, 4096);
      if (b.appSecret) secrets.appSecret = text(b.appSecret, 4096);
      if (!secrets.accessToken || !secrets.appSecret)
        throw new BadRequestException('Cần Access Token và App Secret');
      const cipher = seal(JSON.stringify(secrets), 'zalo:' + s.organizationId);
      await q.query(
        'INSERT INTO identity_private.zalo_settings(organization_id,oa_id,app_id,template_id,otp_parameter,secret_cipher,enabled) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id) DO UPDATE SET oa_id=$2,app_id=$3,template_id=$4,otp_parameter=$5,secret_cipher=$6,enabled=$7,version=zalo_settings.version+1,updated_at=now()',
        [s.organizationId, oaId, appId, templateId, otpParameter, cipher, b.enabled],
      );
      await event(q, s, 'zalo.settings.updated', s.organizationId);
    });
    return this.settings(s);
  }
}
