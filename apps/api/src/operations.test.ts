import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Database } from './database';
import { OperationsService } from './operations-service';
import { WorkforceAuth, type Staff } from './workforce';
import { WorkforceAccessGuard } from './workforce-access-guard';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  otherProject = '20000000-0000-4000-8000-000000000002';
const admin: Staff = { subject: 'synthetic-admin', organizationId: org, role: 'org_admin' },
  second: Staff = { ...admin, subject: 'synthetic-second' },
  employee: Staff = {
    ...admin,
    subject: 'synthetic-employee',
    role: 'staff',
    projectIds: [project],
  };
let pg: PGlite, db: Database, svc: OperationsService, memberId: string;
const prior = { ...process.env };
const member = {
  subject: employee.subject,
  name: 'Nhân viên giả lập',
  department: 'business',
  status: 'active',
  permissions: [
    'workflow_read',
    'workflow_write',
    'records_read',
    'records_write',
    'finance_read',
    'finance_write',
  ],
  projectIds: [project],
};
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'e'.repeat(64);
  process.env.AUTH_ORGANIZATION_ID = org;
  process.env.WORKFORCE_ISSUER = 'https://identity.example.test/realms/noxh';
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  svc = new OperationsService(db);
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('requires organization admin for employee grants, exact project scope and stable Keycloak subject', async () => {
  await expect(svc.saveEmployee(employee, member)).rejects.toMatchObject({ status: 403 });
  const m = await svc.saveEmployee(admin, member);
  memberId = m.id;
  expect((await svc.projects(employee)).map((p) => p.id)).toEqual([project]);
  await expect(svc.workflow(employee, otherProject)).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.saveEmployee(admin, { ...member, subject: 'swapped-subject' }, memberId, 1),
  ).rejects.toMatchObject({ status: 400 });
  await expect(svc.saveEmployee(admin, member, memberId, 99)).rejects.toMatchObject({
    status: 409,
  });
});
it('authenticates staff only with signed role, MFA and an active locally granted membership', async () => {
  const keys = await generateKeyPair('RS256'),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'test';
  const auth = new WorkforceAuth(db);
  auth.testKey = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT({
    azp: 'noxh-investor',
    amr: ['pwd', 'otp'],
    realm_access: { roles: ['noxh_staff', 'reviewer'] },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setSubject(employee.subject)
    .setIssuer(process.env.WORKFORCE_ISSUER!)
    .setAudience('noxh-api')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(keys.privateKey);
  const staff = await auth.authenticate('Bearer ' + token);
  expect(staff.role).toBe('staff');
  expect(staff.projectIds).toEqual([project]);
  expect(staff.permissions).toContain('reviewer');
  expect(staff.permissions).not.toContain('privacy_officer');
  await svc.saveEmployee(admin, { ...member, status: 'suspended' }, memberId, 1);
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 403 });
  await svc.saveEmployee(admin, member, memberId, 2);
});
it('denies every preexisting admin path by default for new staff memberships', async () => {
  const auth = { authenticate: async () => employee } as unknown as WorkforceAuth,
    guard = new WorkforceAccessGuard(auth);
  const context = (path: string, method = 'GET') =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ path, method, headers: { authorization: 'Bearer synthetic' } }),
      }),
    }) as unknown as ExecutionContext;
  for (const path of [
    '/api/v1/admin/dashboard',
    '/api/v1/admin/projects',
    '/api/v1/admin/settings/openai',
    '/api/v1/admin/lotteries',
    '/api/v1/admin/requests',
  ])
    await expect(guard.canActivate(context(path))).rejects.toMatchObject({ status: 403 });
  expect(await guard.canActivate(context('/api/v1/admin/me'))).toBe(true);
  expect(await guard.canActivate(context('/api/v1/admin/operations/projects'))).toBe(true);
  expect(await guard.canActivate(context('/api/v1/admin/applications'))).toBe(true);
  await expect(guard.canActivate(context('/api/v1/admin/me', 'POST'))).rejects.toMatchObject({
    status: 403,
  });
});
it('requires independent plan review and separates internal status from government approval', async () => {
  expect(await svc.workflow(employee, project)).toBeNull();
  await svc.initialize(employee, project);
  await expect(svc.initialize(employee, project)).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.updateTask(
      employee,
      project,
      'investment-route',
      { status: 'in_progress', note: 'Đang rà soát giả lập', evidence: null },
      1,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.activate(employee, project, { reviewed: true, note: 'Căn cứ rà soát giả lập' }, 1),
  ).rejects.toMatchObject({ status: 403 });
  await svc.activate(
    second,
    project,
    {
      reviewed: true,
      note: 'Rà soát giả lập: chọn nhánh và kiểm tra các ngoại lệ trước khi sử dụng',
    },
    1,
  );
  const w = await svc.workflow(employee, project);
  expect(w?.tasks).toHaveLength(14);
  expect(w?.status).toBe('active');
  expect(w).not.toHaveProperty('governmentApproved');
});
it('checks evidence, dependencies, stale versions and separate task reviewers', async () => {
  const evidence = {
    reference: 'VĂN BẢN GIẢ LẬP 001',
    sha256: 'a'.repeat(64),
    authority: 'CƠ QUAN GIẢ LẬP',
    issuedOn: '2026-10-15',
  };
  await svc.updateTask(
    employee,
    project,
    'design',
    { status: 'evidence_recorded', note: 'Chứng cứ giả lập', evidence },
    1,
  );
  await expect(svc.completeTask(second, project, 'design', 2)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    svc.updateTask(
      employee,
      project,
      'investment-route',
      { status: 'evidence_recorded', note: 'Thiếu chứng cứ', evidence: null },
      1,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await svc.updateTask(
    admin,
    project,
    'investment-route',
    { status: 'evidence_recorded', note: 'Giả lập lựa chọn nhánh', evidence },
    1,
  );
  await expect(svc.completeTask(admin, project, 'investment-route', 2)).rejects.toMatchObject({
    status: 403,
  });
  await svc.completeTask(second, project, 'investment-route', 2);
  const history = await db.query(
    'SELECT version,status FROM identity_private.investor_task_history WHERE code=$1 ORDER BY version',
    ['investment-route'],
  );
  expect(history.map((h) => h.version)).toEqual([1, 2, 3]);
  await expect(
    db.query("UPDATE identity_private.investor_task_history SET status='todo' WHERE code=$1", [
      'investment-route',
    ]),
  ).rejects.toThrow('append-only');
  await expect(
    svc.updateTask(
      employee,
      project,
      'investment-route',
      { status: 'todo', note: 'Thử sửa kết quả', evidence: null },
      3,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.updateTask(
      employee,
      project,
      'intake',
      {
        status: 'not_applicable',
        note: 'Bỏ qua bước bắt buộc không được cho phép',
        evidence: null,
      },
      1,
    ),
  ).rejects.toMatchObject({ status: 400 });
  await svc.updateTask(
    employee,
    project,
    'land',
    {
      status: 'not_applicable',
      note: 'Căn cứ giả lập: nhánh riêng đã được người duyệt kiểm tra',
      evidence: null,
    },
    1,
  );
  expect(
    (await svc.workflow(employee, project))?.tasks.find((t) => t.code === 'land')?.status,
  ).toBe('evidence_recorded');
  await svc.completeTask(second, project, 'land', 2);
  expect(
    (await svc.workflow(employee, project))?.tasks.find((t) => t.code === 'land')?.status,
  ).toBe('not_applicable');
});
it('encrypts immutable wiki revisions, restricts confidential records and denies cross-project clones', async () => {
  const b = {
    title: 'Wiki quy trình giả lập',
    kind: 'wiki',
    classification: 'restricted',
    body: 'NỘI DUNG NỘI BỘ GIẢ LẬP KHÔNG PHẢI HỒ SƠ THẬT',
    attachment: null,
  };
  const r = await svc.saveRecord(admin, project, b);
  expect(await svc.records(employee, project)).toHaveLength(0);
  await expect(
    svc.saveRecord(employee, project, { ...b, recordId: r.recordId, classification: 'internal' }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.saveRecord(admin, project, { ...b, recordId: r.recordId, classification: 'internal' }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    svc.reviewRecord(admin, project, r.id, { action: 'approve' }, 1),
  ).rejects.toMatchObject({ status: 403 });
  await svc.reviewRecord(second, project, r.id, { action: 'approve' }, 1);
  const [raw] = await db.query(
    'SELECT payload_cipher FROM identity_private.investor_record_revisions WHERE id=$1',
    [r.id],
  );
  expect(raw?.payload_cipher).not.toContain(b.body);
  await expect(
    db.query("UPDATE identity_private.investor_record_revisions SET title='tampered' WHERE id=$1", [
      r.id,
    ]),
  ).rejects.toThrow('immutable record revision');
  await expect(
    svc.saveRecord(admin, otherProject, { ...b, recordId: r.recordId }),
  ).rejects.toMatchObject({ status: 404 });
  const r2 = await svc.saveRecord(admin, project, {
    ...b,
    recordId: r.recordId,
    body: b.body + ' PHIÊN BẢN HAI',
  });
  expect(r2.revision).toBe(2);
});
it('enforces balanced journals, independent posting and database immutability', async () => {
  const b = {
    date: '2026-10-15',
    description: 'BÚT TOÁN GIẢ LẬP',
    evidenceReference: 'CHỨNG TỪ GIẢ LẬP',
    lines: [
      { account: 'DEMO111', debit: 1000000, credit: 0 },
      { account: 'DEMO131', debit: 0, credit: 1000000 },
    ],
  };
  await expect(
    svc.createJournal(employee, project, {
      ...b,
      lines: [
        { account: '1', debit: 100, credit: 0 },
        { account: '2', debit: 0, credit: 99 },
      ],
    }),
  ).rejects.toMatchObject({ status: 400 });
  const j = await svc.createJournal(admin, project, b);
  await expect(svc.postJournal(admin, project, j.id, 1)).rejects.toMatchObject({ status: 403 });
  await svc.postJournal(second, project, j.id, 1);
  await expect(svc.postJournal(second, project, j.id, 1)).rejects.toMatchObject({ status: 409 });
  await expect(
    db.query("UPDATE identity_private.investor_journals SET status='draft' WHERE id=$1", [j.id]),
  ).rejects.toThrow('immutable journal');
  const rows = await svc.journals(employee, project);
  expect(rows[0]?.status).toBe('posted');
  expect(rows[0]?.lines).toEqual(b.lines);
});
it('revoking a project or suspending membership immediately blocks old workforce scope', async () => {
  await svc.saveEmployee(admin, { ...member, projectIds: [] }, memberId, 3);
  await expect(svc.records(employee, project)).rejects.toMatchObject({ status: 403 });
  expect(await svc.projects(employee)).toHaveLength(0);
  await expect(svc.createJournal(employee, project, {})).rejects.toMatchObject({ status: 400 });
});

it('persists explicitly assigned sensitive duties and rejects unknown local privileges', async () => {
  const local = {
    ...member,
    subject: 'synthetic-duty-reviewer',
    permissions: [
      'form_legal_approver',
      'privacy_officer',
      'lottery_operator',
      'lottery_supervisor',
      'price_approver',
      'intake_officer',
      'reviewer',
      'approver',
      'auditor',
      'records_read',
    ],
  };
  await expect(
    svc.saveEmployee(admin, { ...local, permissions: ['realm_super_admin'] }),
  ).rejects.toMatchObject({ status: 400 });
  const created = await svc.saveEmployee(admin, local);
  const [stored] = await db.query(
    'SELECT permissions FROM identity_private.investor_employees WHERE id=$1 AND organization_id=$2',
    [created.id, org],
  );
  expect(stored?.permissions).toEqual(local.permissions);
});
it('retains the authenticated project boundary if local grants expand after authentication', async () => {
  // The Staff snapshot is limited to project. A separate admin adds a local grant
  // after authentication; domain reads and writes must not expand that request.
  await svc.saveEmployee(admin, { ...member, projectIds: [project, otherProject] }, memberId, 4);
  expect((await svc.projects(employee)).map((p) => p.id)).toEqual([project]);
  await expect(svc.records(employee, otherProject)).rejects.toMatchObject({ status: 403 });
  await expect(svc.authorizeRecordFiles(employee, otherProject, true)).rejects.toMatchObject({
    status: 403,
  });
  await expect(svc.journals(employee, otherProject)).rejects.toMatchObject({ status: 403 });
  expect(await svc.projects({ ...employee, projectIds: undefined })).toEqual([]);
});
it('lists employees with their project grants in a single consistent read', async () => {
  await svc.saveEmployee(admin, { ...member, projectIds: [project, otherProject] }, memberId, 5);
  const queries: string[] = [];
  const original = db.query.bind(db);
  db.query = async (text: string, values?: unknown[]) => {
    queries.push(text);
    return original(text, values);
  };
  try {
    const rows = await svc.employees(admin);
    const listed = rows.find((r) => r.id === memberId);
    expect(listed?.projectIds).toEqual([project, otherProject].sort());
    expect(rows.every((r) => Array.isArray(r.projectIds))).toBe(true);
    // One statement for the whole list: no per-employee grant lookups (N+1).
    expect(queries).toHaveLength(1);
  } finally {
    db.query = original;
  }
});
