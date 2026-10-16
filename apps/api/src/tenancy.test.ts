import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { TenancyService } from './tenancy-service';
import { seal } from './identity-crypto';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001';
const maker: Staff = {
    organizationId: org,
    subject: 'tenancy-maker',
    role: 'org_admin',
    permissions: [],
  },
  reviewer: Staff = { ...maker, subject: 'tenancy-reviewer', permissions: ['form_legal_approver'] },
  poster: Staff = { ...maker, subject: 'finance-poster' };
const citizen = { organizationId: org, userId: owner };
let pg: PGlite,
  db: Database,
  svc: TenancyService,
  application: string,
  unit: string,
  contract: string;
const prior = { ...process.env };
const review = {
  decision: 'approve',
  accepted: true,
  note: 'Đã rà soát chứng cứ giả lập theo quy trình diễn tập.',
};
const due = {
  dueOn: '2027-01-01',
  label: 'Kỳ thuê diễn tập đầu tiên',
  amountVnd: '9007199254740993',
};
let draft: Record<string, unknown>;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'd'.repeat(64);
  process.env.AUTH_HASH_KEY = 'e'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  svc = new TenancyService(db);
  await seedSyntheticPrivacy(db, [citizen]);
  const notice = (
    await db.query(
      "SELECT id FROM privacy_notices WHERE organization_id=$1 AND status='approved' ORDER BY version DESC LIMIT 1",
      [org],
    )
  )[0]!.id;
  const round = randomUUID();
  application = randomUUID();
  unit = randomUUID();
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'SYNTHETIC TENANCY','closed','2025-01-01','2025-02-01')",
    [round, org, project],
  );
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,$10,1,$11,true,$12,$13)",
    [
      application,
      org,
      project,
      round,
      dossier,
      owner,
      'DEMO-TENANCY-' + application,
      'DEMO-' + application.toUpperCase(),
      seal(
        JSON.stringify({ mode: 'rent', synthetic: true }),
        'application:' + org + ':' + application,
      ),
      'a'.repeat(64),
      notice,
      randomUUID(),
      'b'.repeat(64),
    ],
  );
  await db.query('INSERT INTO inventory_boards(organization_id,project_id) VALUES($1,$2)', [
    org,
    project,
  ]);
  await db.query(
    "INSERT INTO inventory_units(id,organization_id,project_id,code,building,floor,position,area_cm2,unit_type,orientation,weight) VALUES($1,$2,$3,'T-101','T',1,1,600000,'2PN','Đông',1000)",
    [unit, org, project],
  );
  const emp = randomUUID();
  const legal = randomUUID();
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,'Pháp chế giả lập','legal','active',ARRAY['form_legal_approver'])",
    [legal, org, reviewer.subject],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, legal, project],
  );
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,'Kế toán giả lập','accounting','active',$4)",
    [emp, org, poster.subject, ['finance_post', 'finance_read']],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, emp, project],
  );
  draft = {
    applicationId: application,
    unitId: unit,
    mode: 'rent',
    title: 'Hợp đồng thuê DIỄN TẬP',
    startsOn: '2027-01-01',
    endsOn: '2027-12-31',
    terms:
      'Điều khoản do dự án nhập để diễn tập, không phải hợp đồng đã ký hay mẫu pháp lý được tự sinh.',
    basis: 'Chứng cứ diễn tập được chủ đầu tư giả lập cung cấp.',
    evidenceHash: 'c'.repeat(64),
    handoverRequiredVnd: due.amountVnd,
    schedule: [due],
    synthetic: true,
    idempotencyKey: randomUUID(),
  };
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('creates idempotently, encrypts terms and denies wrong mode/scope, competing unit', async () => {
  await expect(svc.draft(maker, project, { ...draft, mode: 'buy' })).rejects.toThrow('Hình thức');
  await expect(
    svc.draft({ ...maker, organizationId: randomUUID() }, project, draft),
  ).rejects.toThrow();
  const results = await Promise.all([
    svc.draft(maker, project, draft),
    svc.draft(maker, project, draft),
  ]);
  contract = results[0]!.id;
  expect(results[1]!.id).toBe(contract);
  expect(results[1]!.replayed).toBe(true);
  await expect(
    svc.draft(maker, project, { ...draft, idempotencyKey: randomUUID() }),
  ).rejects.toThrow('Căn');
  const row = (
    await db.query('SELECT payload_cipher FROM identity_private.tenancy_contracts WHERE id=$1', [
      contract,
    ])
  )[0]!;
  expect(String(row.payload_cipher)).not.toContain('Điều khoản');
  await expect(svc.citizenDetail({ ...citizen, userId: randomUUID() }, contract)).rejects.toThrow();
  await expect(
    svc.detail({ ...maker, role: 'staff', projectIds: [] }, project, contract),
  ).rejects.toThrow();
});
it('requires independent legal reviewer, optimistic version and explicit owner acknowledgment', async () => {
  await expect(
    svc.review({ ...maker, permissions: ['form_legal_approver'] }, project, contract, review, 1),
  ).rejects.toThrow('người khác');
  await expect(
    svc.review({ ...reviewer, permissions: [] }, project, contract, review, 1),
  ).rejects.toThrow();
  await db.query(
    "UPDATE identity_private.investor_employees SET permissions='{}' WHERE organization_id=$1 AND subject=$2",
    [org, reviewer.subject],
  );
  await expect(svc.review(reviewer, project, contract, review, 1)).rejects.toThrow(
    'form_legal_approver',
  );
  await db.query(
    "UPDATE identity_private.investor_employees SET permissions=ARRAY['form_legal_approver'] WHERE organization_id=$1 AND subject=$2",
    [org, reviewer.subject],
  );
  await svc.review(reviewer, project, contract, review, 1);
  await expect(svc.confirm(citizen, contract, { accepted: true }, 1)).rejects.toThrow('thay đổi');
  await svc.confirm(citizen, contract, { accepted: true }, 2);
  const v = await svc.citizenDetail(citizen, contract);
  expect(v.status).toBe('acknowledged_demo');
  expect(v.totalVnd).toBe(due.amountVnd);
  expect(v.notice).toContain('DIỄN TẬP');
});
it('reconciles exact VND with separate posting grants, duplicate reference and concurrency protection', async () => {
  const v = await svc.detail(maker, project, contract),
    payment = {
      dueId: v.dues[0]!.id,
      amountVnd: due.amountVnd,
      reference: 'SYNTHETIC-RECEIPT-001',
      evidenceHash: 'f'.repeat(64),
      synthetic: true,
      idempotencyKey: randomUUID(),
    };
  const [one, two] = await Promise.all([
    svc.payment(maker, project, contract, payment, v.version),
    svc.payment(maker, project, contract, payment, v.version),
  ]);
  expect(two.id).toBe(one.id);
  await expect(svc.reviewPayment(maker, project, one.id, review, 1)).rejects.toThrow('quyền');
  await db.query('UPDATE identity_private.investor_employees SET subject=$1 WHERE subject=$2', [
    maker.subject,
    poster.subject,
  ]);
  await expect(svc.reviewPayment(maker, project, one.id, review, 1)).rejects.toThrow('tự đối soát');
  await db.query('UPDATE identity_private.investor_employees SET subject=$1 WHERE subject=$2', [
    poster.subject,
    maker.subject,
  ]);
  await svc.reviewPayment(poster, project, one.id, review, 1);
  const scopedAccountant: Staff = { ...poster, role: 'staff', projectIds: [project] };
  expect((await svc.list(scopedAccountant, project)).items.some((i) => i.id === contract)).toBe(
    true,
  );
  await expect(svc.list({ ...scopedAccountant, projectIds: [] }, project)).rejects.toThrow();
  const after = await svc.detail(maker, project, contract);
  expect(after.dues[0]!.reconciledVnd).toBe(due.amountVnd);
  await expect(
    svc.payment(
      maker,
      project,
      contract,
      { ...payment, idempotencyKey: randomUUID() },
      after.version,
    ),
  ).rejects.toThrow('vượt');
});
it('handover proposal needs citizen confirmation, a different reviewer and current contract', async () => {
  const c = await svc.detail(maker, project, contract);
  const a = await svc.propose(
    maker,
    project,
    contract,
    {
      kind: 'handover',
      reason: 'Biên bản bàn giao diễn tập có chứng cứ nguồn.',
      evidenceHash: 'a'.repeat(64),
      synthetic: true,
      idempotencyKey: randomUUID(),
    },
    c.version,
  );
  await expect(svc.reviewAction(reviewer, project, a.id, review, 1)).rejects.toThrow(
    'khách xác nhận',
  );
  await svc.confirmAction(citizen, a.id, { accepted: true }, 1);
  await expect(svc.reviewAction(maker, project, a.id, review, 2)).rejects.toThrow(
    'người duyệt khác',
  );
  await svc.reviewAction(reviewer, project, a.id, review, 2);
  expect((await svc.citizenDetail(citizen, contract)).status).toBe('handed_over_demo');
});
it('extends only beyond the old term with an explicit incremental schedule and preserves old installments', async () => {
  const c = await svc.detail(maker, project, contract);
  await expect(
    svc.propose(
      maker,
      project,
      contract,
      {
        kind: 'extend',
        reason: 'Gia hạn giả lập cần điều kiện và chứng cứ rõ ràng.',
        evidenceHash: 'b'.repeat(64),
        newEndsOn: '2027-06-30',
        schedule: [{ ...due, dueOn: '2027-04-01' }],
        synthetic: true,
        idempotencyKey: randomUUID(),
      },
      c.version,
    ),
  ).rejects.toThrow('Gia hạn');
  const a = await svc.propose(
    maker,
    project,
    contract,
    {
      kind: 'extend',
      reason: 'Gia hạn giả lập được người phụ trách đề nghị.',
      evidenceHash: 'b'.repeat(64),
      newEndsOn: '2028-01-31',
      schedule: [{ dueOn: '2028-01-01', label: 'Kỳ gia hạn', amountVnd: '7' }],
      synthetic: true,
      idempotencyKey: randomUUID(),
    },
    c.version,
  );
  await svc.confirmAction(citizen, a.id, { accepted: true }, 1);
  await svc.reviewAction(reviewer, project, a.id, review, 2);
  const after = await svc.detail(maker, project, contract);
  expect(after.totalVnd).toBe((BigInt(due.amountVnd) + 7n).toString());
  expect(after.dues).toHaveLength(2);
  expect(after.endsOn).toBe('2028-01-31');
  const payment = await svc.payment(
    maker,
    project,
    contract,
    {
      dueId: after.dues.find((d) => d.amountVnd === '7')!.id,
      amountVnd: '7',
      reference: 'SYNTHETIC-RECEIPT-002',
      evidenceHash: 'f'.repeat(64),
      synthetic: true,
      idempotencyKey: randomUUID(),
    },
    after.version,
  );
  await svc.reviewPayment(poster, project, payment.id, review, 1);
});
it('termination does not release the apartment; confirmed independent return does, with preserved audit/history', async () => {
  for (const kind of ['terminate', 'return']) {
    const c = await svc.detail(maker, project, contract);
    const a = await svc.propose(
      maker,
      project,
      contract,
      {
        kind,
        reason: 'Đối soát đầy đủ và chứng cứ diễn tập để ' + kind,
        evidenceHash: 'a'.repeat(64),
        synthetic: true,
        idempotencyKey: randomUUID(),
      },
      c.version,
    );
    await svc.confirmAction(citizen, a.id, { accepted: true }, 1);
    await svc.reviewAction(reviewer, project, a.id, review, 2);
    if (kind === 'terminate')
      await expect(
        svc.draft(maker, project, { ...draft, idempotencyKey: randomUUID() }),
      ).rejects.toThrow('Căn');
  }
  expect((await svc.detail(maker, project, contract)).status).toBe('released_demo');
  const replacement = await svc.draft(maker, project, { ...draft, idempotencyKey: randomUUID() });
  expect(replacement.id).not.toBe(contract);
  await expect(
    db.query('DELETE FROM identity_private.tenancy_contracts WHERE id=$1', [contract]),
  ).rejects.toThrow('cannot be deleted');
  const audit = await db.query(
    "SELECT id FROM identity_private.operations WHERE action LIKE 'tenancy.%'",
  );
  expect(audit.length).toBeGreaterThan(10);
});

/** Minimal raw synthetic source fixtures, not an alternate public approval endpoint. */
async function additionalSource(mode: 'buy' | 'rent-buy', position: number) {
  const user = randomUUID(),
    d = randomUUID(),
    app = randomUUID(),
    u = randomUUID(),
    round = randomUUID();
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    user,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [d, org, project, user],
  );
  const c = { organizationId: org, userId: user };
  const n = (
    await db.query(
      "SELECT id,content_hash FROM privacy_notices WHERE organization_id=$1 AND status='approved' ORDER BY version DESC LIMIT 1",
      [org],
    )
  )[0]!;
  const { PrivacyService } = await import('./privacy-service');
  await new PrivacyService(db).choose(c, {
    noticeId: n.id,
    contentHash: n.content_hash,
    accepted: true,
  });
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'SYNTHETIC EXTRA','closed','2025-01-01','2025-02-01')",
    [round, org, project],
  );
  const code = 'DEMO-' + app.replaceAll('-', '').slice(0, 20).toUpperCase();
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,$10,1,$11,true,$12,$13)",
    [
      app,
      org,
      project,
      round,
      d,
      user,
      'DEMO-' + app,
      code,
      seal(JSON.stringify({ mode, synthetic: true }), 'application:' + org + ':' + app),
      'a'.repeat(64),
      n.id,
      randomUUID(),
      'b'.repeat(64),
    ],
  );
  await db.query(
    "INSERT INTO inventory_units(id,organization_id,project_id,code,building,floor,position,area_cm2,unit_type,orientation,weight) VALUES($1,$2,$3,$4,'T',1,$5,600000,'2PN','Đông',1000)",
    [u, org, project, 'T-' + position, position],
  );
  return { c, app, u, d, code };
}
it('supports a separately approved rent-buy schedule, and a returned unit never bypasses source mode checks', async () => {
  const f = await additionalSource('rent-buy', 2);
  const input = {
    ...draft,
    applicationId: f.app,
    unitId: f.u,
    mode: 'rent-buy',
    idempotencyKey: randomUUID(),
    schedule: [{ ...due, amountVnd: '100' }],
    handoverRequiredVnd: '0',
  };
  const result = await svc.draft(maker, project, input);
  await svc.review(reviewer, project, result.id, review, 1);
  await svc.confirm(f.c, result.id, { accepted: true }, 2);
  const c = await svc.citizenDetail(f.c, result.id);
  expect(c.mode).toBe('rent-buy');
  expect(c.totalVnd).toBe('100');
  await expect(svc.confirm(citizen, result.id, { accepted: true }, 3)).rejects.toThrow('của bạn');
  const { PrivacyService } = await import('./privacy-service');
  await new PrivacyService(db).withdraw(f.c);
  await expect(
    svc.propose(
      { ...maker, role: 'staff', projectIds: [project] },
      project,
      result.id,
      {
        kind: 'handover',
        reason: 'Không có quyền nhân sự dù phiên còn project.',
        evidenceHash: 'a'.repeat(64),
        idempotencyKey: randomUUID(),
        synthetic: true,
      },
      c.version,
    ),
  ).rejects.toThrow();
  const a = await svc.propose(
    maker,
    project,
    result.id,
    {
      kind: 'handover',
      reason: 'Đề nghị diễn tập sau khách rút đồng ý để kiểm cơ chế.',
      evidenceHash: 'a'.repeat(64),
      idempotencyKey: randomUUID(),
      synthetic: true,
    },
    c.version,
  );
  await expect(svc.confirmAction(f.c, a.id, { accepted: true }, 1)).rejects.toThrow();
  expect((await svc.citizenDetail(f.c, result.id)).id).toBe(result.id);
});
it('purchase requires original allocation and exact quote; the legacy allocation endpoint cannot take a rented unit', async () => {
  const f = await additionalSource('buy', 3),
    plan = randomUUID(),
    queue = randomUUID();
  const input = {
    ...draft,
    applicationId: f.app,
    unitId: f.u,
    mode: 'buy',
    idempotencyKey: randomUUID(),
    schedule: [{ ...due, amountVnd: '100' }],
    handoverRequiredVnd: '100',
  };
  await expect(svc.draft(maker, project, input)).rejects.toThrow('allocation');
  await db.query(
    "INSERT INTO inventory_price_plans(id,organization_id,project_id,board_version,title,config,quotes,snapshot_hash,created_by) VALUES($1,$2,$3,1,'SYNTHETIC PRICE','{}','[]',$4,'FIXTURE')",
    [plan, org, project, 'a'.repeat(64)],
  );
  await db.query(
    "INSERT INTO inventory_sales(organization_id,project_id,mode,config,price_plan_id,created_by) VALUES($1,$2,'disabled','{}',$3,'FIXTURE')",
    [org, project, plan],
  );
  await db.query(
    'INSERT INTO identity_private.inventory_queue(id,organization_id,project_id,user_id,dossier_id,application_id,public_code,rank,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,1,$8)',
    [queue, org, project, f.c.userId, f.d, f.app, f.code, 'FIXTURE'],
  );
  const alloc = randomUUID();
  await expect(
    db.query(
      'INSERT INTO inventory_allocations(id,organization_id,project_id,unit_id,queue_id,idempotency_key,request_hash,price_plan_id,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        alloc,
        org,
        project,
        unit,
        queue,
        randomUUID(),
        'a'.repeat(64),
        plan,
        JSON.stringify({ totalVnd: '100', synthetic: true }),
      ],
    ),
  ).rejects.toThrow('reserved');
  await db.query(
    'INSERT INTO inventory_allocations(id,organization_id,project_id,unit_id,queue_id,idempotency_key,request_hash,price_plan_id,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      alloc,
      org,
      project,
      f.u,
      queue,
      randomUUID(),
      'a'.repeat(64),
      plan,
      JSON.stringify({ totalVnd: '100', synthetic: true }),
    ],
  );
  await expect(
    svc.draft(maker, project, {
      ...input,
      schedule: [{ ...due, amountVnd: '101' }],
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toThrow('nguyên giá');
  const result = await svc.draft(maker, project, input);
  await svc.review(reviewer, project, result.id, review, 1);
  await svc.confirm(f.c, result.id, { accepted: true }, 2);
  expect((await svc.citizenDetail(f.c, result.id)).mode).toBe('buy');
});
