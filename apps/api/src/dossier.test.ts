import { seedSyntheticPrivacy } from './test-privacy';
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
  await seedSyntheticPrivacy(db, [c]);
  service = new DossierService(db);
  service.auditKernel = async (_kind, payload) => {
    const events = (payload as { events: Record<string, unknown>[] }).events;
    return verifyAudit(events);
  };
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

it('canonicalizes case-insensitive UUIDs before binding encrypted snapshots and replies', async () => {
  const alpha = 'abcdef12-0000-4000-8000-000000000001';
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [alpha, org, '20000000-0000-4000-8000-000000000002', owner],
  );
  await service.save(c, alpha.toUpperCase(), declaration, 1);
  expect((await service.detail(c, alpha)).declaration).toEqual(declaration);
  const request = await service.requestHelp(c, alpha, {
    message: 'CÂU HỎI GIẢ LẬP',
    accepted: true,
  });
  await service.reply(staff, request.id.toUpperCase(), { message: 'PHẢN HỒI GIẢ LẬP' }, 1);
  expect((await service.detail(c, alpha)).requests[0]?.reply).toBe('PHẢN HỒI GIẢ LẬP');
});

const project = '20000000-0000-4000-8000-000000000001';
let legalRelease = '',
  mapping = '',
  generated = '';
it('counts only clean owned dossier evidence and approved current-version PDFs from the verified source', async () => {
  const { randomUUID } = await import('node:crypto');
  const { AssistanceService } = await import('./assistance-service');
  const source = (await new AssistanceService(db).catalog()).forms[0]!;
  const documentId = randomUUID();
  await db.query(
    "INSERT INTO documents(id,organization_id,project_id,dossier_id,owner_user_id,object_key,sha256,mime,type,scan_status) VALUES($1,$2,$3,$4,$5,$6,$7,'application/pdf','identity','quarantined')",
    [documentId, org, project, id, owner, 'SYNTHETIC-' + documentId, 'a'.repeat(64)],
  );
  expect((await service.detail(c, id)).readiness.score).toBe(45);
  await db.query(
    "UPDATE documents SET scan_status='clean',scanned_at=now(),version=version+1 WHERE id=$1",
    [documentId],
  );
  expect((await service.detail(c, id)).readiness.score).toBe(80);
  legalRelease = randomUUID();
  mapping = randomUUID();
  generated = randomUUID();
  await db.query(
    "INSERT INTO project_form_releases(id,organization_id,project_id,form_id,title,source_hash,catalog_version,recipient,instructions,mode,subject_group,created_by,status,approved_by,approved_at,effective_from,version) VALUES($1,$2,$3,$4,'MẪU GIẢ LẬP TEST',$5,'test','TEST','TEST','buy',5,'editor','approved','reviewer',now(),'2020-01-01',1)",
    [legalRelease, org, project, source.id, source.sha256],
  );
  await db.query(
    "INSERT INTO form_field_mappings(id,organization_id,project_id,release_id,form_id,source_hash,payload,content_hash,version,created_by,status,approved_by,approved_at,effective_from) VALUES($1,$2,$3,$4,$5,$6,'{}',$6,1,'editor','approved','reviewer',now(),'2020-01-01')",
    [mapping, org, project, legalRelease, source.id, source.sha256],
  );
  await db.query(
    "INSERT INTO generated_forms(id,organization_id,project_id,dossier_id,owner_user_id,mapping_id,input_version,inputs_cipher,input_hash,object_key,envelope_key_cipher,sha256,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,3,'SYNTHETIC',$7,$8,'SYNTHETIC',$7,'confirmed',now())",
    [generated, org, project, id, owner, mapping, 'b'.repeat(64), 'SYNTHETIC-' + generated],
  );
  const ready = (await service.detail(c, id)).readiness;
  expect(ready.score).toBe(100);
  expect(ready.inputVersion).toBe(3);
  expect(ready.items.find((i) => i.code === 'forms')?.evidence[0]).toMatchObject({
    id: generated,
    mappingId: mapping,
    releaseId: legalRelease,
    sha256: 'b'.repeat(64),
  });
  await service.assess(c, id, 3);
  await service.save(c, id, { ...declaration, occupation: 'BẢN KHAI MỚI GIẢ LẬP' }, 3);
  const stale = (await service.detail(c, id)).readiness;
  expect(stale.score).toBe(80);
  expect(stale.items.find((i) => i.code === 'forms')?.reasonCode).toBe('form-input-stale');
  const [snapshot] = await db.query(
    'SELECT result_json FROM readiness_assessments WHERE score=100',
  );
  expect(
    (snapshot!.result_json as { items: { evidence: { id: string }[] }[] }).items.some((i) =>
      i.evidence.some((e) => e.id === generated),
    ),
  ).toBe(true);
  await db.query('UPDATE documents SET deleted_at=now(),version=version+1 WHERE id=$1', [
    documentId,
  ]);
  expect((await service.detail(c, id)).readiness.score).toBe(45);
});

it('excludes documents and generated forms belonging to another account or dossier', async () => {
  const { randomUUID } = await import('node:crypto');
  const otherUser = randomUUID(),
    otherDossier = 'abcdef12-0000-4000-8000-000000000001',
    form = randomUUID();
  await db.query('INSERT INTO users(id,organization_id) VALUES($1,$2)', [otherUser, org]);
  for (const [dossier, user] of [
    [id, otherUser],
    [otherDossier, owner],
  ]) {
    const d = randomUUID();
    await db.query(
      "INSERT INTO documents(id,organization_id,project_id,dossier_id,owner_user_id,object_key,sha256,mime,type,scan_status,scanned_at) VALUES($1,$2,$3,$4,$5,$6,$7,'application/pdf','identity','clean',now())",
      [
        d,
        org,
        dossier === id ? project : '20000000-0000-4000-8000-000000000002',
        dossier,
        user,
        'SYNTHETIC-' + d,
        'c'.repeat(64),
      ],
    );
  }
  await db.query(
    "INSERT INTO generated_forms(id,organization_id,project_id,dossier_id,owner_user_id,mapping_id,input_version,inputs_cipher,input_hash,object_key,envelope_key_cipher,sha256,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,4,'SYNTHETIC',$7,$8,'SYNTHETIC',$7,'confirmed',now())",
    [form, org, project, id, otherUser, mapping, 'd'.repeat(64), 'SYNTHETIC-' + form],
  );
  expect((await service.detail(c, id)).readiness.score).toBe(45);
  await expect(service.detail({ ...c, userId: otherUser }, id)).rejects.toMatchObject({
    status: 404,
  });
});

it('does not reuse a revoked or superseded source mapping', async () => {
  await db.query("UPDATE form_field_mappings SET status='revoked' WHERE id=$1", [mapping]);
  const r = (await service.detail(c, id)).readiness;
  expect(r.items.find((i) => i.code === 'forms')?.reasonCode).toBe('form-template-inactive');
  expect(r.items.find((i) => i.code === 'forms')?.evidence).toEqual([]);
});

it('invalidates superseded mappings, mismatched source hashes and replaced legal releases', async () => {
  const { randomUUID } = await import('node:crypto');
  const { AssistanceService } = await import('./assistance-service');
  const source = (await new AssistanceService(db).catalog()).forms[0]!;
  async function addMapping(version: number, hash = source.sha256) {
    const mid = randomUUID(),
      fid = randomUUID();
    await db.query(
      "INSERT INTO form_field_mappings(id,organization_id,project_id,release_id,form_id,source_hash,payload,content_hash,version,created_by,status,approved_by,approved_at,effective_from) VALUES($1,$2,$3,$4,$5,$6,'{}',$7,$8,'editor','approved','reviewer',now(),'2020-01-01')",
      [mid, org, project, legalRelease, source.id, hash, 'e'.repeat(64), version],
    );
    await db.query(
      "INSERT INTO generated_forms(id,organization_id,project_id,dossier_id,owner_user_id,mapping_id,input_version,inputs_cipher,input_hash,object_key,envelope_key_cipher,sha256,status,confirmed_at) VALUES($1,$2,$3,$4,$5,$6,4,'SYNTHETIC',$7,$8,'SYNTHETIC',$7,'confirmed',now())",
      [fid, org, project, id, owner, mid, 'e'.repeat(64), 'SYNTHETIC-' + fid],
    );
    return mid;
  }
  const valid = await addMapping(2);
  expect((await service.detail(c, id)).readiness.items.find((i) => i.code === 'forms')?.done).toBe(
    true,
  );
  await addMapping(3, 'f'.repeat(64));
  const changed = (await service.detail(c, id)).readiness.items.find((i) => i.code === 'forms');
  expect(changed?.done).toBe(false);
  expect(changed?.reasonCode).toBe('form-template-inactive');
  expect(changed?.evidence.some((e) => e.mappingId === valid)).toBe(false);
  await addMapping(4);
  expect((await service.detail(c, id)).readiness.items.find((i) => i.code === 'forms')?.done).toBe(
    true,
  );
  await db.query(
    "INSERT INTO project_form_releases(id,organization_id,project_id,form_id,title,source_hash,catalog_version,recipient,instructions,mode,subject_group,created_by,status,approved_by,approved_at,effective_from,version) VALUES($1,$2,$3,$4,'NGUỒN THAY THẾ GIẢ LẬP',$5,'test','TEST','TEST','buy',5,'editor','approved','reviewer',now(),'2020-01-01',2)",
    [randomUUID(), org, project, source.id, source.sha256],
  );
  expect((await service.detail(c, id)).readiness.items.find((i) => i.code === 'forms')?.done).toBe(
    false,
  );
});

it('versions project preparation guidance, separates author/reviewer and retains the exact assessed snapshot', async () => {
  const input = {
    title: 'CHECKLIST CHUẨN BỊ GIẢ LẬP',
    instructions: 'Chỉ dùng kiểm thử chuẩn bị, không xác định điều kiện pháp lý.',
    sourceReference: 'Nguồn giả lập phục vụ kiểm thử',
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    documentTypes: ['identity', 'income'],
    formIds: ['any'],
  };
  const review: Staff = {
    ...staff,
    subject: 'independent-reviewer',
    permissions: ['form_legal_approver'],
  };
  const author: Staff = { ...staff, permissions: ['form_legal_approver'] };
  const first = await service.draftChecklist(author, project, input);
  expect((await service.detail(c, id)).readiness.configurationState).toBe('generic');
  await expect(
    service.reviewChecklist(author, project, first.id, { action: 'approve', accepted: true }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.reviewChecklist({ ...review, permissions: [] }, project, first.id, {
      action: 'approve',
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.checklists({ ...staff, role: 'staff', projectIds: [] }, project),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.checklists(
      { ...staff, organizationId: '10000000-0000-4000-8000-000000000099' },
      project,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await service.reviewChecklist(review, project, first.id, { action: 'approve', accepted: true });
  const r = await service.assess(c, id, 4);
  expect(r.checklist?.id).toBe(first.id);
  expect(r.checklist?.version).toBe(1);
  expect(r.missing).toContain('document:income');
  await expect(
    db.query("UPDATE project_preparation_checklists SET payload='{}' WHERE id=$1", [first.id]),
  ).rejects.toThrow();
  const expired = await service.draftChecklist(author, project, {
    ...input,
    effectiveFrom: '2020-01-01',
    effectiveTo: '2020-12-31',
  });
  await service.reviewChecklist(review, project, expired.id, { action: 'approve', accepted: true });
  expect((await service.detail(c, id)).readiness.configurationState).toBe('unavailable');
  const current = await service.draftChecklist(author, project, input);
  await service.reviewChecklist(review, project, current.id, { action: 'approve', accepted: true });
  expect((await service.detail(c, id)).readiness.checklist?.version).toBe(3);
  await service.reviewChecklist(review, project, current.id, { action: 'revoke', accepted: true });
  const unavailable = (await service.detail(c, id)).readiness;
  expect(unavailable.configurationState).toBe('unavailable');
  expect(unavailable.checklist?.id).toBe(current.id);
  expect(
    unavailable.items
      .filter((i) => i.category === 'documents')
      .every((i) => i.reasonCode === 'checklist-unavailable'),
  ).toBe(true);
  const [snapshot] = await db.query(
    'SELECT result_json FROM readiness_assessments WHERE checklist_version=$1 ORDER BY created_at DESC LIMIT 1',
    [first.id + ':1'],
  );
  expect((snapshot!.result_json as { checklist: { id: string } }).checklist.id).toBe(first.id);
});

it('reloads project grants and reviewer permissions instead of trusting stale staff claims', async () => {
  const { randomUUID } = await import('node:crypto');
  const employee = randomUUID(),
    subject = 'SYNTHETIC-CHECKLIST-REVIEWER';
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,'NHÂN SỰ GIẢ LẬP','legal','active',ARRAY['form_legal_approver'])",
    [employee, org, subject],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, employee, project],
  );
  const reviewer: Staff = {
    organizationId: org,
    subject,
    role: 'staff',
    permissions: ['form_legal_approver'],
    projectIds: [project],
  };
  expect((await service.checklists(reviewer, project)).items.length).toBeGreaterThan(0);
  await expect(
    service.draftChecklist(reviewer, project, {
      title: 'NHÁP GIẢ LẬP',
      instructions: 'Nội dung thử nghiệm không phải chính sách pháp lý',
      sourceReference: 'TEST ONLY',
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      documentTypes: ['any'],
      formIds: ['any'],
    }),
  ).rejects.toMatchObject({ status: 403 });
  await db.query('DELETE FROM investor_employee_projects WHERE employee_id=$1', [employee]);
  await expect(service.checklists(reviewer, project)).rejects.toMatchObject({ status: 403 });
});
