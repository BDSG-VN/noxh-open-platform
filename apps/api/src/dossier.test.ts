import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Database } from './database';
import { DossierService } from './dossier-service';
import { auditHash, verifyAudit } from './audit';
import { emptyDeclaration } from '@noxh/contracts';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001',
  id = '40000000-0000-4000-8000-000000000001';
const c = { organizationId: org, userId: owner },
  staff: Staff = { organizationId: org, subject: 'synthetic-staff', role: 'org_admin' };
const declaration = {
  fullName: 'NGƯỜI DÙNG GIẢ LẬP',
  dateOfBirth: '1995-01-15',
  address: 'ĐỊA CHỈ GIẢ LẬP',
  occupation: 'NGHỀ NGHIỆP GIẢ LẬP',
  housingSituation: 'renting',
  household: [{ fullName: 'THÀNH VIÊN GIẢ LẬP', dateOfBirth: '2020-02-29', relationship: 'child' }],
  confirmed: true,
};
let pg: PGlite, db: Database, service: DossierService;
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  service = new DossierService(db);
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('denies guessed dossier to another account and organization', async () => {
  await expect(
    service.detail({ ...c, userId: '30000000-0000-4000-8000-000000000099' }, id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.save(
      { ...c, organizationId: '10000000-0000-4000-8000-000000000002' },
      id,
      emptyDeclaration,
      1,
    ),
  ).rejects.toMatchObject({ status: 404 });
  expect((await service.detail(c, id)).declaration).toEqual(emptyDeclaration);
});
it('encrypts declarations, stores household references, and resumes the exact snapshot', async () => {
  const saved = await service.save(c, id, declaration, 1);
  expect(saved.version).toBe(2);
  const detail = await service.detail(c, id);
  expect(detail.declaration).toEqual(declaration);
  expect(detail.history).toHaveLength(1);
  const [raw] = await db.query(
    'SELECT encrypted_payload FROM declaration_versions WHERE dossier_id=$1',
    [id],
  );
  expect(Buffer.from(raw!.encrypted_payload as Uint8Array).toString()).not.toContain(
    declaration.fullName,
  );
  expect((await db.query('SELECT * FROM household_members WHERE valid_to IS NULL')).length).toBe(2);
  expect(saved.readiness.score).toBe(45);
  expect(saved.readiness.categories.find((v) => v.code === 'documents')?.score).toBe(0);
});
it('serializes racing edits so only one expected version can commit', async () => {
  const outcomes = await Promise.allSettled([
    service.save(c, id, { ...declaration, occupation: 'MỘT' }, 2),
    service.save(c, id, { ...declaration, occupation: 'HAI' }, 2),
  ]);
  expect(outcomes.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
  const conflict = outcomes.find((v) => v.status === 'rejected') as PromiseRejectedResult;
  expect(conflict.reason.status).toBe(409);
  expect((await service.detail(c, id)).version).toBe(3);
  expect(
    (await db.query('SELECT * FROM declaration_versions WHERE dossier_id=$1', [id])).length,
  ).toBe(2);
  expect((await db.query('SELECT * FROM household_members WHERE valid_to IS NULL')).length).toBe(2);
});
it('rejects impossible dates, future birth dates, extra authority fields and false confirmations', async () => {
  for (const bad of [
    { ...declaration, dateOfBirth: '2020-02-30' },
    { ...declaration, dateOfBirth: '2999-01-01' },
    { ...declaration, ownerId: 'caller-controlled' },
    { ...emptyDeclaration, confirmed: true },
  ])
    await expect(service.save(c, id, bad, 3)).rejects.toMatchObject({ status: 400 });
  expect((await service.detail(c, id)).version).toBe(3);
});
it('binds readiness history to an input version and immutable checklist result', async () => {
  await expect(service.assess(c, id, 2)).rejects.toMatchObject({ status: 409 });
  expect((await service.assess(c, id, 3)).score).toBe(45);
  const [a] = await db.query('SELECT * FROM readiness_assessments');
  expect(a?.input_version).toBe(3);
  await expect(db.query('UPDATE readiness_assessments SET score=100')).rejects.toThrow();
  await expect(
    db.query("UPDATE declaration_versions SET schema_version='altered'"),
  ).rejects.toThrow();
});
let requestId = '';
it('requires explicit sharing consent and limits active requests per dossier', async () => {
  await expect(
    service.requestHelp(c, id, { message: 'Câu hỏi giả lập', accepted: false }),
  ).rejects.toMatchObject({ status: 400 });
  requestId = (await service.requestHelp(c, id, { message: 'Câu hỏi giả lập', accepted: true })).id;
  await expect(
    service.requestHelp(c, id, { message: 'Gửi lại', accepted: true }),
  ).rejects.toMatchObject({ status: 409 });
  const r = (await service.requests(staff))[0];
  expect(r?.message).toBe('Câu hỏi giả lập');
  expect(JSON.stringify(r)).not.toContain(declaration.fullName);
  const [raw] = await db.query('SELECT message_cipher FROM preparation_requests WHERE id=$1', [
    requestId,
  ]);
  expect(raw?.message_cipher).not.toContain('Câu hỏi giả lập');
});
it('scopes staff replies and citizen closures and preserves version conflict checks', async () => {
  expect(
    await service.requests({ ...staff, organizationId: '10000000-0000-4000-8000-000000000002' }),
  ).toHaveLength(0);
  await expect(
    service.reply(
      { ...staff, organizationId: '10000000-0000-4000-8000-000000000002' },
      requestId,
      { message: 'bad' },
      1,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await service.reply(staff, requestId, { message: 'Hướng dẫn giả lập' }, 1);
  await expect(service.reply(staff, requestId, { message: 'lặp' }, 1)).rejects.toMatchObject({
    status: 409,
  });
  expect((await service.detail(c, id)).requests[0]?.reply).toBe('Hướng dẫn giả lập');
  await expect(
    service.closeRequest({ ...c, userId: '30000000-0000-4000-8000-000000000099' }, requestId, 2),
  ).rejects.toMatchObject({ status: 409 });
  await service.closeRequest(c, requestId, 2);
  expect((await service.detail(c, id)).requests[0]?.status).toBe('closed');
});
it('verifies the audit chain, detects tampering and rejects event updates/deletes', async () => {
  const a = await service.audit(staff);
  expect(a.verification.valid).toBe(true);
  expect(a.items.length).toBeGreaterThan(4);
  const rows = await db.query(
    'SELECT * FROM identity_private.audit_chain WHERE organization_id=$1 ORDER BY sequence',
    [org],
  );
  const tampered = rows.map((v) => ({ ...v }));
  tampered[1]!.action = 'altered';
  expect(verifyAudit(tampered).valid).toBe(false);
  tampered[1]!.event_hash = auditHash(tampered[1]!);
  expect(verifyAudit(tampered).valid).toBe(false);
  await expect(db.query('DELETE FROM identity_private.audit_chain')).rejects.toThrow();
  await expect(
    db.query("UPDATE identity_private.operations SET action='altered'"),
  ).rejects.toThrow();
});
