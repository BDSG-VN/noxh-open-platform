import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DeclarationSchema, emptyDeclaration, preparationReadiness } from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { event, record, text, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
import { verifyAudit } from './audit';

@Injectable()
export class DossierService {
  constructor(@Inject(Database) readonly db: Database) {}
  private async owner(q: Sql, c: Citizen, id: string, lock = false) {
    const r = (
      await q.query(
        `SELECT d.*,p.name AS project_name,p.locality FROM prep_dossiers d JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2 AND d.owner_user_id=$3 AND d.status='draft' ${lock ? 'FOR UPDATE OF d' : ''}`,
        [uuid(id), c.organizationId, c.userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có hồ sơ trong tài khoản của bạn');
    return r;
  }
  private scope(c: Citizen, id: string) {
    return 'declaration:' + c.organizationId + ':' + c.userId + ':' + id;
  }
  private async declaration(q: Sql, c: Citizen, id: string) {
    const row = (
      await q.query(
        'SELECT encrypted_payload FROM declaration_versions WHERE dossier_id=$1 AND organization_id=$2 ORDER BY version DESC LIMIT 1',
        [id, c.organizationId],
      )
    ).rows[0];
    return row
      ? DeclarationSchema.parse(
          JSON.parse(
            unseal(
              Buffer.from(row.encrypted_payload as Uint8Array).toString('utf8'),
              this.scope(c, id),
            ),
          ),
        )
      : { ...emptyDeclaration, household: [] };
  }
  private requestView(row: Row): Row & { message: string; reply: string | null } {
    const scope = 'request:' + row.organization_id + ':' + row.id;
    const { message_cipher, reply_cipher, owner_user_id: _owner, ...rest } = row;
    void _owner;
    return {
      ...rest,
      message: unseal(String(message_cipher), scope),
      reply: reply_cipher ? unseal(String(reply_cipher), scope) : null,
    };
  }
  async detail(c: Citizen, id: string) {
    return this.db.tx(async (q) => {
      // Row lock serializes the response with concurrent declaration saves.
      const d = await this.owner(q, c, id, true);
      const declaration = await this.declaration(q, c, id);
      const history = (
        await q.query(
          'SELECT version,created_at,source FROM declaration_versions WHERE dossier_id=$1 AND organization_id=$2 ORDER BY version DESC LIMIT 50',
          [id, c.organizationId],
        )
      ).rows;
      const requests = (
        await q.query(
          'SELECT * FROM preparation_requests WHERE dossier_id=$1 AND organization_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC LIMIT 50',
          [id, c.organizationId, c.userId],
        )
      ).rows.map((r) => this.requestView(r));
      return {
        id: d.id,
        project_id: d.project_id,
        project_name: d.project_name,
        locality: d.locality,
        version: d.version,
        created_at: d.created_at,
        updated_at: d.updated_at,
        declaration,
        readiness: preparationReadiness(declaration),
        history,
        requests,
      };
    });
  }
  async save(c: Citizen, id: string, body: unknown, expected: number, sql?: Sql) {
    const parsed = DeclarationSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Thông tin khai báo không hợp lệ; kiểm tra các trường và ngày sinh',
      );
    const d = parsed.data;
    const today = new Date().toISOString().slice(0, 10);
    if ([d.dateOfBirth, ...d.household.map((m) => m.dateOfBirth)].some((v) => v && v > today))
      throw new BadRequestException('Ngày sinh không được ở tương lai');
    if (
      d.confirmed &&
      (!d.fullName ||
        !d.dateOfBirth ||
        !d.address ||
        !d.housingSituation ||
        d.household.some((m) => !m.fullName || !m.dateOfBirth))
    )
      throw new BadRequestException('Hãy hoàn thành thông tin trước khi xác nhận');
    const apply = async (q: Sql) => {
      const dossier = await this.owner(q, c, id, true);
      if (Number(dossier.version) !== expected)
        throw new ConflictException('Hồ sơ đã thay đổi ở cửa sổ khác. Tải lại trước khi lưu.');
      const household = dossier.household_id ?? randomUUID();
      if (!dossier.household_id)
        await q.query('INSERT INTO households(id,organization_id,owner_user_id) VALUES($1,$2,$3)', [
          household,
          c.organizationId,
          c.userId,
        ]);
      else
        await q.query(
          'UPDATE households SET version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',
          [household, c.organizationId, c.userId],
        );
      await q.query(
        'UPDATE household_members SET valid_to=now() WHERE household_id=$1 AND organization_id=$2 AND valid_to IS NULL',
        [household, c.organizationId],
      );
      for (const relationship of ['owner', ...d.household.map((m) => m.relationship)])
        await q.query(
          'INSERT INTO household_members(id,organization_id,household_id,person_ref,relationship) VALUES($1,$2,$3,$4,$5)',
          [randomUUID(), c.organizationId, household, randomUUID(), relationship],
        );
      await q.query(
        "INSERT INTO declaration_versions(id,organization_id,project_id,dossier_id,schema_version,encrypted_payload,created_by,source,version) VALUES($1,$2,$3,$4,'household-v1',$5,$6,'citizen',$7)",
        [
          randomUUID(),
          c.organizationId,
          dossier.project_id,
          id,
          Buffer.from(seal(JSON.stringify(d), this.scope(c, id)), 'utf8'),
          c.userId,
          expected + 1,
        ],
      );
      await q.query(
        'UPDATE prep_dossiers SET household_id=$4,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',
        [id, c.organizationId, c.userId, household],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'declaration.saved',
        id,
      );
      return { id, version: expected + 1, readiness: preparationReadiness(d) };
    };
    return sql ? apply(sql) : this.db.tx(apply);
  }
  async assess(c: Citizen, id: string, expected: number) {
    return this.db.tx(async (q) => {
      const d = await this.owner(q, c, id, true);
      if (Number(d.version) !== expected)
        throw new ConflictException('Thông tin đã thay đổi; tải lại hồ sơ');
      const result = preparationReadiness(await this.declaration(q, c, id));
      await q.query(
        'INSERT INTO readiness_assessments(id,organization_id,project_id,dossier_id,input_version,checklist_version,score,result_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          randomUUID(),
          c.organizationId,
          d.project_id,
          id,
          d.version,
          result.version,
          result.score,
          JSON.stringify(result),
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'readiness.assessed',
        id,
      );
      return result;
    });
  }
  async requestHelp(c: Citizen, id: string, body: unknown, sql?: Sql) {
    const b = record(body),
      message = text(b.message, 2000);
    if (b.accepted !== true)
      throw new BadRequestException('Cần đồng ý chia sẻ nội dung yêu cầu với chủ đầu tư');
    const apply = async (q: Sql) => {
      const d = await this.owner(q, c, id, true);
      const active = (
        await q.query(
          "SELECT id FROM preparation_requests WHERE dossier_id=$1 AND organization_id=$2 AND status IN('open','responded')",
          [id, c.organizationId],
        )
      ).rows[0];
      if (active)
        throw new ConflictException(
          'Yêu cầu trước đang xử lý. Đóng yêu cầu đó trước khi gửi yêu cầu mới.',
        );
      const rid = randomUUID();
      await q.query(
        'INSERT INTO preparation_requests(id,organization_id,project_id,dossier_id,owner_user_id,message_cipher) VALUES($1,$2,$3,$4,$5,$6)',
        [
          rid,
          c.organizationId,
          d.project_id,
          id,
          c.userId,
          seal(message, 'request:' + c.organizationId + ':' + rid),
        ],
      );
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,$4,'preparation-support-v1',now())",
        [randomUUID(), c.organizationId, c.userId, 'preparation-support:' + rid],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'support.requested',
        rid,
      );
      return { id: rid, status: 'open' };
    };
    return sql ? apply(sql) : this.db.tx(apply);
  }
  async closeRequest(c: Citizen, id: string, expected: number) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query(
          "UPDATE preparation_requests SET status='closed',version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND version=$4 AND status IN('open','responded') RETURNING id",
          [uuid(id), c.organizationId, c.userId, expected],
        )
      ).rows[0];
      if (!r) throw new ConflictException('Yêu cầu không tồn tại hoặc đã thay đổi');
      await event(q, { organizationId: c.organizationId, subject: c.userId }, 'support.closed', id);
      return { id, status: 'closed', version: expected + 1 };
    });
  }
  async requests(s: Staff) {
    // Staff see only purpose-specific messages the citizen explicitly shared, never declarations.
    return (
      await this.db.query(
        'SELECT r.*,p.name AS project_name FROM preparation_requests r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 ORDER BY r.created_at DESC LIMIT 200',
        [s.organizationId],
      )
    ).map((r) => this.requestView(r));
  }
  async reply(s: Staff, id: string, body: unknown, expected: number) {
    const message = text(record(body).message, 2000);
    return this.db.tx(async (q) => {
      const r = (
        await q.query(
          "UPDATE preparation_requests SET reply_cipher=$4,status='responded',version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND version=$3 AND status='open' RETURNING id",
          [
            uuid(id),
            s.organizationId,
            expected,
            seal(message, 'request:' + s.organizationId + ':' + id),
          ],
        )
      ).rows[0];
      if (!r) throw new ConflictException('Yêu cầu không còn chờ trả lời hoặc đã thay đổi');
      await event(q, s, 'support.responded', id);
      return { id, status: 'responded', version: expected + 1 };
    });
  }
  async audit(s: Staff) {
    // Single query gives a consistent snapshot. Bound export; never declare a truncated chain valid.
    const rows = await this.db.query(
      'SELECT * FROM identity_private.audit_chain WHERE organization_id=$1 ORDER BY sequence LIMIT 10001',
      [s.organizationId],
    );
    const verification =
      rows.length > 10000
        ? { valid: null, checked: 0, reason: 'Cần xuất kiểm tra đầy đủ khi vượt 10.000 sự kiện' }
        : verifyAudit(rows);
    return {
      verification,
      items: rows.slice(-100).reverse(),
      externalCheckpoint: false,
      legacyOperationsIncluded: false,
    };
  }
}
