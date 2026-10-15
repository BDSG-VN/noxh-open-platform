import 'reflect-metadata';
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { calculatePriority, type LotteryConfig } from '@noxh/contracts';
import { Database } from './database';
import { LotteryService } from './lottery-service';
import { boundedIndex, draw } from './lottery-engine';
import type { Staff } from './workforce';
import { seal } from './identity-crypto';
import { randomUUID } from 'node:crypto';
const org = '10000000-0000-4000-8000-000000000001';
const operator: Staff = {
    organizationId: org,
    subject: 'operator',
    role: 'org_admin',
    permissions: ['lottery_operator'],
  },
  supervisor: Staff = { ...operator, subject: 'supervisor', permissions: ['lottery_supervisor'] };
const config: LotteryConfig = {
  cohortId: '70000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  title: 'DIỄN TẬP BỐC THĂM — GIẢ LẬP',
  kind: 'selection',
  seats: 2,
  entries: ['DEMO-0004', 'DEMO-0001', 'DEMO-0003', 'DEMO-0002'],
  units: [],
  rules: 'Quy chế diễn tập với dữ liệu giả lập, không có giá trị pháp lý.',
  legalBasis: 'Điều 38 VBHN 24/BXD — kiểm thử',
  priorityResolution: 'Danh sách sau xử lý ưu tiên giả lập, chưa xác nhận pháp lý.',
  eligibilityEvidenceHash: 'a'.repeat(64),
  scheduledAt: '2099-01-01T00:00:00.000Z',
  entropySource: 'Nguồn diễn tập do người giám sát nhập; không phải beacon đã xác thực.',
  synthetic: true,
};
let cohortRound = '';
const cohortBody = (supersedesId: string | null = null) => ({
  roundId: cohortRound,
  mode: 'buy',
  kind: config.kind,
  seats: config.seats,
  description: 'SYNTHETIC FULL COHORT: reviewed entire closed-round approved population.',
  legalBasis: 'SYNTHETIC REVIEWED LEGAL BASIS',
  exclusions: [],
  supersedesId,
  replacementReason: supersedesId ? 'SYNTHETIC EXPLICIT REPLACEMENT AFTER RECORDED VOID' : '',
});
let db: Database, pg: PGlite, svc: LotteryService;
const prior = { ...process.env };
async function fixtureRound(status = 'closed') {
  const id = randomUUID();
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'SYNTHETIC COHORT CASE',$4,now()-interval '2 days',now()-interval '1 day')",
    [id, org, config.projectId, status],
  );
  return id;
}
async function fixtureApplication(round: string, code: string, mode = 'buy', status = 'approved') {
  const id = randomUUID(),
    user = randomUUID(),
    dossier = randomUUID(),
    notice = (
      await db.query('SELECT id FROM privacy_notices WHERE organization_id=$1 LIMIT 1', [org])
    )[0]!.id;
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    user,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [dossier, org, config.projectId, user],
  );
  await db.query(
    'INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,true,$13,$11)',
    [
      id,
      org,
      config.projectId,
      round,
      dossier,
      user,
      'SYNTHETIC-' + id,
      code,
      status,
      seal(JSON.stringify({ mode }), 'application:' + org + ':' + id),
      'b'.repeat(64),
      notice,
      randomUUID(),
    ],
  );
  return id;
}
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
  svc = new LotteryService(db);
  // Explicit unit fixture reference; production always invokes the mandatory Rust kernel.
  svc.kernel = async (_kind, input) => draw(input.config, input.id, input.secret, input.entropy);
  const notice = randomUUID(),
    round = randomUUID();
  await db.query(
    "INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by) VALUES($1,$2,1,'{}',$3,'SYNTHETIC FIXTURE')",
    [notice, org, 'a'.repeat(64)],
  );
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'SYNTHETIC FIXTURE','closed',now()-interval '2 days',now()-interval '1 day')",
    [round, org, config.projectId],
  );
  for (const code of config.entries) {
    const user = randomUUID(),
      dossier = randomUUID(),
      id = randomUUID();
    await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
      user,
      org,
    ]);
    await db.query(
      'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
      [dossier, org, config.projectId, user],
    );
    await db.query(
      "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'approved',$9,$10,1,$11,true,$12,$10)",
      [
        id,
        org,
        config.projectId,
        round,
        dossier,
        user,
        'SYNTHETIC-' + id,
        code,
        seal(JSON.stringify({ mode: 'buy' }), 'application:' + org + ':' + id),
        'b'.repeat(64),
        notice,
        randomUUID(),
      ],
    );
  }
  cohortRound = round;
  const c = await svc.draftCohort(operator, cohortBody());
  config.cohortId = c.id;
  config.eligibilityEvidenceHash = c.hash;
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('counts distinct priority groups, exposes fractions and never chooses a rounding rule silently', () => {
  const b = {
    totalEligible: 101,
    homes: 20,
    counts: [1, 2, 3, 4, 5],
    rounding: null,
    roundingBasis: '',
    uniqueVerified: true,
  } as const;
  const r = calculatePriority({ ...b, counts: [...b.counts] });
  expect(r.numerator).toBe(300);
  expect(r.denominator).toBe(101);
  expect(r.quota).toBe(null);
  expect(r.requiresRoundingReview).toBe(true);
  expect(() => calculatePriority({ ...b, counts: [...b.counts], rounding: 'ceil' })).toThrow(
    'căn cứ',
  );
  const chosen = calculatePriority({
    ...b,
    counts: [...b.counts],
    rounding: 'ceil',
    roundingBasis: 'CĂN CỨ GIẢ LẬP ĐÃ KIỂM TRA',
  });
  expect(chosen.quota).toBe(3);
  expect(chosen.groups[2]?.allocate).toBe(0);
  expect(() => calculatePriority({ ...b, counts: [100, 100, 0, 0, 0] })).toThrow('một lần');
});
it('uses rejection sampling, deterministic permutations, exact units and seed-bound commitments', () => {
  const words = [0xffffffff, 5];
  expect(boundedIndex(() => words.shift()!, 3)).toBe(2);
  const r = draw(config, '50000000-0000-4000-8000-000000000001', '1'.repeat(64), '2'.repeat(64));
  expect(
    draw(
      { ...config, entries: [...config.entries].reverse() },
      '50000000-0000-4000-8000-000000000001',
      '1'.repeat(64),
      '2'.repeat(64),
    ),
  ).toEqual(r);
  expect(new Set(r.ranking.map((x) => x.code)).size).toBe(4);
  expect(r.ranking.filter((x) => x.selected)).toHaveLength(2);
  const a = draw(
    { ...config, kind: 'allocation', seats: 4, units: ['A-04', 'A-01', 'A-03', 'A-02'] },
    '50000000-0000-4000-8000-000000000001',
    '1'.repeat(64),
    '2'.repeat(64),
  );
  expect(new Set(a.ranking.map((x) => x.unit)).size).toBe(4);
});
it('enforces roles, separate review, immutable configuration and no unnecessary or real draws', async () => {
  await expect(svc.create({ ...operator, permissions: [] }, config)).rejects.toMatchObject({
    status: 403,
  });
  await expect(svc.create(operator, { ...config, seats: 4 })).rejects.toMatchObject({
    status: 400,
  });
  await expect(svc.create(operator, { ...config, synthetic: false })).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    svc.reviewCohort({ ...operator, permissions: ['lottery_supervisor'] }, config.cohortId, {
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await svc.reviewCohort(supervisor, config.cohortId, { accepted: true });
  await expect(
    svc.create(operator, { ...config, entries: config.entries.slice(0, 3) }),
  ).rejects.toMatchObject({ status: 409 });
  const r = await svc.create(operator, config);
  await expect(svc.create(operator, config)).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.transition(
      { ...operator, permissions: ['lottery_supervisor'] },
      r.id,
      'review',
      { accepted: true },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.transition(supervisor, r.id, 'review', { accepted: true }, 1);
  await expect(
    db.query("UPDATE lottery_workspaces SET config='{}' WHERE id=$1", [r.id]),
  ).rejects.toThrow('immutable');
  await svc.transition(operator, r.id, 'freeze', { accepted: true }, 2);
  const pub = await svc.publicOne(r.id);
  expect(pub.commitment).toMatch(/^[a-f0-9]{64}$/);
  expect(pub.result).toBe(null);
  expect(JSON.stringify(pub)).not.toContain('secret_cipher');
  await expect(
    svc.transition(
      supervisor,
      r.id,
      'entropy',
      { accepted: true, entropy: '2'.repeat(64), record: 'GIẢ LẬP' },
      3,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.transition(operator, r.id, 'execute', { accepted: true }, 3),
  ).rejects.toMatchObject({ status: 409 });
  await svc.transition(
    supervisor,
    r.id,
    'void',
    { accepted: true, reason: 'HỦY DIỄN TẬP KIỂM THỬ' },
    3,
  );
  expect((await svc.publicOne(r.id)).status).toBe('voided');
  await expect(db.query('DELETE FROM lottery_workspaces WHERE id=$1', [r.id])).rejects.toThrow(
    'cannot be deleted',
  );
});
it('runs once, requires separate certification and reproduces the public evidence in independent Python', async () => {
  const c = await svc.draftCohort(operator, cohortBody(config.cohortId));
  await svc.reviewCohort(supervisor, c.id, { accepted: true });
  config.cohortId = c.id;
  config.eligibilityEvidenceHash = c.hash;
  const r = await svc.create(operator, config);
  await svc.transition(supervisor, r.id, 'review', { accepted: true }, 1);
  await svc.transition(operator, r.id, 'freeze', { accepted: true }, 2);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:01.000Z'));
  try {
    await svc.transition(
      supervisor,
      r.id,
      'entropy',
      { accepted: true, entropy: '2'.repeat(64), record: 'NGUỒN DIỄN TẬP ĐÃ GHI NHẬN' },
      3,
    );
  } finally {
    clock.mockRestore();
  }
  const unitKernel = svc.kernel;
  const priorBinary = process.env.LOTTERY_ENGINE_BIN;
  try {
    process.env.LOTTERY_ENGINE_BIN = '/private/tmp/noxh-missing-kernel-' + randomUUID();
    svc.kernel = new LotteryService(db).kernel;
    await expect(
      svc.transition(operator, r.id, 'execute', { accepted: true }, 4),
    ).rejects.toMatchObject({ status: 503 });
    svc.kernel = async () => ({ secret: 'malformed-sensitive-output' });
    await expect(
      svc.transition(operator, r.id, 'execute', { accepted: true }, 4),
    ).rejects.toMatchObject({ status: 503 });
    svc.kernel = async (_kind, input) => ({
      ...draw(input.config, input.id, input.secret, input.entropy),
      commitment: 'f'.repeat(64),
    });
    await expect(
      svc.transition(operator, r.id, 'execute', { accepted: true }, 4),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      (
        await db.query('SELECT status,version,result FROM lottery_workspaces WHERE id=$1', [r.id])
      )[0],
    ).toMatchObject({ status: 'seeded', version: 4, result: null });
  } finally {
    svc.kernel = unitKernel;
    if (priorBinary === undefined) delete process.env.LOTTERY_ENGINE_BIN;
    else process.env.LOTTERY_ENGINE_BIN = priorBinary;
  }
  await svc.transition(operator, r.id, 'execute', { accepted: true }, 4);
  await expect(
    svc.transition(operator, r.id, 'execute', { accepted: true }, 4),
  ).rejects.toMatchObject({ status: 409 });
  expect((await svc.publicOne(r.id)).result).toBe(null);
  await expect(
    svc.transition(
      { ...operator, permissions: ['lottery_supervisor'] },
      r.id,
      'certify',
      { accepted: true, minutesHash: 'b'.repeat(64) },
      5,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await svc.transition(
    supervisor,
    r.id,
    'certify',
    { accepted: true, minutesHash: 'b'.repeat(64) },
    5,
  );
  await svc.transition(operator, r.id, 'publish', { accepted: true }, 6);
  const evidence = await svc.publicOne(r.id),
    dir = await mkdtemp(resolve(tmpdir(), 'noxh-lottery-'));
  try {
    const path = resolve(dir, 'evidence.json');
    await writeFile(path, JSON.stringify(evidence));
    const verify = () =>
      spawnSync('python3', [resolve('../..', 'scripts/verify-lottery.py'), path], {
        encoding: 'utf8',
      });
    expect(verify().status).toBe(0);
    const tampered = structuredClone(evidence);
    (tampered.result as { ranking: { code: string }[] }).ranking[0]!.code = 'DEMO-FAKE';
    await writeFile(path, JSON.stringify(tampered));
    expect(verify().status).toBe(1);
  } finally {
    await rm(dir, { recursive: true });
  }
  await expect(
    db.query("UPDATE lottery_workspaces SET result='{}' WHERE id=$1", [r.id]),
  ).rejects.toThrow('immutable');
});
it('derives the full same-round and same-mode population and refuses unresolved or open rounds', async () => {
  const other = await fixtureRound();
  await fixtureApplication(other, 'DEMO-OTHER-9001');
  await fixtureApplication(cohortRound, 'DEMO-RENT-9001', 'rent');
  await fixtureApplication(cohortRound, 'DEMO-RENT-9002', 'rent', 'submitted');
  const source = await svc.cohortSource(operator, cohortRound, 'buy');
  expect(source.entries.map((e) => e.code)).toEqual([...config.entries].sort());
  await expect(svc.cohortSource(operator, cohortRound, 'rent')).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    svc.create(operator, {
      ...config,
      entries: [config.entries[0], config.entries[1], config.entries[2], 'DEMO-OTHER-9001'],
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.create(operator, {
      ...config,
      entries: [config.entries[0], config.entries[1], config.entries[2], 'DEMO-RENT-9001'],
    }),
  ).rejects.toMatchObject({ status: 409 });
  const open = await fixtureRound('open');
  await fixtureApplication(open, 'DEMO-OPEN-9001');
  await expect(svc.cohortSource(operator, open, 'buy')).rejects.toMatchObject({ status: 409 });
});
it('requires evidenced exclusions, independent cohort review and explicit replacement after a void', async () => {
  const body = {
    ...cohortBody(),
    kind: 'priority-overflow',
    exclusions: [
      {
        code: config.entries[0],
        category: 'priority-exempt',
        reason: 'SYNTHETIC REVIEWED EXEMPTION FOR THIS DEMONSTRATION',
        evidenceHash: 'd'.repeat(64),
      },
    ],
  };
  await expect(
    svc.draftCohort(operator, { ...body, entries: config.entries.slice(1) }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    svc.draftCohort(operator, {
      ...body,
      exclusions: [{ ...body.exclusions[0], code: 'DEMO-OTHER-9001' }],
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    svc.draftCohort(operator, {
      ...body,
      exclusions: [{ ...body.exclusions[0], reason: '', evidenceHash: '' }],
    }),
  ).rejects.toMatchObject({ status: 400 });
  const cohort = await svc.draftCohort(operator, body);
  expect(cohort.entries).toHaveLength(3);
  await expect(
    svc.create(operator, {
      ...config,
      cohortId: cohort.id,
      kind: 'priority-overflow',
      entries: cohort.entries,
      eligibilityEvidenceHash: cohort.hash,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await svc.reviewCohort(supervisor, cohort.id, { accepted: true });
  const attempt = await svc.create(operator, {
    ...config,
    cohortId: cohort.id,
    kind: 'priority-overflow',
    entries: cohort.entries,
    eligibilityEvidenceHash: cohort.hash,
  });
  await svc.transition(supervisor, attempt.id, 'review', { accepted: true }, 1);
  await svc.transition(operator, attempt.id, 'freeze', { accepted: true }, 2);
  const publicEvidence = await svc.publicOne(attempt.id);
  expect(publicEvidence.cohort.hash).toBe(cohort.hash);
  expect(JSON.stringify(publicEvidence)).not.toContain(body.exclusions[0]?.reason);
  await svc.transition(
    supervisor,
    attempt.id,
    'void',
    { accepted: true, reason: 'SYNTHETIC VOID WITH RECORDED REVIEW' },
    3,
  );
  await expect(
    svc.create(operator, {
      ...config,
      cohortId: cohort.id,
      kind: 'priority-overflow',
      entries: cohort.entries,
      eligibilityEvidenceHash: cohort.hash,
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(svc.draftCohort(operator, body)).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.draftCohort(operator, { ...body, supersedesId: cohort.id, replacementReason: '' }),
  ).rejects.toMatchObject({ status: 400 });
  const replacement = await svc.draftCohort(operator, {
    ...body,
    supersedesId: cohort.id,
    replacementReason: 'SYNTHETIC EXPLICIT REPLACEMENT, PREVIOUS EVIDENCE PRESERVED',
  });
  await svc.reviewCohort(supervisor, replacement.id, { accepted: true });
  expect((await svc.cohorts(operator)).find((c) => c.id === cohort.id)?.status).toBe('superseded');
  await expect(
    db.query("UPDATE lottery_cohorts SET entries='[]' WHERE id=$1", [replacement.id]),
  ).rejects.toThrow('immutable');
});
it('refuses to freeze when any approved source fingerprint changed after cohort review', async () => {
  const group = await svc.draftCohort(operator, {
    ...cohortBody(),
    kind: 'allocation',
    seats: config.entries.length,
  });
  await svc.reviewCohort(supervisor, group.id, { accepted: true });
  const attempt = await svc.create(operator, {
    ...config,
    cohortId: group.id,
    kind: 'allocation',
    seats: config.entries.length,
    entries: group.entries,
    units: ['A-01', 'A-02', 'A-03', 'A-04'],
    eligibilityEvidenceHash: group.hash,
  });
  await svc.transition(supervisor, attempt.id, 'review', { accepted: true }, 1);
  // Simulate out-of-band source drift; the application service additionally seals rounds after a freeze.
  await fixtureApplication(cohortRound, 'DEMO-LATE-9001');
  await expect(
    svc.transition(operator, attempt.id, 'freeze', { accepted: true }, 2),
  ).rejects.toMatchObject({ status: 409 });
});
