import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Database } from './database';
import { PartnerService } from './partner-service';
import { DossierService } from './dossier-service';
import { digest, normalizePhone, seal } from './identity-crypto';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001';
const citizen = { organizationId: org, userId: '30000000-0000-4000-8000-000000000001' };
const actor = (n: number) => ({
  organizationId: org,
  userId: '30000000-0000-4000-8000-0000000000' + n,
});
const admin = actor(50),
  manager = actor(51),
  consultant = actor(52),
  otherConsultant = actor(53),
  otherAdmin = actor(54);
const staff: Staff = { organizationId: org, subject: 'synthetic-investor', role: 'org_admin' };
const prior = { ...process.env };
let pg: PGlite,
  db: Database,
  service: PartnerService,
  partner = '',
  secondPartner = '',
  campaign = '',
  lead = '',
  consultantId = '';
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  service = new PartnerService(db);
  for (const [u, phone] of [
    [citizen, '0900000000'],
    [admin, '0900000050'],
    [manager, '0900000051'],
    [consultant, '0900000052'],
    [otherConsultant, '0900000053'],
    [otherAdmin, '0900000054'],
  ] as const) {
    await db.query(
      "INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active') ON CONFLICT DO NOTHING",
      [u.userId, org],
    );
    const normalized = normalizePhone(phone);
    await db.query(
      'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
      [org, u.userId, digest('phone', org + ':' + normalized), seal(normalized, 'phone:' + org)],
    );
  }
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('requires investor-created partner scope; phone login alone does not grant partner rights', async () => {
  await expect(service.workspace(citizen)).rejects.toMatchObject({ status: 403 });
  await expect(
    service.create(staff, {
      name: 'ĐỐI TÁC GIẢ LẬP',
      ownerName: 'QUẢN LÝ GIẢ LẬP',
      ownerPhone: '0900000050',
      projectIds: ['20000000-0000-4000-8000-000000000099'],
    }),
  ).rejects.toMatchObject({ status: 400 });
  partner = (
    await service.create(staff, {
      name: 'ĐỐI TÁC GIẢ LẬP A',
      ownerName: 'QUẢN LÝ GIẢ LẬP A',
      ownerPhone: '0900000050',
      projectIds: [project],
    })
  ).id;
  secondPartner = (
    await service.create(staff, {
      name: 'ĐỐI TÁC GIẢ LẬP B',
      ownerName: 'QUẢN LÝ GIẢ LẬP B',
      ownerPhone: '0900000054',
      projectIds: [project],
    })
  ).id;
  expect((await service.workspace(admin)).actor.role).toBe('partner_admin');
  expect(JSON.stringify(await service.list(staff))).not.toContain('0900000050');
});
it('allows partner admin to provision phone-bound roles; denies staff privilege escalation', async () => {
  await service.inviteMember(admin, {
    name: 'QUẢN LÝ CHIẾN DỊCH GIẢ LẬP',
    phone: '0900000051',
    role: 'campaign_manager',
  });
  consultantId = (
    await service.inviteMember(admin, {
      name: 'CHUYÊN VIÊN GIẢ LẬP',
      phone: '0900000052',
      role: 'consultant',
    })
  ).id;
  await service.inviteMember(admin, {
    name: 'CHUYÊN VIÊN KHÁC GIẢ LẬP',
    phone: '0900000053',
    role: 'consultant',
  });
  expect((await service.workspace(consultant)).actor.role).toBe('consultant');
  expect((await service.workspace(consultant)).members).toHaveLength(0);
  await expect(
    service.inviteMember(manager, { name: 'TỰ CẤP', phone: '0900000055', role: 'partner_admin' }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.editMember(consultant, consultantId, { role: 'partner_admin', status: 'active' }, 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.inviteMember(otherAdmin, {
      name: 'CHIẾM TÀI KHOẢN',
      phone: '0900000052',
      role: 'partner_admin',
    }),
  ).rejects.toMatchObject({ status: 409 });
  const [raw] = await db.query(
    'SELECT phone_cipher FROM identity_private.partner_members WHERE id=$1',
    [consultantId],
  );
  expect(raw?.phone_cipher).not.toContain('0900000052');
});
const campaignBody = {
  projectId: project,
  name: 'CHIẾN DỊCH GIẢ LẬP',
  channel: 'web',
  headline: 'TƯ VẤN GIẢ LẬP',
  description: 'NỘI DUNG TRUYỀN THÔNG GIẢ LẬP',
};
it('restricts campaign editing to manager roles and assigned projects; public link remains off until investor approval', async () => {
  await expect(service.saveCampaign(consultant, campaignBody)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    service.saveCampaign(manager, {
      ...campaignBody,
      projectId: '20000000-0000-4000-8000-000000000002',
    }),
  ).rejects.toMatchObject({ status: 403 });
  campaign = (await service.saveCampaign(manager, campaignBody)).id;
  await expect(service.campaign(campaign)).rejects.toMatchObject({ status: 404 });
  await expect(service.saveCampaign(otherAdmin, campaignBody, campaign, 1)).rejects.toMatchObject({
    status: 404,
  });
  await service.submitCampaign(manager, campaign, 1);
  await expect(
    service.reviewCampaign(
      { ...staff, organizationId: '10000000-0000-4000-8000-000000000002' },
      campaign,
      { status: 'approved', note: '' },
      2,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await service.reviewCampaign(staff, campaign, { status: 'approved', note: 'DUYỆT GIẢ LẬP' }, 2);
  expect((await service.campaign(campaign)).headline).toBe(campaignBody.headline);
  expect(JSON.stringify(await service.campaign(campaign))).not.toContain('phone');
});
it('records explicit consultation consent and encrypted verified contact; never shares private dossiers', async () => {
  await expect(
    service.consult(citizen, campaign, {
      fullName: 'KHÁCH GIẢ LẬP',
      message: 'CÂU HỎI GIẢ LẬP',
      accepted: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  lead = (
    await service.consult(citizen, campaign, {
      fullName: 'KHÁCH GIẢ LẬP',
      message: 'CÂU HỎI GIẢ LẬP',
      accepted: true,
    })
  ).id;
  await expect(
    service.consult(citizen, campaign, {
      fullName: 'KHÁCH GIẢ LẬP',
      message: 'LẶP',
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 409 });
  const [raw] = await db.query('SELECT * FROM identity_private.partner_leads WHERE id=$1', [lead]);
  expect(raw?.details_cipher).not.toContain('KHÁCH GIẢ LẬP');
  expect((await service.leads(admin))[0]?.phone).toBe('84900000000');
  expect((await service.myConsultations(citizen))[0]?.campaign_name).toBe(campaignBody.name);
  expect(await service.leads(consultant)).toHaveLength(0);
  expect(await service.leads(otherAdmin)).toHaveLength(0);
  await expect(
    new DossierService(db).detail(admin, '40000000-0000-4000-8000-000000000001'),
  ).rejects.toMatchObject({ status: 404 });
  expect(JSON.stringify(await service.list(staff))).not.toContain('KHÁCH GIẢ LẬP');
});
it('consultants can only see assigned leads; managers cannot assign across agencies', async () => {
  await expect(
    service.assign(consultant, lead, { memberId: consultantId }, 1),
  ).rejects.toMatchObject({ status: 403 });
  const otherMember = (await service.workspace(otherAdmin)).actor.memberId;
  await expect(service.assign(manager, lead, { memberId: otherMember }, 1)).rejects.toMatchObject({
    status: 400,
  });
  await service.assign(manager, lead, { memberId: consultantId }, 1);
  expect(await service.leads(consultant)).toHaveLength(1);
  expect(await service.leads(otherConsultant)).toHaveLength(0);
  await expect(
    service.updateLead(otherConsultant, lead, { status: 'contacting', note: 'LẤY QUYỀN' }, 2),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.updateLead(consultant, lead, { status: 'approved', note: 'KHÔNG ĐƯỢC XÉT DUYỆT' }, 2),
  ).rejects.toMatchObject({ status: 400 });
  await service.updateLead(
    consultant,
    lead,
    { status: 'contacting', note: 'GHI CHÚ TƯ VẤN GIẢ LẬP' },
    2,
  );
  await expect(service.assign(manager, lead, { memberId: consultantId }, 2)).rejects.toMatchObject({
    status: 409,
  });
});
it('immediately revokes member access and preserves the last active agency administrator', async () => {
  await service.editMember(admin, consultantId, { role: 'consultant', status: 'suspended' }, 1);
  await expect(service.leads(consultant)).rejects.toMatchObject({ status: 403 });
  await service.editMember(admin, consultantId, { role: 'consultant', status: 'active' }, 2);
  const adminMember = (await service.workspace(admin)).actor.memberId;
  await expect(
    service.editMember(admin, adminMember, { role: 'consultant', status: 'active' }, 1),
  ).rejects.toMatchObject({ status: 409 });
});
it('removes contacts after citizen withdrawal and records consent withdrawal atomically', async () => {
  await expect(service.withdraw(otherConsultant, lead, 3)).rejects.toMatchObject({ status: 409 });
  await service.withdraw(citizen, lead, 3);
  expect(await service.leads(consultant)).toHaveLength(0);
  await expect(
    service.updateLead(consultant, lead, { status: 'closed', note: 'LẶP' }, 4),
  ).rejects.toMatchObject({ status: 404 });
  const [r] = await db.query(
    'SELECT details_cipher,status FROM identity_private.partner_leads WHERE id=$1',
    [lead],
  );
  expect(r?.details_cipher).toBeNull();
  expect(r?.status).toBe('withdrawn');
  const [consent] = await db.query('SELECT withdrawn_at FROM consent_records WHERE purpose=$1', [
    'partner-consultation:' + lead,
  ]);
  expect(consent?.withdrawn_at).not.toBeNull();
});
it('revoking a project blocks old campaign links and guessed lead writes, not only UI lists', async () => {
  const fresh = (
    await service.consult(citizen, campaign, {
      fullName: 'GIẢ LẬP',
      message: 'YÊU CẦU MỚI',
      accepted: true,
    })
  ).id;
  await service.assign(manager, fresh, { memberId: consultantId }, 1);
  await service.update(
    staff,
    partner,
    { name: 'ĐỐI TÁC GIẢ LẬP A', status: 'active', projectIds: [] },
    1,
  );
  expect(await service.leads(consultant)).toHaveLength(0);
  await expect(service.campaign(campaign)).rejects.toMatchObject({ status: 404 });
  await expect(
    service.updateLead(consultant, fresh, { status: 'contacting', note: '' }, 2),
  ).rejects.toMatchObject({ status: 404 });
  await service.update(
    staff,
    partner,
    { name: 'ĐỐI TÁC GIẢ LẬP A', status: 'suspended', projectIds: [project] },
    2,
  );
  await expect(service.workspace(admin)).rejects.toMatchObject({ status: 403 });
  expect(secondPartner).toBeTruthy();
});
