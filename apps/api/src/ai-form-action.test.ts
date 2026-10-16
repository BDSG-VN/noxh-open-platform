import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ModuleRef } from '@nestjs/core';
import { emptyDeclaration } from '@noxh/contracts';
import { Database } from './database';
import { DossierService } from './dossier-service';
import { AssistanceService } from './assistance-service';
import { OpenAiService, OpenAiTransport } from './openai-service';
import { FormService } from './form-service';
import { DocumentService } from './document-service';
import { DocumentStorage } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { PrivacyService } from './privacy-service';
import { seedSyntheticPrivacy } from './test-privacy';
import { seal } from './identity-crypto';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001';
const c = { organizationId: org, userId: '30000000-0000-4000-8000-000000000001' },
  s: Staff = { organizationId: org, subject: 'synthetic-editor', role: 'org_admin' },
  reviewer: Staff = { ...s, subject: 'synthetic-reviewer', permissions: ['form_legal_approver'] };
class Store extends DocumentStorage {
  objects = new Map<string, Uint8Array>();
  override async put(k: string, b: Uint8Array) {
    this.objects.set(k, b);
  }
  override async get(k: string) {
    return Buffer.from(this.objects.get(k)!);
  }
}
class Transport extends OpenAiTransport {
  mapping = '';
  calls = 0;
  requests: Record<string, unknown>[] = [];
  override async respond(_k: string, b: Record<string, unknown>) {
    this.requests.push(structuredClone(b));
    return ++this.calls % 2 === 1
      ? {
          output: [
            {
              type: 'function_call',
              call_id: 'synthetic-form-call',
              name: 'propose_form_draft',
              arguments: JSON.stringify({ mappingId: this.mapping }),
            },
          ],
        }
      : {
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'Bản nháp đang chờ bạn xác nhận.' }],
            },
          ],
        };
  }
}
let pg: PGlite,
  db: Database,
  dossiers: DossierService,
  forms: FormService,
  ai: OpenAiService,
  transport: Transport,
  mapping: string,
  assistance: AssistanceService;
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.EXTERNAL_AI_ENABLED = 'true';
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  await seedSyntheticPrivacy(db, [c]);
  dossiers = new DossierService(db);
  assistance = new AssistanceService(db);
  transport = new Transport();
  const modules = { get: () => forms } as unknown as ModuleRef;
  ai = new OpenAiService(db, dossiers, assistance, transport, modules);
  const storage = new Store(),
    privacy = new PrivacyService(db),
    docs = new DocumentService(db, assistance, storage, new DocumentScanner(), ai, privacy);
  forms = new FormService(db, assistance, storage, docs, privacy);
  await ai.configure(
    s,
    {
      enabled: true,
      model: 'synthetic-no-network',
      dailyLimit: 100,
      apiKey: 'synthetic-api-key-never-sent-to-network',
    },
    0,
  );
  await dossiers.save(c, dossier, { ...emptyDeclaration, fullName: 'NGƯỜI KHAI GIẢ LẬP' }, 1);
  const release = await assistance.publish(s, project, {
    formId: 'nd100-application-01',
    recipient: 'ĐƠN VỊ GIẢ LẬP',
    instructions: 'HƯỚNG DẪN KIỂM THỬ, KHÔNG SỬ DỤNG CHO HỒ SƠ THẬT',
    mode: 'buy',
    group: 5,
    reviewed: true,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
  });
  await assistance.review(reviewer, project, release.id, { action: 'approve', accepted: true });
  mapping = (
    await forms.draft(s, project, {
      releaseId: release.id,
      title: 'ÁNH XẠ GIẢ LẬP',
      fields: [
        {
          key: 'fullName',
          label: 'Họ tên',
          page: 1,
          x: 100,
          y: 100,
          width: 300,
          height: 30,
          fontSize: 11,
          required: true,
          externalConfirmation: false,
        },
        {
          key: 'issuer',
          label: 'Xác nhận cơ quan',
          page: 1,
          x: 100,
          y: 140,
          width: 300,
          height: 30,
          fontSize: 11,
          required: false,
          externalConfirmation: true,
        },
        {
          key: 'identityNumber',
          label: 'Số giấy tờ',
          page: 1,
          x: 100,
          y: 180,
          width: 300,
          height: 30,
          fontSize: 11,
          required: false,
          externalConfirmation: false,
        },
      ],
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      reviewedCoordinates: true,
    })
  ).id;
  await forms.review(reviewer, project, mapping, { action: 'approve', accepted: true });
  transport.mapping = mapping;
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
const question = {
  message: 'Tạo bản nháp mẫu hồ sơ cho tôi',
  accepted: true,
  shareDeclaration: false,
  mode: 'buy',
  group: 5,
};
it('derives values on server, leaves attestations blank, creates nothing until confirmation then consumes atomically', async () => {
  const r = await ai.ask(c, dossier, question),
    p = r.proposals[0]!;
  expect(p.kind).toBe('form');
  expect(p.payload).toMatchObject({
    values: { fullName: 'NGƯỜI KHAI GIẢ LẬP', issuer: '', identityNumber: '' },
  });
  expect((await db.query('SELECT count(*)::int AS n FROM generated_forms'))[0]?.n).toBe(0);
  expect(JSON.stringify(transport.requests)).not.toContain('NGƯỜI KHAI GIẢ LẬP');
  const results = await Promise.allSettled([
    ai.confirm(c, dossier, p.id, { accepted: true }),
    ai.confirm(c, dossier, p.id, { accepted: true }),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const [generated] = await db.query('SELECT id,status FROM generated_forms');
  expect(generated?.status).toBe('draft');
  const detail = await forms.detail(c, dossier, String(generated?.id));
  expect(detail.values).toMatchObject({ fullName: 'NGƯỜI KHAI GIẢ LẬP', issuer: '' });
  expect(
    (await forms.download(c, dossier, String(generated?.id))).bytes.subarray(0, 4).toString(),
  ).toBe('%PDF');
  await expect(
    ai.confirm({ ...c, userId: '30000000-0000-4000-8000-000000000099' }, dossier, p.id, {
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 404 });
});
it('reads only current accepted clean extraction; conflicts stay blank instead of overwriting declarations', async () => {
  const document = '70000000-0000-4000-8000-000000000001',
    extraction = '80000000-0000-4000-8000-000000000001';
  await db.query(
    "INSERT INTO documents(id,organization_id,project_id,dossier_id,owner_user_id,type,object_key,sha256,mime,scan_status) VALUES($1,$2,$3,$4,$5,'identity','synthetic-object',$6,'application/pdf','clean')",
    [document, org, project, dossier, c.userId, 'b'.repeat(64)],
  );
  const fields = [
    {
      key: 'fullName',
      label: 'Họ tên',
      value: 'TÊN KHÁC GIẢ LẬP',
      page: 1,
      confidence: 1,
      evidence: 'KIỂM THỬ',
    },
    {
      key: 'identityNumber',
      label: 'Số giấy tờ',
      value: 'SYNTHETIC-ID-NOT-REAL',
      page: 1,
      confidence: 1,
      evidence: 'KIỂM THỬ',
    },
  ];
  await db.query(
    "INSERT INTO document_extractions(id,organization_id,dossier_id,owner_user_id,document_id,source_hash,input_version,payload_cipher,model,accepted_cipher,accepted_at) VALUES($1,$2,$3,$4,$5,$6,2,$7,'synthetic',$8,now())",
    [
      extraction,
      org,
      dossier,
      c.userId,
      document,
      'b'.repeat(64),
      seal(
        JSON.stringify({ fields, warnings: [] }),
        'extraction:' + org + ':' + c.userId + ':' + extraction,
      ),
      seal(
        JSON.stringify(fields),
        'accepted-extraction:' + org + ':' + c.userId + ':' + extraction,
      ),
    ],
  );
  const p = await forms.prepareFromEvidence(c, dossier, mapping, 2, { mode: 'buy', group: 5 });
  expect(p.values.fullName).toBe('');
  expect(p.values.identityNumber).toBe('SYNTHETIC-ID-NOT-REAL');
  expect(p.evidenceIds).toEqual([document]);
  expect(p.warnings.some((w) => w.includes('khác nhau'))).toBe(true);
  const stale = (await ai.ask(c, dossier, question)).proposals[0]!;
  await db.query("UPDATE documents SET scan_status='quarantined' WHERE id=$1", [document]);
  await expect(ai.confirm(c, dossier, stale.id, { accepted: true })).rejects.toMatchObject({
    status: 409,
  });
  expect(
    (await forms.prepareFromEvidence(c, dossier, mapping, 2, { mode: 'buy', group: 5 })).values
      .identityNumber,
  ).toBe('');
});
it('rejects stale declaration and revoked mapping without consuming a proposal or generating another PDF', async () => {
  const p = (await ai.ask(c, dossier, question)).proposals[0]!;
  await dossiers.save(c, dossier, { ...emptyDeclaration, fullName: 'BẢN THAY ĐỔI GIẢ LẬP' }, 2);
  await expect(ai.confirm(c, dossier, p.id, { accepted: true })).rejects.toMatchObject({
    status: 409,
  });
  const fresh = (await ai.ask(c, dossier, question)).proposals[0]!;
  await forms.review(reviewer, project, mapping, { action: 'revoke', accepted: true });
  await expect(ai.confirm(c, dossier, fresh.id, { accepted: true })).rejects.toMatchObject({
    status: 409,
  });
  expect((await db.query('SELECT count(*)::int AS n FROM generated_forms'))[0]?.n).toBe(1);
  expect(
    (
      await db.query('SELECT consumed_at FROM identity_private.ai_proposals WHERE id=$1', [
        fresh.id,
      ])
    )[0]?.consumed_at,
  ).toBeNull();
});
