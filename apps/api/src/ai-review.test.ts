/** Independent integration regressions from the completion review. Synthetic data only;
 * the transport is in-process and never contacts an AI or messaging provider. */
import 'reflect-metadata';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
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
import { KnowledgeService } from './knowledge-service';
import { PrivacyService } from './privacy-service';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001';
const citizen = { organizationId: org, userId: '30000000-0000-4000-8000-000000000001' };
const author: Staff = {
    organizationId: org,
    subject: 'SYNTHETIC REVIEW AUTHOR',
    role: 'org_admin',
  },
  reviewer: Staff = {
    ...author,
    subject: 'SYNTHETIC INDEPENDENT REVIEWER',
    permissions: ['form_legal_approver'],
  };
class Store extends DocumentStorage {
  objects = new Map<string, Uint8Array>();
  override async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
  override async get(key: string) {
    const bytes = this.objects.get(key);
    if (!bytes) throw Error('missing synthetic object');
    return Buffer.from(bytes);
  }
}
class Script extends OpenAiTransport {
  requests: Record<string, unknown>[] = [];
  hook?: () => Promise<void>;
  mapping = '';
  override async respond(_key: string, body: Record<string, unknown>) {
    this.requests.push(structuredClone(body));
    await this.hook?.();
    return this.mapping
      ? {
          output: [
            {
              type: 'function_call',
              call_id: randomUUID(),
              name: 'propose_form_draft',
              arguments: JSON.stringify({ mappingId: this.mapping }),
            },
          ],
        }
      : {
          output: [
            {
              type: 'message',
              content: [
                { type: 'output_text', text: 'Trả lời giả lập, không phải tư vấn pháp luật.' },
              ],
            },
          ],
        };
  }
}
let pg: PGlite,
  db: Database,
  forms: FormService,
  ai: OpenAiService,
  transport: Script,
  privacy: PrivacyService,
  knowledge: KnowledgeService,
  mapping: string;
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.EXTERNAL_AI_ENABLED = 'true';
  pg = new PGlite();
  for (const file of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', file), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (sql, values = []) => ({
      rows: (await pg.query<Record<string, unknown>>(sql, values)).rows,
    }),
  };
  await seedSyntheticPrivacy(db, [citizen]);
  const dossiers = new DossierService(db),
    assistance = new AssistanceService(db),
    storage = new Store();
  privacy = new PrivacyService(db);
  knowledge = new KnowledgeService(db);
  transport = new Script();
  ai = new OpenAiService(db, dossiers, assistance, transport, {
    get: () => forms,
  } as unknown as ModuleRef);
  forms = new FormService(
    db,
    assistance,
    storage,
    new DocumentService(db, assistance, storage, new DocumentScanner(), ai, privacy),
    privacy,
  );
  await ai.configure(
    author,
    {
      enabled: true,
      model: 'synthetic-no-network',
      dailyLimit: 100,
      apiKey: 'synthetic-only-never-provider-credential',
    },
    0,
  );
  await dossiers.save(
    citizen,
    dossier,
    { ...emptyDeclaration, fullName: 'NGƯỜI GIẢ LẬP ĐỘC LẬP' },
    1,
  );
  const release = await assistance.publish(author, project, {
    formId: 'nd100-application-01',
    recipient: 'ĐƠN VỊ GIẢ LẬP',
    instructions: 'CHỈ DÙNG KIỂM THỬ. Không phải hướng dẫn pháp lý.',
    mode: 'buy',
    group: 5,
    reviewed: true,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
  });
  await assistance.review(reviewer, project, release.id, { action: 'approve', accepted: true });
  mapping = (
    await forms.draft(author, project, {
      releaseId: release.id,
      title: 'MẪU GIẢ LẬP',
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
      ],
      effectiveFrom: '2020-01-01',
      effectiveTo: null,
      reviewedCoordinates: true,
    })
  ).id;
  await forms.review(reviewer, project, mapping, { action: 'approve', accepted: true });
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});

it('requires organization administration before changing provider credentials or global AI limits', async () => {
  await expect(
    ai.configure(
      { ...author, role: 'staff', permissions: [], projectIds: [project] },
      { enabled: false, model: 'synthetic-other', dailyLimit: 1 },
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect((await ai.settings(author)).version).toBe(1);
});

it('rejects a valid project mapping if the citizen selected another tenure or group, or did not select a scope', async () => {
  transport.mapping = mapping;
  for (const scope of [
    { mode: 'rent', group: 5 },
    { mode: 'buy', group: 6 },
    { mode: null, group: null },
  ]) {
    await expect(
      ai.ask(citizen, dossier, {
        message: 'Tạo PDF nháp giả lập',
        accepted: true,
        shareDeclaration: false,
        ...scope,
      }),
    ).rejects.toBeDefined();
  }
  expect(
    (await db.query('SELECT count(*)::int AS n FROM identity_private.ai_proposals'))[0]?.n,
  ).toBe(0);
  expect((await db.query('SELECT count(*)::int AS n FROM generated_forms'))[0]?.n).toBe(0);
  transport.mapping = '';
});

it('withdrawal during a provider response prevents proposals even though the transport already returned', async () => {
  transport.mapping = mapping;
  transport.hook = async () => {
    transport.hook = undefined;
    await privacy.withdraw(citizen);
  };
  await expect(
    ai.ask(citizen, dossier, {
      message: 'Tạo PDF giả lập',
      accepted: true,
      shareDeclaration: false,
      mode: 'buy',
      group: 5,
    }),
  ).rejects.toBeDefined();
  expect(
    (await db.query('SELECT count(*)::int AS n FROM identity_private.ai_proposals'))[0]?.n,
  ).toBe(0);
  expect((await db.query('SELECT count(*)::int AS n FROM generated_forms'))[0]?.n).toBe(0);
  transport.mapping = '';
  await seedSyntheticPrivacy(db, [citizen]);
});

it('changing a reviewed document to another mode prevents resurrection in its previous mode', async () => {
  const employee = randomUUID();
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,'NHÂN SỰ GIẢ LẬP','legal','active',ARRAY['form_legal_approver'])",
    [employee, org, reviewer.subject],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, employee, project],
  );
  const base = {
    title: 'Tài liệu thuê giả lập',
    content:
      'NỘI DUNG GIẢ LẬP. Thủ tục thuê có hướng dẫn riêng, không dùng làm quy định pháp luật hoặc lời khuyên tài chính.',
    sourceUrl: 'https://vanban.chinhphu.vn/',
    sourceHash: 'b'.repeat(64),
    legalBasis: 'CHỈ LÀ DỮ LIỆU KIỂM THỬ',
    mode: 'rent',
    group: 5,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    reviewedSource: true,
  };
  const first = await knowledge.draft(author, project, base);
  await knowledge.review(reviewer, project, first.id, { action: 'approve', accepted: true });
  expect(
    (await knowledge.search(citizen, dossier, { query: 'thuê', mode: 'rent', group: 5 })).items
      .length,
  ).toBeGreaterThan(0);
  const next = await knowledge.draft(author, project, {
    ...base,
    recordId: first.recordId,
    mode: 'buy',
  });
  await knowledge.review(reviewer, project, next.id, { action: 'approve', accepted: true });
  expect(
    (await knowledge.search(citizen, dossier, { query: 'thuê', mode: 'rent', group: 5 })).items,
  ).toEqual([]);
  await expect(
    knowledge.search(citizen, dossier, {
      query: 'thuê',
      projectId: project,
      mode: 'buy',
      group: 5,
    }),
  ).rejects.toMatchObject({ status: 400 });
});
