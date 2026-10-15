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
  CampaignSchema,
  CampaignReviewSchema,
  ConsultationSchema,
  LeadUpdateSchema,
  PartnerCreateSchema,
  PartnerUpdateSchema,
  PartnerMemberSchema,
  PartnerMemberUpdateSchema,
  type PartnerActor,
  type PartnerRole,
} from '@noxh/contracts';
import { Database, type Sql, type Row } from './database';
import { event, record, uuid } from './admin-service';
import { digest, normalizePhone, seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
@Injectable()
export class PartnerService {
  constructor(@Inject(Database) readonly db: Database) {}
  private async partner(q: Sql, s: Staff, id: string) {
    const r = (
      await q.query('SELECT * FROM partners WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        uuid(id),
        s.organizationId,
      ])
    ).rows[0];
    if (!r) throw new NotFoundException('Không có đối tác trong tổ chức');
    return r;
  }
  private async projects(q: Sql, org: string, id: string, projects: string[]) {
    for (const project of projects)
      if (
        !(
          await q.query(
            'SELECT id FROM projects WHERE organization_id=$1 AND id=$2 AND archived_at IS NULL',
            [org, project],
          )
        ).rows.length
      )
        throw new BadRequestException('Dự án không thuộc tổ chức hoặc đã lưu trữ');
    await q.query(
      'UPDATE partner_projects SET active=false WHERE organization_id=$1 AND partner_id=$2',
      [org, id],
    );
    for (const project of [...new Set(projects)])
      await q.query(
        'INSERT INTO partner_projects(organization_id,partner_id,project_id) VALUES($1,$2,$3) ON CONFLICT(organization_id,partner_id,project_id) DO UPDATE SET active=true',
        [org, id, project],
      );
  }
  private async invite(
    q: Sql,
    org: string,
    partner: string,
    b: { name: string; phone: string; role: PartnerRole },
  ) {
    const phone = normalizePhone(b.phone),
      ref = digest('phone', org + ':' + phone);
    if (
      (
        await q.query(
          'SELECT id FROM identity_private.partner_members WHERE organization_id=$1 AND phone_ref=$2',
          [org, ref],
        )
      ).rows.length
    )
      throw new ConflictException('Số điện thoại đã được cấp tài khoản đối tác trong tổ chức');
    const id = randomUUID();
    await q.query(
      'INSERT INTO identity_private.partner_members(id,organization_id,partner_id,name,phone_ref,phone_cipher,role) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id, org, partner, b.name, ref, seal(phone, 'partner-member:' + org + ':' + id), b.role],
    );
    return { id };
  }
  async list(s: Staff) {
    return this.db.query(
      `SELECT p.*,(SELECT COALESCE(json_agg(pp.project_id),'[]'::json) FROM partner_projects pp WHERE pp.organization_id=p.organization_id AND pp.partner_id=p.id AND pp.active) AS project_ids,(SELECT count(*)::int FROM identity_private.partner_members m WHERE m.organization_id=p.organization_id AND m.partner_id=p.id AND m.status='active') AS members,(SELECT count(*)::int FROM partner_campaigns c WHERE c.organization_id=p.organization_id AND c.partner_id=p.id) AS campaigns,(SELECT count(*)::int FROM identity_private.partner_leads l WHERE l.organization_id=p.organization_id AND l.partner_id=p.id AND l.status<>'withdrawn') AS leads FROM partners p WHERE p.organization_id=$1 ORDER BY p.created_at DESC LIMIT 200`,
      [s.organizationId],
    );
  }
  async create(s: Staff, body: unknown) {
    const p = PartnerCreateSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Kiểm tra tên đối tác, người quản lý, điện thoại và dự án');
    const b = p.data;
    return this.db.tx(async (q) => {
      const id = randomUUID();
      await q.query('INSERT INTO partners(id,organization_id,name) VALUES($1,$2,$3)', [
        id,
        s.organizationId,
        b.name,
      ]);
      await this.projects(q, s.organizationId, id, b.projectIds);
      await this.invite(q, s.organizationId, id, {
        name: b.ownerName,
        phone: b.ownerPhone,
        role: 'partner_admin',
      });
      await event(q, s, 'partner.created', id);
      return { id, version: 1 };
    });
  }
  async update(s: Staff, id: string, body: unknown, expected: number) {
    const p = PartnerUpdateSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cấu hình đối tác không hợp lệ');
    return this.db.tx(async (q) => {
      const r = await this.partner(q, s, id);
      if (Number(r.version) !== expected) throw new ConflictException('Đối tác đã thay đổi');
      await this.projects(q, s.organizationId, id, p.data.projectIds);
      await q.query(
        'UPDATE partners SET name=$3,status=$4,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2',
        [id, s.organizationId, p.data.name, p.data.status],
      );
      await event(q, s, 'partner.updated', id);
      return { id, version: expected + 1 };
    });
  }
  private async actor(q: Sql, c: Citizen, roles?: PartnerRole[]): Promise<PartnerActor> {
    const r = (
      await q.query(
        "SELECT m.*,p.name AS partner_name FROM identity_private.partner_members m JOIN partners p ON p.id=m.partner_id AND p.organization_id=m.organization_id JOIN identity_private.phone_accounts a ON a.organization_id=m.organization_id AND a.phone_ref=m.phone_ref WHERE a.organization_id=$1 AND a.user_id=$2 AND m.status='active' AND p.status='active' FOR UPDATE OF p,m",
        [c.organizationId, c.userId],
      )
    ).rows[0];
    if (!r) throw new ForbiddenException('Tài khoản chưa được cấp quyền đối tác hoặc đã tạm khóa');
    if (roles && !roles.includes(r.role as PartnerRole))
      throw new ForbiddenException('Vai trò hiện tại không có quyền thực hiện thao tác này');
    return {
      organizationId: c.organizationId,
      userId: c.userId,
      partnerId: String(r.partner_id),
      memberId: String(r.id),
      role: r.role as PartnerRole,
      partnerName: String(r.partner_name),
      name: String(r.name),
    };
  }
  private memberView(r: Row) {
    const phone = unseal(
      String(r.phone_cipher),
      'partner-member:' + r.organization_id + ':' + r.id,
    );
    return {
      id: r.id,
      name: r.name,
      role: r.role,
      status: r.status,
      version: r.version,
      phoneMasked: '0' + phone.slice(2, 4) + '••••' + phone.slice(-3),
    };
  }
  private async memberList(q: Sql, org: string, partner: string) {
    return (
      await q.query(
        'SELECT * FROM identity_private.partner_members WHERE organization_id=$1 AND partner_id=$2 ORDER BY created_at LIMIT 200',
        [org, partner],
      )
    ).rows.map((r) => this.memberView(r));
  }
  async members(s: Staff, id: string) {
    return this.db.tx(async (q) => {
      await this.partner(q, s, id);
      return { items: await this.memberList(q, s.organizationId, id) };
    });
  }
  async addMember(s: Staff, id: string, body: unknown) {
    const p = PartnerMemberSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Thông tin nhân viên không hợp lệ');
    return this.db.tx(async (q) => {
      await this.partner(q, s, id);
      const r = await this.invite(q, s.organizationId, id, p.data);
      await event(q, s, 'partner.member-added', r.id);
      return r;
    });
  }
  private async changeMember(
    q: Sql,
    org: string,
    partner: string,
    id: string,
    body: unknown,
    expected: number,
  ) {
    const p = PartnerMemberUpdateSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Vai trò hoặc trạng thái nhân viên không hợp lệ');
    const r = (
      await q.query(
        'SELECT * FROM identity_private.partner_members WHERE id=$1 AND organization_id=$2 AND partner_id=$3 FOR UPDATE',
        [uuid(id), org, partner],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có nhân viên trong đơn vị');
    if (Number(r.version) !== expected) throw new ConflictException('Nhân viên đã thay đổi');
    if (
      r.role === 'partner_admin' &&
      r.status === 'active' &&
      (p.data.role !== 'partner_admin' || p.data.status !== 'active')
    ) {
      const n = (
        await q.query(
          "SELECT count(*)::int AS n FROM identity_private.partner_members WHERE organization_id=$1 AND partner_id=$2 AND role='partner_admin' AND status='active'",
          [org, partner],
        )
      ).rows[0]!.n;
      if (Number(n) <= 1)
        throw new ConflictException('Cần giữ ít nhất một quản lý đơn vị đang hoạt động');
    }
    await q.query(
      'UPDATE identity_private.partner_members SET role=$4,status=$5,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND partner_id=$3',
      [id, org, partner, p.data.role, p.data.status],
    );
    return { id, version: expected + 1 };
  }
  async updateMember(s: Staff, partner: string, id: string, body: unknown, expected: number) {
    return this.db.tx(async (q) => {
      await this.partner(q, s, partner);
      const r = await this.changeMember(q, s.organizationId, partner, id, body, expected);
      await event(q, s, 'partner.member-updated', id);
      return r;
    });
  }
  async workspace(c: Citizen) {
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c);
      const projects = (
        await q.query(
          'SELECT p.id,p.name,p.locality FROM partner_projects pp JOIN projects p ON p.id=pp.project_id AND p.organization_id=pp.organization_id WHERE pp.organization_id=$1 AND pp.partner_id=$2 AND pp.active AND p.archived_at IS NULL',
          [a.organizationId, a.partnerId],
        )
      ).rows;
      const campaigns = await this.campaignList(q, a.organizationId, a.partnerId);
      const counts = (
        await q.query(
          "SELECT count(*) FILTER(WHERE l.status='new')::int AS new,count(*) FILTER(WHERE l.status IN('contacting','waiting'))::int AS processing,count(*) FILTER(WHERE l.status='closed')::int AS closed FROM identity_private.partner_leads l JOIN partner_campaigns c ON c.organization_id=l.organization_id AND c.partner_id=l.partner_id AND c.id=l.campaign_id JOIN partner_projects pp ON pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id JOIN projects p ON p.id=c.project_id AND p.organization_id=c.organization_id WHERE l.organization_id=$1 AND l.partner_id=$2 AND pp.active AND p.archived_at IS NULL AND ($3::uuid IS NULL OR l.assignee_id=$3)",
          [a.organizationId, a.partnerId, a.role === 'consultant' ? a.memberId : null],
        )
      ).rows[0];
      return {
        actor: a,
        projects,
        campaigns,
        counts,
        members:
          a.role === 'consultant' ? [] : await this.memberList(q, a.organizationId, a.partnerId),
      };
    });
  }
  async inviteMember(c: Citizen, body: unknown) {
    const p = PartnerMemberSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Thông tin nhân viên không hợp lệ');
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c, ['partner_admin']);
      const r = await this.invite(q, a.organizationId, a.partnerId, p.data);
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'partner.member-added',
        r.id,
      );
      return r;
    });
  }
  async editMember(c: Citizen, id: string, body: unknown, expected: number) {
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c, ['partner_admin']);
      const r = await this.changeMember(q, a.organizationId, a.partnerId, id, body, expected);
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'partner.member-updated',
        id,
      );
      return r;
    });
  }
  private async campaignList(q: Sql, org: string, partner?: string) {
    return (
      await q.query(
        `SELECT c.*,p.name AS project_name,a.name AS partner_name,(SELECT count(*)::int FROM identity_private.partner_leads l WHERE l.organization_id=c.organization_id AND l.campaign_id=c.id AND l.status<>'withdrawn') AS leads FROM partner_campaigns c JOIN projects p ON p.organization_id=c.organization_id AND p.id=c.project_id JOIN partners a ON a.organization_id=c.organization_id AND a.id=c.partner_id WHERE c.organization_id=$1 ${partner ? 'AND c.partner_id=$2 AND p.archived_at IS NULL AND EXISTS(SELECT 1 FROM partner_projects pp WHERE pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id AND pp.active)' : ''} ORDER BY c.created_at DESC LIMIT 200`,
        partner ? [org, partner] : [org],
      )
    ).rows;
  }
  async campaigns(s: Staff) {
    return this.db.tx((q) => this.campaignList(q, s.organizationId));
  }
  async saveCampaign(c: Citizen, body: unknown, id?: string, expected?: number) {
    const p = CampaignSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Nội dung chiến dịch không hợp lệ');
    const b = p.data;
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c, ['partner_admin', 'campaign_manager']);
      if (
        !(
          await q.query(
            'SELECT pp.project_id FROM partner_projects pp JOIN projects p ON p.id=pp.project_id AND p.organization_id=pp.organization_id WHERE pp.organization_id=$1 AND pp.partner_id=$2 AND pp.project_id=$3 AND pp.active AND p.archived_at IS NULL',
            [a.organizationId, a.partnerId, b.projectId],
          )
        ).rows.length
      )
        throw new ForbiddenException('Dự án chưa được chủ đầu tư giao cho đối tác');
      const ref = id ? uuid(id) : randomUUID();
      if (id) {
        const r = (
          await q.query(
            'SELECT version FROM partner_campaigns WHERE id=$1 AND organization_id=$2 AND partner_id=$3 FOR UPDATE',
            [ref, a.organizationId, a.partnerId],
          )
        ).rows[0];
        if (!r) throw new NotFoundException('Không có chiến dịch');
        if (Number(r.version) !== expected) throw new ConflictException('Chiến dịch đã thay đổi');
        await q.query(
          "UPDATE partner_campaigns SET project_id=$4,name=$5,channel=$6,headline=$7,description=$8,status='draft',review_note='',reviewed_by=NULL,reviewed_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND partner_id=$3",
          [
            ref,
            a.organizationId,
            a.partnerId,
            b.projectId,
            b.name,
            b.channel,
            b.headline,
            b.description,
          ],
        );
      } else
        await q.query(
          'INSERT INTO partner_campaigns(id,organization_id,partner_id,project_id,name,channel,headline,description,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            ref,
            a.organizationId,
            a.partnerId,
            b.projectId,
            b.name,
            b.channel,
            b.headline,
            b.description,
            a.memberId,
          ],
        );
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'campaign.saved',
        ref,
      );
      return { id: ref, version: id ? expected! + 1 : 1 };
    });
  }
  async submitCampaign(c: Citizen, id: string, expected: number) {
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c, ['partner_admin', 'campaign_manager']);
      const r = (
        await q.query(
          "UPDATE partner_campaigns SET status='pending',version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND partner_id=$3 AND version=$4 AND status IN('draft','rejected','paused') RETURNING id",
          [uuid(id), a.organizationId, a.partnerId, expected],
        )
      ).rows[0];
      if (!r) throw new ConflictException('Chiến dịch không còn ở trạng thái gửi duyệt');
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'campaign.submitted',
        id,
      );
      return { id, version: expected + 1 };
    });
  }
  async reviewCampaign(s: Staff, id: string, body: unknown, expected: number) {
    const p = CampaignReviewSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Kết quả duyệt không hợp lệ');
    return this.db.tx(async (q) => {
      const scope = (
        await q.query(
          'SELECT partner_id FROM partner_campaigns WHERE id=$1 AND organization_id=$2',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!scope) throw new NotFoundException('Không có chiến dịch trong tổ chức');
      await this.partner(q, s, String(scope.partner_id));
      const r = (
        await q.query(
          'SELECT c.*,pp.active,p.status AS partner_status FROM partner_campaigns c JOIN partner_projects pp ON pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id JOIN partners p ON p.id=c.partner_id AND p.organization_id=c.organization_id WHERE c.id=$1 AND c.organization_id=$2 FOR UPDATE OF c,p',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có chiến dịch trong tổ chức');
      if (Number(r.version) !== expected) throw new ConflictException('Chiến dịch đã thay đổi');
      if (!r.active || r.partner_status !== 'active')
        throw new ConflictException('Đối tác hoặc phạm vi dự án đang tạm khóa');
      const allowed = p.data.status === 'paused' ? r.status === 'approved' : r.status === 'pending';
      if (!allowed)
        throw new ConflictException('Trạng thái chiến dịch không cho phép quyết định này');
      await q.query(
        'UPDATE partner_campaigns SET status=$3,review_note=$4,reviewed_by=$5,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2',
        [id, s.organizationId, p.data.status, p.data.note, s.subject],
      );
      await event(q, s, 'campaign.' + p.data.status, id);
      return { id, version: expected + 1 };
    });
  }
  private async publicCampaign(q: Sql, id: string) {
    const r = (
      await q.query(
        "SELECT c.id,c.organization_id,c.partner_id,c.headline,c.description,c.channel,p.name AS project_name,p.id AS project_id,a.name AS partner_name FROM partner_campaigns c JOIN partner_projects pp ON pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id JOIN projects p ON p.organization_id=c.organization_id AND p.id=c.project_id JOIN partners a ON a.organization_id=c.organization_id AND a.id=c.partner_id WHERE c.id=$1 AND c.status='approved' AND pp.active AND a.status='active' AND p.archived_at IS NULL AND p.publication_status='published'",
        [uuid(id)],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Chiến dịch chưa được duyệt hoặc đã tạm dừng');
    return r;
  }
  async campaign(id: string) {
    return this.db.tx(async (q) => {
      const r = await this.publicCampaign(q, id);
      const { organization_id: _org, partner_id: _partner, ...publicData } = r;
      void _org;
      void _partner;
      return publicData;
    });
  }
  async consult(c: Citizen, id: string, body: unknown) {
    const p = ConsultationSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Cần tên, nội dung và đồng ý chia sẻ liên hệ với đối tác');
    return this.db.tx(async (q) => {
      const campaign = await this.publicCampaign(q, id);
      if (campaign.organization_id !== c.organizationId)
        throw new NotFoundException('Không có chiến dịch');
      await q.query('SELECT id FROM partners WHERE id=$1 AND organization_id=$2 FOR UPDATE', [
        campaign.partner_id,
        c.organizationId,
      ]);
      await this.publicCampaign(q, id);
      const account = (
        await q.query(
          'SELECT phone_cipher FROM identity_private.phone_accounts WHERE organization_id=$1 AND user_id=$2 FOR UPDATE',
          [c.organizationId, c.userId],
        )
      ).rows[0];
      if (!account) throw new ForbiddenException('Cần xác thực số điện thoại trước');
      if (
        (
          await q.query(
            "SELECT id FROM identity_private.partner_leads WHERE organization_id=$1 AND campaign_id=$2 AND owner_user_id=$3 AND status IN('new','contacting','waiting')",
            [c.organizationId, id, c.userId],
          )
        ).rows.length
      )
        throw new ConflictException('Bạn đã có yêu cầu tư vấn đang xử lý trong chiến dịch');
      const ref = randomUUID(),
        phone = unseal(String(account.phone_cipher), 'phone:' + c.organizationId);
      await q.query(
        'INSERT INTO identity_private.partner_leads(id,organization_id,partner_id,campaign_id,owner_user_id,details_cipher) VALUES($1,$2,$3,$4,$5,$6)',
        [
          ref,
          c.organizationId,
          campaign.partner_id,
          id,
          c.userId,
          seal(
            JSON.stringify({ fullName: p.data.fullName, message: p.data.message, phone, note: '' }),
            'partner-lead:' + c.organizationId + ':' + ref,
          ),
        ],
      );
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,$4,'partner-consultation-v1',now())",
        [randomUUID(), c.organizationId, c.userId, 'partner-consultation:' + ref],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'consultation.shared',
        ref,
      );
      return { id: ref };
    });
  }
  async myConsultations(c: Citizen) {
    return this.db.tx(
      async (q) =>
        (
          await q.query(
            'SELECT l.id,l.status,l.version,l.created_at,a.name AS partner_name,p.name AS project_name,c.name AS campaign_name FROM identity_private.partner_leads l JOIN partners a ON a.id=l.partner_id AND a.organization_id=l.organization_id JOIN partner_campaigns c ON c.id=l.campaign_id AND c.organization_id=l.organization_id JOIN projects p ON p.id=c.project_id AND p.organization_id=c.organization_id WHERE l.organization_id=$1 AND l.owner_user_id=$2 ORDER BY l.created_at DESC LIMIT 100',
            [c.organizationId, c.userId],
          )
        ).rows,
    );
  }
  async withdraw(c: Citizen, id: string, expected: number) {
    return this.db.tx(async (q) => {
      const r = (
        await q.query(
          "UPDATE identity_private.partner_leads SET status='withdrawn',details_cipher=NULL,version=version+1,updated_at=now() WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND version=$4 AND status<>'withdrawn' RETURNING id",
          [uuid(id), c.organizationId, c.userId, expected],
        )
      ).rows[0];
      if (!r) throw new ConflictException('Yêu cầu đã thay đổi hoặc không thuộc tài khoản');
      await q.query(
        'UPDATE consent_records SET withdrawn_at=now() WHERE organization_id=$1 AND user_id=$2 AND purpose=$3 AND withdrawn_at IS NULL',
        [c.organizationId, c.userId, 'partner-consultation:' + id],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'consultation.withdrawn',
        id,
      );
      return { id, status: 'withdrawn' };
    });
  }
  private async lead(q: Sql, a: PartnerActor, id: string) {
    const r = (
      await q.query(
        "SELECT l.* FROM identity_private.partner_leads l JOIN partner_campaigns c ON c.organization_id=l.organization_id AND c.partner_id=l.partner_id AND c.id=l.campaign_id JOIN partner_projects pp ON pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id JOIN projects p ON p.organization_id=c.organization_id AND p.id=c.project_id WHERE l.id=$1 AND l.organization_id=$2 AND l.partner_id=$3 AND l.status<>'withdrawn' AND pp.active AND p.archived_at IS NULL AND ($4::uuid IS NULL OR l.assignee_id=$4) FOR UPDATE OF l",
        [uuid(id), a.organizationId, a.partnerId, a.role === 'consultant' ? a.memberId : null],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có yêu cầu tư vấn trong phạm vi được giao');
    return r;
  }
  async leads(c: Citizen) {
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c);
      const rows = (
        await q.query(
          "SELECT l.*,c.name AS campaign_name,p.name AS project_name FROM identity_private.partner_leads l JOIN partner_campaigns c ON c.organization_id=l.organization_id AND c.partner_id=l.partner_id AND c.id=l.campaign_id JOIN projects p ON p.organization_id=c.organization_id AND p.id=c.project_id JOIN partner_projects pp ON pp.organization_id=c.organization_id AND pp.partner_id=c.partner_id AND pp.project_id=c.project_id WHERE l.organization_id=$1 AND l.partner_id=$2 AND l.status<>'withdrawn' AND pp.active AND p.archived_at IS NULL AND ($3::uuid IS NULL OR l.assignee_id=$3) ORDER BY l.created_at DESC LIMIT 200",
          [a.organizationId, a.partnerId, a.role === 'consultant' ? a.memberId : null],
        )
      ).rows;
      return rows.map((r) => ({
        id: r.id,
        campaign_id: r.campaign_id,
        campaign_name: r.campaign_name,
        project_name: r.project_name,
        status: r.status,
        assignee_id: r.assignee_id,
        version: r.version,
        created_at: r.created_at,
        ...JSON.parse(
          unseal(String(r.details_cipher), 'partner-lead:' + a.organizationId + ':' + r.id),
        ),
      }));
    });
  }
  async assign(c: Citizen, id: string, body: unknown, expected: number) {
    const b = record(body);
    if (Object.keys(b).some((k) => k !== 'memberId'))
      throw new BadRequestException('Thông tin phân công không hợp lệ');
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c, ['partner_admin', 'campaign_manager']),
        l = await this.lead(q, a, id);
      if (Number(l.version) !== expected) throw new ConflictException('Yêu cầu đã thay đổi');
      const target = uuid(b.memberId);
      if (
        !(
          await q.query(
            "SELECT id FROM identity_private.partner_members WHERE id=$1 AND organization_id=$2 AND partner_id=$3 AND status='active'",
            [target, a.organizationId, a.partnerId],
          )
        ).rows.length
      )
        throw new BadRequestException('Chỉ giao cho nhân viên đang hoạt động trong đơn vị');
      await q.query(
        'UPDATE identity_private.partner_leads SET assignee_id=$2,version=version+1,updated_at=now() WHERE id=$1',
        [id, target],
      );
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'consultation.assigned',
        id,
      );
      return { id, version: expected + 1 };
    });
  }
  async updateLead(c: Citizen, id: string, body: unknown, expected: number) {
    const p = LeadUpdateSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Trạng thái tư vấn hoặc ghi chú không hợp lệ');
    return this.db.tx(async (q) => {
      const a = await this.actor(q, c),
        l = await this.lead(q, a, id);
      if (Number(l.version) !== expected || l.status === 'closed')
        throw new ConflictException('Yêu cầu đã thay đổi hoặc đã đóng');
      const details = JSON.parse(
        unseal(String(l.details_cipher), 'partner-lead:' + a.organizationId + ':' + id),
      );
      await q.query(
        'UPDATE identity_private.partner_leads SET status=$2,details_cipher=$3,version=version+1,updated_at=now() WHERE id=$1',
        [
          id,
          p.data.status,
          seal(
            JSON.stringify({ ...details, note: p.data.note }),
            'partner-lead:' + a.organizationId + ':' + id,
          ),
        ],
      );
      await event(
        q,
        { organizationId: a.organizationId, subject: a.userId },
        'consultation.updated',
        id,
      );
      return { id, version: expected + 1 };
    });
  }
}
