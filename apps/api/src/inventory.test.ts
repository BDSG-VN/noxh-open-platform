import 'reflect-metadata';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  calculateInventoryPrices,
  type InventoryUnit,
  type LotteryConfig,
  type LotteryResult,
} from '@noxh/contracts';
import { Database } from './database';
import { InventoryService } from './inventory-service';
import { LotteryService } from './lottery-service';
import { draw } from './lottery-engine';
import type { Staff } from './workforce';
import { seal } from './identity-crypto';
import { seedSyntheticPrivacy } from './test-privacy';
import { PrivacyService } from './privacy-service';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  project2 = '20000000-0000-4000-8000-000000000002';
const admin: Staff = {
    organizationId: org,
    subject: 'inventory-author',
    role: 'org_admin',
    permissions: [],
  },
  reviewer: Staff = { ...admin, subject: 'independent-price', permissions: ['price_approver'] };
const citizen = { organizationId: org, userId: '30000000-0000-4000-8000-000000000001' },
  citizen2 = { organizationId: org, userId: '30000000-0000-4000-8000-000000000002' },
  dossier = '40000000-0000-4000-8000-000000000001',
  dossier2 = '40000000-0000-4000-8000-000000000002';
const units: InventoryUnit[] = [
  {
    code: 'A-101',
    building: 'A',
    floor: 1,
    position: 1,
    areaCm2: 600000,
    type: '2 PN',
    orientation: 'Đông Nam',
    weight: 1000,
  },
  {
    code: 'A-102',
    building: 'A',
    floor: 1,
    position: 2,
    areaCm2: 650000,
    type: '2 PN',
    orientation: 'Tây Bắc',
    weight: 1100,
  },
];
const price = {
  title: 'GIÁ DIỄN TẬP ĐỂ KIỂM THỬ',
  baseVndPerM2: '20000000',
  basis: 'Giá giả lập theo hồ sơ dự án diễn tập; không có giá trị giao dịch.',
  evidenceHash: 'a'.repeat(64),
  effectiveFrom: '2025-01-01T00:00:00.000Z',
  rounding: 'half-up-vnd',
  taxIncluded: true,
  maintenanceExcluded: true,
  synthetic: true,
};
let pg: PGlite, db: Database, svc: InventoryService, lottery: LotteryService;
const notice = randomUUID();
const rounds = new Map<string, string>();
let application: string, application2: string;
const fixtures: { code: string; userId: string; dossier: string; application: string }[] = [];
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'd'.repeat(64);
  process.env.AUTH_ORGANIZATION_ID = org;
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  svc = new InventoryService(db);
  svc.kernel = async (_kind, input) => calculateInventoryPrices(input.units, input.baseVndPerM2);
  lottery = new LotteryService(db);
  lottery.kernel = async (_kind, input) =>
    draw(input.config, input.id, input.secret, input.entropy);
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    citizen2.userId,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [dossier2, org, project, citizen2.userId],
  );
  await db.query(
    "INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by) VALUES($1,$2,1,'{}',$3,'SYNTHETIC FIXTURE')",
    [notice, org, 'a'.repeat(64)],
  );
  application = await approvedFixture(project, dossier, citizen.userId, 'DEMO-0001');
  application2 = await approvedFixture(project, dossier2, citizen2.userId, 'DEMO-0002');
  fixtures.push(
    { code: 'DEMO-0001', userId: citizen.userId, dossier, application },
    { code: 'DEMO-0002', userId: citizen2.userId, dossier: dossier2, application: application2 },
  );
  const third = randomUUID(),
    thirdDossier = randomUUID();
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    third,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [thirdDossier, org, project, third],
  );
  fixtures.push({
    code: 'DEMO-0003',
    userId: third,
    dossier: thirdDossier,
    application: await approvedFixture(project, thirdDossier, third, 'DEMO-0003'),
  });
  await seedSyntheticPrivacy(
    db,
    fixtures.map((f) => ({ organizationId: org, userId: f.userId })),
  );
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
/** Deliberate database fixtures, not a substitute for API review/approval tests in application.test.ts. */
async function approvedFixture(
  projectId: string,
  dossierId: string,
  userId: string,
  publicCode: string,
  mode = 'buy',
) {
  const id = randomUUID(),
    round = rounds.get(projectId) ?? randomUUID();
  if (!rounds.has(projectId)) {
    await db.query(
      "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'SYNTHETIC FIXTURE','closed','2025-01-01','2025-02-01')",
      [round, org, projectId],
    );
    rounds.set(projectId, round);
  }
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$13,'approved',$8,$9,1,$10,true,$11,$12)",
    [
      id,
      org,
      projectId,
      round,
      dossierId,
      userId,
      'NOXH-DEMO-FIXTURE-' + id,
      seal(JSON.stringify({ mode, synthetic: true }), 'application:' + org + ':' + id),
      'a'.repeat(64),
      notice,
      randomUUID(),
      'b'.repeat(64),
      publicCode,
    ],
  );
  return id;
}
it('normalizes exact area weighted coefficients per building and rounds monetary BigInts deterministically', () => {
  const qs = calculateInventoryPrices(
    [...units, { ...units[0]!, code: 'B-101', building: 'B', weight: 999 }],
    price.baseVndPerM2,
  );
  const a = qs.filter((q) => q.building === 'A'),
    den = BigInt(a[0]!.coefficientDenominator);
  expect(a.reduce((s, q) => s + BigInt(q.areaCm2) * BigInt(q.coefficientNumerator), 0n)).toBe(
    1250000n * den,
  );
  expect(qs[2]!.coefficientNumerator).toBe(qs[2]!.coefficientDenominator);
  expect(qs[2]!.totalVnd).toBe('1200000000');
  const huge = calculateInventoryPrices([{ ...units[0]!, areaCm2: 99999999 }], '99999999999');
  expect(huge[0]!.totalVnd).toBe(String((99999999999n * 99999999n + 5000n) / 10000n));
  const concentrated = calculateInventoryPrices(
    Array.from({ length: 500 }, (_, i) => ({
      ...units[0]!,
      code: 'A-' + String(i + 1).padStart(3, '0'),
      position: i + 1,
      areaCm2: 99999999,
      weight: i === 0 ? 1000000 : 1,
    })),
    '99999999999',
  );
  expect(BigInt(concentrated[0]!.totalVnd)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
  expect(() => calculateInventoryPrices(units, '1e9')).toThrow();
});
it('enforces independent price review, organization isolation, stale edits and immutable quote evidence', async () => {
  await expect(
    svc.import({ ...admin, role: 'project_manager' }, project, { units, synthetic: true }, 0),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.import({ ...admin, organizationId: randomUUID() }, project, { units, synthetic: true }, 0),
  ).rejects.toMatchObject({ status: 404 });
  await svc.import(admin, project, { units, synthetic: true }, 0);
  await expect(svc.import(admin, project, { units, synthetic: true }, 0)).rejects.toMatchObject({
    status: 409,
  });
  const referenceKernel = svc.kernel;
  const normal = calculateInventoryPrices(units, price.baseVndPerM2);
  for (const malformed of [
    normal.slice(1),
    [...normal, normal[0]],
    [...normal].reverse(),
    [{ ...normal[0], extra: true }, normal[1]],
    [{ ...normal[0], totalVnd: Number(normal[0]!.totalVnd) }, normal[1]],
    [{ ...normal[0], coefficientNumerator: '1' }, normal[1]],
    [{ ...normal[0], totalVnd: '01' }, normal[1]],
    [{ ...normal[0], totalVnd: '0' }, normal[1]],
  ]) {
    svc.kernel = async () => malformed;
    await expect(svc.createPrice(admin, project, price, 1)).rejects.toMatchObject({ status: 503 });
  }
  svc.kernel = async () => {
    throw new Error('Rust deliberately unavailable');
  };
  await expect(svc.createPrice(admin, project, price, 1)).rejects.toThrow(
    'Rust deliberately unavailable',
  );
  expect(
    await db.query('SELECT id FROM inventory_price_plans WHERE project_id=$1', [project]),
  ).toHaveLength(0);
  svc.kernel = vi.fn(referenceKernel);
  const p = await svc.createPrice(admin, project, price, 1);
  expect(svc.kernel).toHaveBeenCalledWith('pricing', { units, baseVndPerM2: price.baseVndPerM2 });
  await expect(
    svc.reviewPrice(
      admin,
      project,
      p.id,
      { accepted: true, decision: 'approved', note: 'Kiểm tra' },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.reviewPrice(
      { ...admin, permissions: ['price_approver'] },
      project,
      p.id,
      { accepted: true, decision: 'approved', note: 'Tự duyệt' },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  const scopedReviewer: Staff = { ...reviewer, role: 'staff', projectIds: [project] };
  await expect(svc.admin(scopedReviewer, project2)).rejects.toMatchObject({ status: 404 });
  await expect(svc.createPrice(scopedReviewer, project, price, 1)).rejects.toMatchObject({
    status: 403,
  });
  await svc.reviewPrice(
    scopedReviewer,
    project,
    p.id,
    { accepted: true, decision: 'approved', note: 'Đã kiểm tra dữ liệu giả lập độc lập' },
    1,
  );
  await expect(
    db.query("UPDATE inventory_price_plans SET quotes='[]' WHERE id=$1", [p.id]),
  ).rejects.toThrow('immutable');
  await expect(svc.import(admin, project, { units, synthetic: true }, 1)).rejects.toMatchObject({
    status: 409,
  });
});
async function publish(
  projectId: string,
  kind: 'selection' | 'allocation',
  entries = kind === 'selection'
    ? ['DEMO-0001', 'DEMO-0002', 'DEMO-0003']
    : ['DEMO-RAND1', 'DEMO-RAND2'],
) {
  const operator = { ...admin, permissions: ['lottery_operator'] },
    supervisor = { ...reviewer, permissions: ['lottery_supervisor'] };
  const cohort = await lottery.draftCohort(operator, {
    roundId: rounds.get(projectId),
    mode: 'buy',
    kind,
    seats: 2,
    description: 'Toàn bộ hồ sơ giả lập đã phê duyệt trong đợt kiểm thử này.',
    legalBasis: 'Quy chế diễn tập được người độc lập kiểm tra, không giao dịch thật.',
    exclusions: [],
    supersedesId: null,
    replacementReason: '',
  });
  await lottery.reviewCohort(supervisor, cohort.id, { accepted: true });
  const config: LotteryConfig = {
    projectId,
    cohortId: cohort.id,
    title: 'PHIÊN DIỄN TẬP PHÂN CĂN',
    kind,
    seats: 2,
    entries,
    units: kind === 'allocation' ? ['A-101', 'A-102'] : [],
    rules: 'Quy chế chỉ dùng cho dữ liệu giả lập, có giám sát riêng.',
    legalBasis: 'Điều 38 VBHN24 BXD — diễn tập',
    priorityResolution: 'Danh sách giả lập đã xử lý ưu tiên trong kiểm thử.',
    eligibilityEvidenceHash: 'a'.repeat(64),
    scheduledAt: '2099-01-01T00:00:00.000Z',
    entropySource: 'Nguồn ngẫu nhiên giả lập trong kiểm thử có giám sát.',
    synthetic: true,
  };
  config.eligibilityEvidenceHash = String(
    (await lottery.eligibilityEvidence(operator, { cohortId: cohort.id })).hash,
  );
  const r = await lottery.create(operator, config);
  await lottery.transition(supervisor, r.id, 'review', { accepted: true }, 1);
  await lottery.transition(operator, r.id, 'freeze', { accepted: true }, 2);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:01.000Z'));
  try {
    await lottery.transition(
      supervisor,
      r.id,
      'entropy',
      { accepted: true, entropy: '2'.repeat(64), record: 'NGUỒN DIỄN TẬP ĐÃ GHI NHẬN' },
      3,
    );
  } finally {
    clock.mockRestore();
  }
  await lottery.transition(operator, r.id, 'execute', { accepted: true }, 4);
  await lottery.transition(
    supervisor,
    r.id,
    'certify',
    { accepted: true, minutesHash: 'b'.repeat(64) },
    5,
  );
  await lottery.transition(operator, r.id, 'publish', { accepted: true }, 6);
  return { id: r.id, result: (await lottery.publicOne(r.id)).result as unknown as LotteryResult };
}
it('links private owner mapping to published ranks, denies out of turn and prevents double allocation under racing retries', async () => {
  const published = await publish(project, 'selection'),
    board = await svc.admin(admin, project),
    p = board.plans[0]!;
  const config = {
    mode: 'queue-choice',
    lotteryId: published.id,
    rules: 'Phân căn diễn tập theo đúng thứ tự đã công bố, không thu phí.',
    basis: 'Căn cứ quy chế diễn tập được kiểm tra độc lập.',
    rulesHash: 'c'.repeat(64),
    synthetic: true,
    pricePlanId: p.id,
  };
  await svc.configureSales(admin, project, config, 0);
  await expect(
    svc.salesAction(
      { ...admin, permissions: ['price_approver'] },
      project,
      'review',
      { accepted: true },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.salesAction(reviewer, project, 'review', { accepted: true }, 1);
  const selected = published.result.ranking
    .filter((x) => x.selected)
    .sort((a, b) => a.rank - b.rank);
  const first = fixtures.find((f) => f.code === selected[0]!.code)!,
    second = fixtures.find((f) => f.code === selected[1]!.code)!,
    c1 = { organizationId: org, userId: first.userId },
    c2 = { organizationId: org, userId: second.userId };
  await expect(
    svc.bind(
      admin,
      project,
      {
        code: selected[0]!.code,
        dossierId: first.dossier,
        applicationId: second.application,
        synthetic: true,
      },
      2,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.bind(
    admin,
    project,
    {
      code: selected[0]!.code,
      dossierId: first.dossier,
      applicationId: first.application,
      synthetic: true,
    },
    2,
  );
  await expect(
    svc.salesAction(admin, project, 'activate', { accepted: true }, 3),
  ).rejects.toMatchObject({ status: 409 });
  await svc.bind(
    admin,
    project,
    {
      code: selected[1]!.code,
      dossierId: second.dossier,
      applicationId: second.application,
      synthetic: true,
    },
    3,
  );
  await svc.salesAction(admin, project, 'activate', { accepted: true }, 4);
  await expect(svc.configureSales(admin, project, config, 5)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    svc.allocate(
      c2,
      project,
      { unitCode: 'A-101', accepted: true, idempotencyKey: randomUUID() },
      5,
    ),
  ).rejects.toMatchObject({ status: 409 });
  const request = { unitCode: 'A-101', accepted: true, idempotencyKey: randomUUID() };
  const privacy = new PrivacyService(db);
  await privacy.withdraw(c1);
  await expect(svc.allocate(c1, project, request, 5)).rejects.toMatchObject({ status: 428 });
  const current = await privacy.workspace(c1);
  await privacy.choose(c1, {
    noticeId: current.notice!.id,
    contentHash: current.notice!.content_hash,
    accepted: true,
  });
  const racing = await Promise.all([
    svc.allocate(c1, project, request, 5),
    svc.allocate(c1, project, request, 5),
  ]);
  expect(racing[0].id).toBe(racing[1].id);
  expect(racing.map((r) => r.replayed)).toEqual([false, true]);
  await expect(
    svc.allocate(c1, project, { ...request, unitCode: 'A-102' }, 5),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.allocate(
      c2,
      project,
      { unitCode: 'A-101', accepted: true, idempotencyKey: randomUUID() },
      5,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await svc.allocate(
    c2,
    project,
    { unitCode: 'A-102', accepted: true, idempotencyKey: randomUUID() },
    5,
  );
  const v = await svc.citizen(c1, project);
  expect(v.allocation).toBeTruthy();
  expect(JSON.stringify(v)).not.toContain(second.userId);
  expect(JSON.stringify(v)).not.toContain(second.dossier);
  await expect(
    db.query("UPDATE inventory_allocations SET quote='{}' WHERE id=$1", [racing[0].id]),
  ).rejects.toThrow('immutable');
  await expect(
    db.query("UPDATE inventory_sales SET mode='published-random' WHERE project_id=$1", [project]),
  ).rejects.toThrow('immutable');
});
it('random allocation consumes the published unit, rejects reroll and rechecks pause, revocation and voided draws', async () => {
  const customer = { organizationId: org, userId: randomUUID() };
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    customer.userId,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [randomUUID(), org, project2, customer.userId],
  );
  const [d] = await db.query(
    'SELECT id FROM prep_dossiers WHERE organization_id=$1 AND project_id=$2 AND owner_user_id=$3',
    [org, project2, customer.userId],
  );
  const app = await approvedFixture(project2, String(d!.id), customer.userId, 'DEMO-RAND1');
  const otherUser = randomUUID(),
    otherDossier = randomUUID();
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    otherUser,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [otherDossier, org, project2, otherUser],
  );
  const otherApp = await approvedFixture(project2, otherDossier, otherUser, 'DEMO-RAND2');
  await seedSyntheticPrivacy(db, [customer, { organizationId: org, userId: otherUser }]);
  await svc.import(admin, project2, { units, synthetic: true }, 0);
  const p = await svc.createPrice(admin, project2, price, 1);
  await svc.reviewPrice(
    reviewer,
    project2,
    p.id,
    { accepted: true, decision: 'approved', note: 'Đã kiểm tra giá giả lập' },
    1,
  );
  const pub = await publish(project2, 'allocation');
  await svc.configureSales(
    admin,
    project2,
    {
      mode: 'published-random',
      lotteryId: pub.id,
      rules: 'Căn được gán theo kết quả diễn tập, không quay lại sau xác nhận.',
      basis: 'Quy chế giả lập, kiểm tra độc lập và khóa kết quả.',
      rulesHash: 'd'.repeat(64),
      synthetic: true,
      pricePlanId: p.id,
    },
    0,
  );
  await svc.salesAction(reviewer, project2, 'review', { accepted: true }, 1);
  const bound = await svc.bind(
    admin,
    project2,
    { code: 'DEMO-RAND1', dossierId: d!.id, applicationId: app, synthetic: true },
    2,
  );
  await svc.bind(
    admin,
    project2,
    { code: 'DEMO-RAND2', dossierId: otherDossier, applicationId: otherApp, synthetic: true },
    3,
  );
  await svc.salesAction(admin, project2, 'activate', { accepted: true }, 4);
  await svc.salesAction(admin, project2, 'pause', { accepted: true }, 5);
  await expect(
    svc.allocate(customer, project2, { accepted: true, idempotencyKey: randomUUID() }, 7),
  ).rejects.toMatchObject({ status: 409 });
  await svc.salesAction(admin, project2, 'activate', { accepted: true }, 6);
  const assigned = pub.result.ranking.find((r) => r.code === 'DEMO-RAND1')!.unit!;
  await expect(
    svc.allocate(
      customer,
      project2,
      {
        unitCode: assigned === 'A-101' ? 'A-102' : 'A-101',
        accepted: true,
        idempotencyKey: randomUUID(),
      },
      7,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    svc.revoke(
      admin,
      project2,
      bound.id,
      { accepted: true, reason: 'Lý do diễn tập đã có căn cứ kiểm tra độc lập' },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.revoke(
    reviewer,
    project2,
    bound.id,
    { accepted: true, reason: 'Lý do diễn tập đã có căn cứ kiểm tra độc lập' },
    1,
  );
  await expect(
    svc.allocate(customer, project2, { accepted: true, idempotencyKey: randomUUID() }, 7),
  ).rejects.toMatchObject({ status: 403 });
  await lottery.transition(
    { ...reviewer, permissions: ['lottery_supervisor'] },
    pub.id,
    'void',
    { accepted: true, reason: 'Hủy phiên diễn tập sau rà soát kiểm thử' },
    7,
  );
  await expect(
    svc.salesAction(admin, project2, 'pause', { accepted: true }, 7),
  ).resolves.toBeTruthy();
  await expect(
    svc.salesAction(admin, project2, 'activate', { accepted: true }, 8),
  ).rejects.toMatchObject({ status: 409 });
});
