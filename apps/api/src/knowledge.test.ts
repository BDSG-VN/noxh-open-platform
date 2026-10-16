import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KnowledgeService } from './knowledge-service';
import { Database } from './database';
import { DossierService } from './dossier-service';
import { AssistanceService } from './assistance-service';
import { OpenAiService, OpenAiTransport } from './openai-service';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff } from './workforce';

const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001';
const c = { organizationId: org, userId: '30000000-0000-4000-8000-000000000001' },
  s: Staff = { organizationId: org, subject: 'synthetic-editor', role: 'org_admin' },
  reviewer: Staff = { ...s, subject: 'synthetic-reviewer', permissions: ['form_legal_approver'] };
const base = {
  title: 'Hướng dẫn hồ sơ thuê',
  content:
    'HƯỚNG DẪN GIẢ LẬP. Người thuê chuẩn bị giấy tờ theo hướng dẫn của dự án; bản này chỉ dùng kiểm thử, không phải quy định pháp luật.',
  sourceUrl: 'https://vanban.chinhphu.vn/',
  sourceHash: 'a'.repeat(64),
  legalBasis: 'NGUỒN GIẢ LẬP PHỤC VỤ KIỂM THỬ',
  mode: 'rent',
  group: 5,
  effectiveFrom: '2020-01-01',
  effectiveTo: null,
  reviewedSource: true,
};
let pg: PGlite, db: Database, service: KnowledgeService;
const before = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'c'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  await seedSyntheticPrivacy(db, [c]);
  service = new KnowledgeService(db);
  await pg.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES('60000000-0000-4000-8000-000000000001',$1,$2,'KIỂM THỬ','legal','active',ARRAY['form_legal_approver']),('60000000-0000-4000-8000-000000000002',$1,$3,'KIỂM THỬ','legal','active',ARRAY['form_legal_approver'])",
    [org, reviewer.subject, s.subject],
  );
  await pg.query(
    "INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,'60000000-0000-4000-8000-000000000001',$2),($1,'60000000-0000-4000-8000-000000000002',$2)",
    [org, project],
  );
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = before;
});

it('encrypts immutable drafts, requires government source and independent active reviewer', async () => {
  await expect(
    service.draft(s, project, { ...base, sourceUrl: 'https://example.test/' }),
  ).rejects.toMatchObject({ status: 400 });
  const row = await service.draft(s, project, base);
  const [stored] = await db.query(
    'SELECT content_cipher FROM identity_private.project_knowledge_revisions WHERE id=$1',
    [row.id],
  );
  expect(stored?.content_cipher).not.toContain('HƯỚNG DẪN');
  expect(
    (await service.search(c, dossier, { query: 'hồ sơ thuê', mode: 'rent', group: 5 })).items,
  ).toHaveLength(0);
  await expect(
    service.review(s, project, row.id, { action: 'approve', accepted: true }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.review({ ...reviewer, subject: 'synthetic-unassigned' }, project, row.id, {
      action: 'approve',
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await service.review(reviewer, project, row.id, { action: 'approve', accepted: true });
  await expect(
    db.query("UPDATE identity_private.project_knowledge_revisions SET title='tamper' WHERE id=$1", [
      row.id,
    ]),
  ).rejects.toThrow();
});
it('retrieves accent-free Vietnamese by exact project/mode/group; unknown scope does not leak other branches', async () => {
  const r = await service.search(c, dossier, { query: 'ho so thue', mode: 'rent', group: 5 });
  expect(r.items[0]?.title).toBe(base.title);
  expect(r.items[0]?.id).toBe('K1');
  expect(r.items[0]?.sourceHash).toBe(base.sourceHash);
  expect(
    (await service.search(c, dossier, { query: 'hồ sơ thuê', mode: 'buy', group: 5 })).items,
  ).toHaveLength(0);
  expect(
    (await service.search(c, dossier, { query: 'hồ sơ thuê', mode: 'rent', group: 4 })).items,
  ).toHaveLength(0);
  expect((await service.search(c, dossier, { query: 'hồ sơ thuê' })).items).toHaveLength(0);
  await expect(
    service.search({ ...c, userId: '30000000-0000-4000-8000-000000000099' }, dossier, {
      query: 'thuê',
    }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.search({ ...c, organizationId: '10000000-0000-4000-8000-000000000099' }, dossier, {
      query: 'thuê',
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it('withdrawn latest version cannot resurrect an older version; future and expired sources stay out', async () => {
  const row = (await service.list(s, project)).items[0]!;
  const next = await service.draft(s, project, {
    ...base,
    recordId: row.recordId,
    content: base.content + ' BẢN 2.',
  });
  await service.review(reviewer, project, next.id, { action: 'approve', accepted: true });
  expect(
    (await service.search(c, dossier, { query: 'thuê', mode: 'rent', group: 5 })).items[0]
      ?.revision,
  ).toBe(2);
  await service.review(reviewer, project, next.id, { action: 'revoke', accepted: true });
  expect(
    (await service.search(c, dossier, { query: 'thuê', mode: 'rent', group: 5 })).items,
  ).toHaveLength(0);
  for (const dates of [
    { effectiveFrom: '2999-01-01', effectiveTo: null },
    { effectiveFrom: '2020-01-01', effectiveTo: '2020-01-02' },
  ]) {
    const r = await service.draft(s, project, { ...base, ...dates });
    await service.review(reviewer, project, r.id, { action: 'approve', accepted: true });
  }
  expect(
    (await service.search(c, dossier, { query: 'thuê', mode: 'rent', group: 5 })).items,
  ).toHaveLength(0);
});

class Fake extends OpenAiTransport {
  answer = 'Hãy đọc hướng dẫn [K1].';
  seen: Record<string, unknown>[] = [];
  hook?: () => Promise<void>;
  override async respond(_key: string, body: Record<string, unknown>) {
    this.seen.push(structuredClone(body));
    await this.hook?.();
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: this.answer }] }] };
  }
}
it('RAG exposes versioned citations and blocks invented source IDs without claiming semantic verification', async () => {
  const row = await service.draft(s, project, { ...base, mode: 'all', group: null });
  await service.review(reviewer, project, row.id, { action: 'approve', accepted: true });
  const transport = new Fake(),
    ai = new OpenAiService(db, new DossierService(db), new AssistanceService(db), transport);
  process.env.EXTERNAL_AI_ENABLED = 'true';
  await ai.configure(
    s,
    {
      enabled: true,
      model: 'synthetic-no-network',
      dailyLimit: 100,
      apiKey: 'synthetic-test-key-never-used-on-network',
    },
    0,
  );
  const first = await ai.ask(c, dossier, {
    message: 'Hồ sơ thuê',
    accepted: true,
    shareDeclaration: false,
  });
  expect(first.citations[0]?.revisionId).toBe(row.id);
  expect(first.retrieval.semanticClaimsVerified).toBe(false);
  expect(first.answer).toContain('[K1]');
  expect(JSON.stringify(transport.seen[0]?.input)).toContain('approvedKnowledge');
  expect(JSON.stringify(transport.seen[0]?.input)).not.toContain('fullName');
  transport.answer = 'Nguồn giả [K99]';
  expect(
    (await ai.ask(c, dossier, { message: 'Hồ sơ thuê', accepted: true, shareDeclaration: false }))
      .retrieval.citationValidation,
  ).toBe('rejected-unknown-source');
  transport.hook = () =>
    service
      .review(reviewer, project, row.id, { action: 'revoke', accepted: true })
      .then(() => undefined);
  await expect(
    ai.ask(c, dossier, { message: 'Hồ sơ thuê', accepted: true, shareDeclaration: false }),
  ).rejects.toMatchObject({ status: 409 });
});
