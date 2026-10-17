import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { PrivacyChoiceSchema, PrivacyNoticeSchema, PrivacyRequestSchema } from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, record, text, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Staff } from './workforce';
import type { Citizen } from './phone-service';

@Injectable()
export class PrivacyService {
  constructor(@Inject(Database) readonly db: Database) {}
  private view(r: Row) {
    return {
      ...record(r.payload),
      id: r.id,
      version: r.version,
      content_hash: r.content_hash,
      status: r.status,
      created_by: r.created_by,
      approved_by: r.approved_by,
      approved_at: r.approved_at,
    };
  }
  async current(org: string, q?: Sql) {
    const sql =
      "SELECT * FROM privacy_notices WHERE organization_id=$1 AND status IN('approved','revoked') ORDER BY version DESC LIMIT 1";
    const [r] = q ? (await q.query(sql, [org])).rows : await this.db.query(sql, [org]);
    if (r?.status !== 'approved') return null;
    const { created_by: _author, approved_by: _reviewer, ...notice } = this.view(r);
    void _author;
    void _reviewer;
    return notice;
  }
  async notices(s: Staff) {
    return {
      items: (
        await this.db.query(
          'SELECT * FROM privacy_notices WHERE organization_id=$1 ORDER BY version DESC LIMIT 100',
          [s.organizationId],
        )
      ).map((r) => this.view(r)),
    };
  }
  async draft(s: Staff, body: unknown) {
    const p = PrivacyNoticeSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Cần khai đầy đủ thông báo và xác nhận rà soát trách nhiệm bảo vệ dữ liệu',
      );
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [s.organizationId]);
      const version = Number(
        (
          await q.query(
            'SELECT COALESCE(max(version),0)+1 AS n FROM privacy_notices WHERE organization_id=$1',
            [s.organizationId],
          )
        ).rows[0]!.n,
      );
      const id = randomUUID(),
        hash = createHash('sha256').update(JSON.stringify(p.data)).digest('hex');
      await q.query(
        'INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6)',
        [id, s.organizationId, version, JSON.stringify(p.data), hash, s.subject],
      );
      await event(q, s, 'privacy.notice-drafted', id);
      return { id, version };
    });
  }
  async review(s: Staff, id: string, body: unknown) {
    if (!s.permissions?.includes('privacy_officer'))
      throw new ForbiddenException('Cần quyền privacy_officer và người duyệt khác người soạn');
    const b = record(body);
    if (
      b.accepted !== true ||
      !['approve', 'revoke'].includes(String(b.action)) ||
      Object.keys(b).some((k) => !['action', 'accepted'].includes(k))
    )
      throw new BadRequestException('Cần xác nhận quyết định rà soát');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [s.organizationId]);
      const r = (
        await q.query(
          'SELECT * FROM privacy_notices WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có thông báo');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Không được tự duyệt thông báo của mình');
      if (r.status !== (b.action === 'approve' ? 'draft' : 'approved'))
        throw new ConflictException('Trạng thái đã thay đổi');
      if (b.action === 'approve')
        await q.query(
          "UPDATE privacy_notices SET status='approved',approved_by=$2,approved_at=now() WHERE id=$1",
          [id, s.subject],
        );
      else await q.query("UPDATE privacy_notices SET status='revoked' WHERE id=$1", [id]);
      await event(q, s, 'privacy.notice-' + b.action, id);
      return { saved: true };
    });
  }
  private requestView(r: Row) {
    const scope = 'privacy-request:' + r.organization_id + ':' + r.id;
    return {
      id: r.id,
      kind: r.kind,
      version: r.version,
      status: r.status,
      created_at: r.created_at,
      message: unseal(String(r.message_cipher), scope),
      reply: r.reply_cipher ? unseal(String(r.reply_cipher), scope) : null,
    };
  }
  async workspace(c: Citizen) {
    const notice = await this.current(c.organizationId);
    const [choice] = await this.db.query(
      'SELECT action,notice_id FROM identity_private.privacy_choices WHERE organization_id=$1 AND user_id=$2 ORDER BY sequence DESC LIMIT 1',
      [c.organizationId, c.userId],
    );
    const [prefs] = await this.db.query(
      'SELECT restricted FROM identity_private.privacy_preferences WHERE organization_id=$1 AND user_id=$2',
      [c.organizationId, c.userId],
    );
    return {
      notice,
      accepted: Boolean(notice && choice?.action === 'grant' && choice.notice_id === notice.id),
      restricted: prefs?.restricted === true,
      requests: (
        await this.db.query(
          'SELECT * FROM privacy_requests WHERE organization_id=$1 AND owner_user_id=$2 ORDER BY created_at DESC LIMIT 50',
          [c.organizationId, c.userId],
        )
      ).map((r) => this.requestView(r)),
    };
  }
  async assertProcessing(c: Citizen, sql?: Sql): Promise<{ noticeId: string; noticeHash: string }> {
    const verify = async (q: Sql) => {
      const org = (
        await q.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE', [c.organizationId])
      ).rows[0];
      const notice = org ? await this.current(c.organizationId, q) : null;
      const choice = (
        await q.query(
          'SELECT action,notice_id,notice_hash FROM identity_private.privacy_choices WHERE organization_id=$1 AND user_id=$2 ORDER BY sequence DESC LIMIT 1',
          [c.organizationId, c.userId],
        )
      ).rows[0];
      const prefs = (
        await q.query(
          'SELECT restricted FROM identity_private.privacy_preferences WHERE organization_id=$1 AND user_id=$2',
          [c.organizationId, c.userId],
        )
      ).rows[0];
      if (
        !notice ||
        choice?.action !== 'grant' ||
        choice.notice_id !== notice.id ||
        choice.notice_hash !== notice.content_hash
      )
        throw new HttpException(
          'Cần đọc và đồng ý thông báo bảo vệ dữ liệu hiện hành tại mục Quyền riêng tư trước khi gửi thêm thông tin.',
          428,
        );
      if (prefs?.restricted === true)
        throw new ForbiddenException(
          'Bạn đang hạn chế xử lý dữ liệu. Có thể tiếp tục xem, tải hoặc thực hiện quyền tại mục Quyền riêng tư.',
        );
      return { noticeId: String(notice.id), noticeHash: String(notice.content_hash) };
    };
    return sql ? verify(sql) : this.db.tx(verify);
  }
  async choose(c: Citizen, body: unknown) {
    const p = PrivacyChoiceSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần xác nhận đúng phiên bản thông báo đã đọc');
    return this.db.tx(async (q) => {
      // Organization lock also serializes publication, withdrawal and concurrent choices.
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [c.organizationId]);
      const n = await this.current(c.organizationId, q);
      if (!n || n.id !== p.data.noticeId || n.content_hash !== p.data.contentHash)
        throw new ConflictException('Thông báo đã thay đổi; hãy đọc lại trước khi đồng ý');
      const id = randomUUID();
      await q.query(
        "INSERT INTO identity_private.privacy_choices(id,organization_id,user_id,notice_id,notice_hash,action) VALUES($1,$2,$3,$4,$5,'grant')",
        [id, c.organizationId, c.userId, n.id, n.content_hash],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'privacy.consent-granted',
        id,
      );
      return { saved: true };
    });
  }
  async withdraw(c: Citizen) {
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [c.organizationId]);
      const r = (
        await q.query(
          'SELECT * FROM identity_private.privacy_choices WHERE organization_id=$1 AND user_id=$2 ORDER BY sequence DESC LIMIT 1',
          [c.organizationId, c.userId],
        )
      ).rows[0];
      const id = r && r.action !== 'withdraw' ? randomUUID() : null;
      if (id)
        await q.query(
          "INSERT INTO identity_private.privacy_choices(id,organization_id,user_id,notice_id,notice_hash,action) VALUES($1,$2,$3,$4,$5,'withdraw')",
          [id, c.organizationId, c.userId, r!.notice_id, r!.notice_hash],
        );
      await q.query(
        "UPDATE identity_private.partner_leads SET status='withdrawn',details_cipher=NULL,version=version+1,updated_at=now() WHERE organization_id=$1 AND owner_user_id=$2 AND status<>'withdrawn'",
        [c.organizationId, c.userId],
      );
      await q.query(
        "UPDATE consent_records SET withdrawn_at=now() WHERE organization_id=$1 AND user_id=$2 AND withdrawn_at IS NULL AND (purpose LIKE 'partner-consultation:%' OR purpose LIKE 'openai-request:%' OR purpose LIKE 'openai-document:%' OR purpose LIKE 'local-ocr:%')",
        [c.organizationId, c.userId],
      );
      await q.query(
        'UPDATE identity_private.ai_proposals SET consumed_at=now() WHERE organization_id=$1 AND owner_user_id=$2 AND consumed_at IS NULL',
        [c.organizationId, c.userId],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'privacy.consent-withdrawn',
        id ?? c.userId,
      );
      return { withdrawn: true };
    });
  }
  async restrict(c: Citizen, body: unknown) {
    const b = record(body);
    if (typeof b.restricted !== 'boolean' || Object.keys(b).some((k) => k !== 'restricted'))
      throw new BadRequestException('Chọn trạng thái hạn chế xử lý');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [c.organizationId]);
      await q.query(
        'INSERT INTO identity_private.privacy_preferences(organization_id,user_id,restricted) VALUES($1,$2,$3) ON CONFLICT(organization_id,user_id) DO UPDATE SET restricted=$3,updated_at=now()',
        [c.organizationId, c.userId, b.restricted],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        b.restricted ? 'privacy.restricted' : 'privacy.restriction-lifted',
        c.userId,
      );
      return { saved: true };
    });
  }
  async request(c: Citizen, body: unknown) {
    const p = PrivacyRequestSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Chọn quyền và nhập nội dung yêu cầu');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM users WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        c.userId,
        c.organizationId,
      ]);
      const count = Number(
        (
          await q.query(
            "SELECT count(*) AS n FROM privacy_requests WHERE organization_id=$1 AND owner_user_id=$2 AND created_at>now()-interval '1 day'",
            [c.organizationId, c.userId],
          )
        ).rows[0]!.n,
      );
      if (count >= 10)
        throw new HttpException(
          'Tối đa 10 yêu cầu mỗi ngày. Có thể liên hệ đầu mối trong thông báo để được hỗ trợ.',
          429,
        );
      const id = randomUUID();
      await q.query(
        'INSERT INTO privacy_requests(id,organization_id,owner_user_id,kind,message_cipher) VALUES($1,$2,$3,$4,$5)',
        [
          id,
          c.organizationId,
          c.userId,
          p.data.kind,
          seal(p.data.message, 'privacy-request:' + c.organizationId + ':' + id),
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'privacy.right-requested',
        id,
      );
      return { id };
    });
  }
  private officer(s: Staff) {
    if (!s.permissions?.includes('privacy_officer'))
      throw new ForbiddenException('Cần quyền privacy_officer để đọc yêu cầu dữ liệu');
  }
  async requests(s: Staff) {
    this.officer(s);
    return {
      items: (
        await this.db.query(
          'SELECT * FROM privacy_requests WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 200',
          [s.organizationId],
        )
      ).map((r) => this.requestView(r)),
    };
  }
  async respond(s: Staff, id: string, body: unknown, expected: number) {
    this.officer(s);
    const b = record(body),
      reply = text(b.reply, 2000);
    if (
      !['processing', 'responded'].includes(String(b.status)) ||
      Object.keys(b).some((k) => !['reply', 'status'].includes(k))
    )
      throw new BadRequestException('Trạng thái phản hồi không hợp lệ');
    return this.db.tx(async (q) => {
      const r = (
        await q.query(
          'SELECT * FROM privacy_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có yêu cầu');
      if (Number(r.version) !== expected) throw new ConflictException('Yêu cầu đã thay đổi');
      await q.query(
        'UPDATE privacy_requests SET reply_cipher=$2,status=$3,version=version+1,updated_at=now() WHERE id=$1',
        [id, seal(reply, 'privacy-request:' + s.organizationId + ':' + uuid(id)), b.status],
      );
      await event(q, s, 'privacy.right-responded', uuid(id));
      return { saved: true };
    });
  }
}
