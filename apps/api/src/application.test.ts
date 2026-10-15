import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyDeclaration } from '@noxh/contracts';
import { Database } from './database';
import { DossierService } from './dossier-service';
import { PrivacyService } from './privacy-service';
import { ApplicationService } from './application-service';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001',
  user = '30000000-0000-4000-8000-000000000001';
const c = { organizationId: org, userId: user },
  other = { ...c, userId: '30000000-0000-4000-8000-000000000002' },
  admin: Staff = {
    organizationId: org,
    subject: 'intake',
    role: 'org_admin',
    permissions: ['intake_officer'],
  },
  reviewer: Staff = { ...admin, subject: 'reviewer', permissions: ['reviewer'] },
  approver: Staff = { ...admin, subject: 'approver', permissions: ['approver'] };
let db: Database,
  pg: PGlite,
  svc: ApplicationService,
  privacy: PrivacyService,
  dossiers: DossierService,
  notice: string,
  round: string,
  document: string,
  application: string;
let inputVersion = 2;
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'f'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  privacy = new PrivacyService(db);
  dossiers = new DossierService(db);
  svc = new ApplicationService(db, dossiers, privacy);
  const employee = randomUUID();
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status) VALUES($1,$2,$3,'SYNTHETIC REVIEWER','legal','active')",
    [employee, org, reviewer.subject],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, employee, project],
  );
  notice = randomUUID();
  round = randomUUID();
  document = randomUUID();
  await db.query(
    "INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by,status,approved_by,approved_at) VALUES($1,$2,1,'{}',$3,'SYNTHETIC AUTHOR','approved','SYNTHETIC REVIEWER',now())",
    [notice, org, 'a'.repeat(64)],
  );
  await privacy.choose(c, { noticeId: notice, contentHash: 'a'.repeat(64), accepted: true });
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'DIỄN TẬP','open',now()-interval '1 day',now()+interval '1 day')",
    [round, org, project],
  );
  await db.query(
    "INSERT INTO documents(id,organization_id,project_id,dossier_id,owner_user_id,type,object_key,sha256,mime,scan_status,bytes) VALUES($1,$2,$3,$4,$5,'identity',$6,$7,'application/pdf','quarantined',100)",
    [document, org, project, dossier, user, 'synthetic-fixture/' + document, 'b'.repeat(64)],
  );
  await dossiers.save(
    c,
    dossier,
    {
      ...emptyDeclaration,
      fullName: 'KHÁCH GIẢ LẬP',
      dateOfBirth: '1995-01-01',
      address: 'ĐỊA CHỈ GIẢ LẬP',
      housingSituation: 'renting',
      confirmed: true,
    },
    1,
  );
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
const body = () => ({
  roundId: round,
  inputVersion,
  documentIds: [document],
  generatedFormIds: [],
  mode: 'buy',
  subjectGroup: 5,
  accepted: true,
  noConcurrentHouseholdApplication: true,
  noticeId: notice,
});
it('blocks unscanned evidence, another owner and missing privacy consent without an eligibility score threshold', async () => {
  await expect(svc.submit(c, dossier, body(), randomUUID())).rejects.toMatchObject({ status: 400 });
  await db.query("UPDATE documents SET scan_status='clean' WHERE id=$1", [document]);
  await expect(svc.submit(other, dossier, body(), randomUUID())).rejects.toMatchObject({
    status: 428,
  });
  await expect(svc.detail(other, randomUUID())).rejects.toMatchObject({ status: 404 });
});
it('rejects confirmed templates for the wrong transaction mode or subject group', async () => {
  for (const [mode, group] of [
    ['rent', 5],
    ['buy', 4],
  ] as const) {
    const release = randomUUID(),
      mapping = randomUUID(),
      form = randomUUID();
    await db.query(
      "INSERT INTO project_form_releases(id,organization_id,project_id,form_id,title,source_hash,catalog_version,recipient,instructions,mode,subject_group,created_by,version,effective_from,status,approved_by,approved_at) VALUES($1,$2,$3,$4,'SYNTHETIC TEMPLATE',$5,'test-v1','SYNTHETIC RECIPIENT','SYNTHETIC GUIDANCE',$6,$7,'TEST AUTHOR',1,CURRENT_DATE,'approved','TEST REVIEWER',now())",
      [release, org, project, release, 'a'.repeat(64), mode, group],
    );
    await db.query(
      "INSERT INTO form_field_mappings(id,organization_id,project_id,release_id,form_id,source_hash,payload,content_hash,version,created_by,status,approved_by,approved_at,effective_from) VALUES($1,$2,$3,$4,$5,$6,'{}',$6,1,'TEST AUTHOR','approved','TEST REVIEWER',now(),CURRENT_DATE)",
      [mapping, org, project, release, release, 'a'.repeat(64)],
    );
    await db.query(
      "INSERT INTO generated_forms(id,organization_id,project_id,dossier_id,owner_user_id,mapping_id,input_version,inputs_cipher,input_hash,object_key,envelope_key_cipher,sha256,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,'synthetic-only',$8,$9,'synthetic-only',$8,'confirmed',now())",
      [
        form,
        org,
        project,
        dossier,
        user,
        mapping,
        inputVersion,
        'b'.repeat(64),
        'synthetic-test/' + form,
      ],
    );
    await expect(
      svc.submit(c, dossier, { ...body(), generatedFormIds: [form] }, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect((await svc.mine(c)).items).toHaveLength(0);
});
it('serializes idempotent submission, fixes the public code and preserves the encrypted immutable snapshot', async () => {
  const key = randomUUID(),
    a = await Promise.all([
      svc.submit(c, dossier, body(), key),
      svc.submit(c, dossier, body(), key),
    ]);
  expect(a[0]!.id).toBe(a[1]!.id);
  application = String(a[0]!.id);
  expect(String(a[0]!.public_code)).toMatch(/^DEMO-[A-F0-9]{24}$/);
  expect(String(a[0]!.receipt_code)).toMatch(/^NOXH-DEMO-/);
  await expect(svc.submit(c, dossier, { ...body(), subjectGroup: 6 }, key)).rejects.toMatchObject({
    status: 409,
  });
  await expect(svc.submit(c, dossier, body(), randomUUID())).rejects.toMatchObject({ status: 409 });
  expect(
    (await db.query('SELECT snapshot_cipher FROM applications WHERE id=$1', [application]))[0]!
      .snapshot_cipher,
  ).not.toContain('KHÁCH');
  await expect(
    db.query('UPDATE applications SET snapshot_hash=$2 WHERE id=$1', [application, '0'.repeat(64)]),
  ).rejects.toThrow('immutable');
  await expect(
    db.query('DELETE FROM application_documents WHERE application_id=$1', [application]),
  ).rejects.toThrow();
  await dossiers.save(
    c,
    dossier,
    {
      ...(await dossiers.detail(c, dossier)).declaration,
      fullName: 'TÊN BẢN CHUẨN BỊ ĐÃ THAY ĐỔI',
      confirmed: false,
    },
    inputVersion,
  );
  inputVersion++;
  expect((await svc.detail(c, application)).snapshot.declaration.fullName).toBe('KHÁCH GIẢ LẬP');
});
it('enforces staff scope, assignment, separate recommendation/approval and legal decision reasons', async () => {
  await expect(svc.list({ ...admin, permissions: [] })).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.staffDetail({ ...reviewer, role: 'staff', projectIds: [] }, application),
  ).rejects.toMatchObject({ status: 404 });
  await svc.assign(admin, application, { reviewerSubject: reviewer.subject }, 1);
  await expect(
    svc.recommend(
      { ...reviewer, subject: 'not-assigned' },
      application,
      {
        eligible: true,
        reasonCode: 'TEST',
        reason: 'LÝ DO GIẢ LẬP ĐÃ KIỂM TRA',
        evidenceRefs: ['Chứng cứ giả lập'],
        accepted: true,
      },
      2,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const proposal = await svc.recommend(
    reviewer,
    application,
    {
      eligible: true,
      reasonCode: 'TEST_APPROVED',
      reason: 'XÁC NHẬN GIẢ LẬP QUA KIỂM THỬ',
      evidenceRefs: ['SYNTHETIC REVIEW EVIDENCE'],
      accepted: true,
    },
    2,
  );
  await expect(
    svc.decide(
      { ...reviewer, permissions: ['approver'] },
      application,
      {
        recommendationId: proposal.id,
        accepted: true,
        decisionReference: 'QUYẾT ĐỊNH GIẢ LẬP',
        publicReason: 'KẾT QUẢ DIỄN TẬP KHÔNG CÓ GIÁ TRỊ PHÁP LÝ',
      },
      3,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await db.query("UPDATE documents SET scan_status='rejected' WHERE id=$1", [document]);
  await expect(
    svc.decide(
      approver,
      application,
      {
        recommendationId: proposal.id,
        accepted: true,
        decisionReference: 'QUYẾT ĐỊNH GIẢ LẬP',
        publicReason: 'KẾT QUẢ DIỄN TẬP KHÔNG CÓ GIÁ TRỊ PHÁP LÝ',
      },
      3,
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect((await svc.detail(c, application)).status).toBe('recommended');
  await db.query("UPDATE documents SET scan_status='clean' WHERE id=$1", [document]);
  await svc.decide(
    approver,
    application,
    {
      recommendationId: proposal.id,
      accepted: true,
      decisionReference: 'QUYẾT ĐỊNH GIẢ LẬP',
      publicReason: 'KẾT QUẢ DIỄN TẬP KHÔNG CÓ GIÁ TRỊ PHÁP LÝ',
    },
    3,
  );
  const d = await svc.detail(c, application);
  expect(d.status).toBe('approved');
  expect(d.reviews).toHaveLength(0);
  expect(d.decision_reason).toContain('DIỄN TẬP');
  await expect(svc.withdraw(c, application, 4)).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.authorizeDocument({ ...reviewer, subject: 'other' }, application, document),
  ).rejects.toMatchObject({ status: 404 });
  await svc.authorizeDocument(reviewer, application, document);
});
it('permits reconsideration after consent withdrawal while preventing the original decision maker reviewing itself', async () => {
  await privacy.withdraw(c);
  const a = await svc.appeal(c, application, {
    accepted: true,
    message: 'ĐỀ NGHỊ GIẢ LẬP XEM XÉT LẠI, KHÔNG PHẢI THỦ TỤC KHIẾU NẠI CƠ QUAN NHÀ NƯỚC',
  });
  await expect(
    svc.appeal(c, application, { accepted: true, message: 'YÊU CẦU TRÙNG GIẢ LẬP' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.respondAppeal(
      approver,
      application,
      a.id,
      { reply: 'Phản hồi giả lập cần người độc lập' },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.respondAppeal(
    { ...approver, subject: 'independent-reconsideration' },
    application,
    a.id,
    { reply: 'PHẢN HỒI GIẢ LẬP ĐÃ GHI NHẬN, KHÔNG THAY ĐỔI QUYẾT ĐỊNH' },
    1,
  );
  expect((await svc.detail(c, application)).appeals[0]?.status).toBe('responded');
});
