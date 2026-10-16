import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppModule } from './app';
import { configure } from './bootstrap';
import { Database } from './database';
import { ZaloDelivery } from './phone-service';
import { DocumentStorage } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { OpenAiService, OpenAiTransport } from './openai-service';
import { ZaloIdentityService, ZaloIdentityTransport } from './zalo-identity-service';
import { AdminService } from './admin-service';
import { AssistanceService } from './assistance-service';
import { FormService } from './form-service';
import { seedSyntheticPrivacy } from './test-privacy';
import { digest, seal } from './identity-crypto';
import {
  emptyDeclaration,
  type Declaration,
  type DossierDetail,
  type PrivacyWorkspace,
} from '@noxh/contracts';
import type { Staff } from './workforce';

const org = '10000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001',
  origin = 'https://mini.synthetic.example',
  providerToken = 'SYNTHETIC-MINIAPP-PROVIDER-TOKEN';
const citizen = { organizationId: org, userId: owner },
  staff: Staff = { organizationId: org, subject: 'SYNTHETIC AUTHOR', role: 'org_admin' },
  reviewer: Staff = {
    ...staff,
    subject: 'SYNTHETIC REVIEWER',
    permissions: ['form_legal_approver'],
  };
class MemoryStorage extends DocumentStorage {
  objects = new Map<string, Uint8Array>();
  override async put(key: string, bytes: Uint8Array) {
    this.objects.set(key, bytes);
  }
  override async get(key: string) {
    return Buffer.from(this.objects.get(key)!);
  }
  override async remove(key: string) {
    this.objects.delete(key);
  }
}
class TestScanner extends DocumentScanner {
  result: 'clean' | 'quarantined' = 'quarantined';
  override async scan() {
    return {
      status: this.result,
      engine: 'SYNTHETIC TEST ONLY',
      reason: 'synthetic contract result',
    };
  }
}
class Identity extends ZaloIdentityTransport {
  override async profile(token: string, secret: string) {
    if (token !== providerToken || secret !== 'SYNTHETIC-IDENTITY-SECRET-ONLY')
      throw Error('synthetic wrong provider token');
    return { subject: 'SYNTHETIC-ZALO-SUBJECT' };
  }
}
class Extraction extends OpenAiTransport {
  calls = 0;
  override async respond() {
    this.calls++;
    return {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                fields: [
                  {
                    key: 'fullName',
                    label: 'Họ tên',
                    value: 'TÊN GIẢ LẬP',
                    page: 1,
                    confidence: 0.8,
                    evidence: 'TÊN GIẢ LẬP',
                  },
                ],
                warnings: ['Đối chiếu giấy tờ gốc'],
              }),
            },
          ],
        },
      ],
    };
  }
}
interface Channel {
  exchange(token: string): Promise<{ sessionEstablished: boolean; needsLink?: boolean }>;
  requestPhone(phone: string, accepted: boolean): Promise<unknown>;
  verifyPhone(code: string): Promise<unknown>;
  startLink(accepted: boolean): Promise<unknown>;
  confirmLink(accepted: boolean): Promise<unknown>;
  dashboard(): Promise<{ dossiers: { id: string }[] }>;
  projects(): Promise<{ items: { id: string }[] }>;
  privacy(): Promise<PrivacyWorkspace>;
  acceptPrivacy(id: string, hash: string): Promise<unknown>;
  withdrawPrivacy(): Promise<unknown>;
  createDossier(project: string): Promise<{ id: string }>;
  dossier(id: string): Promise<DossierDetail>;
  saveDeclaration(id: string, data: Declaration, version: number): Promise<{ version: number }>;
  dossierAction<T>(id: string, resource: string, body?: unknown, method?: string): Promise<T>;
  file(id: string, resource: string): Promise<Blob>;
  logout(): Promise<void>;
}
let pg: PGlite,
  db: Database,
  app: INestApplication,
  channel: Channel,
  extraction: Extraction,
  scanner: TestScanner,
  sent = '',
  doc = '',
  mapping = '',
  generated = '',
  otherDossier = '',
  sameOwnerOtherDossier = '',
  version = 0;
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ORGANIZATION_ID = org;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  process.env.ZALO_MINIAPP_ENABLED = 'true';
  process.env.EXTERNAL_AI_ENABLED = 'true';
  process.env.ZALO_MINIAPP_ALLOWED_ORIGINS = origin;
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (sql, values = []) => ({
      rows: (await pg.query<Record<string, unknown>>(sql, values)).rows,
    }),
  };
  const delivery = new ZaloDelivery();
  delivery.send = async (_s, _p, code) => {
    sent = code;
  };
  extraction = new Extraction();
  scanner = new TestScanner();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Database)
    .useValue(db)
    .overrideProvider(ZaloDelivery)
    .useValue(delivery)
    .overrideProvider(DocumentStorage)
    .useValue(new MemoryStorage())
    .overrideProvider(DocumentScanner)
    .useValue(scanner)
    .overrideProvider(OpenAiTransport)
    .useValue(extraction)
    .overrideProvider(ZaloIdentityTransport)
    .useValue(new Identity())
    .compile();
  app = module.createNestApplication();
  configure(app);
  await app.init();
  await app.listen(0, '127.0.0.1');
  await db.query(
    'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
    [org, owner, digest('phone', org + ':84900000000'), seal('84900000000', 'phone:' + org)],
  );
  await new AdminService(db).saveSettings(
    staff,
    {
      enabled: true,
      oaId: 'SYNTHETIC-OA',
      appId: 'SYNTHETIC-DELIVERY',
      templateId: 'SYNTHETIC-TEMPLATE',
      otpParameter: 'otp',
      accessToken: 'SYNTHETIC-DELIVERY-TOKEN',
      appSecret: 'SYNTHETIC-DELIVERY-SECRET',
    },
    0,
  );
  await app
    .get(ZaloIdentityService)
    .configure(
      staff,
      { enabled: true, appId: '123456789', appSecret: 'SYNTHETIC-IDENTITY-SECRET-ONLY' },
      0,
    );
  await app.get(OpenAiService).configure(
    staff,
    {
      enabled: true,
      apiKey: 'SYNTHETIC-NONPROVIDER-KEY',
      model: 'SYNTHETIC-MODEL',
      dailyLimit: 20,
    },
    0,
  );
  await seedSyntheticPrivacy(db, [citizen]);
  // Dynamically load the actual Vite adapter without expanding the API TypeScript rootDir.
  const adapterPath = resolve('../zalo-miniapp/src/channel.ts');
  const { ZaloChannel } = (await import(adapterPath)) as {
    ZaloChannel: new (origin: string, send: typeof fetch) => Channel;
  };
  const bridge = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const verb = (init?.method ?? 'GET').toLowerCase() as
      | 'get'
      | 'post'
      | 'patch'
      | 'delete'
      | 'put';
    let req = request(app.getHttpServer())[verb](path).set('Origin', origin);
    for (const [key, value] of Object.entries(init?.headers ?? {}))
      req = req.set(key, String(value));
    if (init?.body) req = req.send(JSON.parse(String(init.body)));
    const r = await req.buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => done(null, Buffer.concat(chunks)));
      response.on('error', done);
    });
    if (r.headers['access-control-allow-origin'] !== origin)
      throw Error('CORS did not allow configured Mini App origin');
    const body = Buffer.isBuffer(r.body) ? new Uint8Array(r.body).buffer : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers: r.headers as Record<string, string> });
  }) as typeof fetch;
  channel = new ZaloChannel('https://api.synthetic.example', bridge);
}, 60000);
afterAll(async () => {
  await channel?.logout();
  await app?.close();
  await pg?.close();
  process.env = prior;
});

it('uses real CORS preflights and canonical phone linking before resuming the web dossier', async () => {
  const allowed = await request(app.getHttpServer())
    .options('/api/v1/dossiers/' + dossier + '/declarations')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'PATCH')
    .set('Access-Control-Request-Headers', 'authorization,content-type,if-match');
  expect(allowed.status).toBe(204);
  expect(allowed.headers['access-control-allow-origin']).toBe(origin);
  expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();
  expect(
    (
      await request(app.getHttpServer())
        .options('/api/v1/citizen/privacy')
        .set('Origin', 'https://wrong.example')
        .set('Access-Control-Request-Method', 'GET')
    ).status,
  ).toBe(403);
  expect(await channel.exchange(providerToken)).toMatchObject({
    sessionEstablished: false,
    needsLink: true,
  });
  await channel.requestPhone('0900000000', true);
  await channel.verifyPhone(sent);
  await channel.startLink(true);
  expect(await channel.confirmLink(true)).toMatchObject({ sessionEstablished: true });
  expect((await channel.dashboard()).dossiers.some((d) => d.id === dossier)).toBe(true);
  expect((await channel.projects()).items.some((p) => p.id === project)).toBe(true);
  expect((await channel.dossier(dossier)).id).toBe(dossier);
  expect(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM identity_private.citizen_sessions WHERE auth_method='phone-otp' AND revoked_at IS NULL",
      )
    )[0]?.n,
  ).toBe(0);
});
it('uses owner-scoped create and If-Match save, and refuses stale or foreign dossier references', async () => {
  const d = await channel.dossier(dossier);
  const saved = await channel.saveDeclaration(
    dossier,
    {
      ...emptyDeclaration,
      fullName: 'NGƯỜI GIẢ LẬP',
      dateOfBirth: '1990-01-01',
      address: 'ĐỊA CHỈ GIẢ LẬP',
      housingSituation: 'renting',
      confirmed: true,
    },
    d.version,
  );
  version = saved.version;
  await expect(
    channel.saveDeclaration(dossier, { ...emptyDeclaration, fullName: 'CŨ' }, d.version),
  ).rejects.toThrow();
  expect((await channel.createDossier(project)).id).toBe(dossier);
  sameOwnerOtherDossier = (await channel.createDossier('20000000-0000-4000-8000-000000000002')).id;
  const other = '30000000-0000-4000-8000-000000000099';
  otherDossier = '40000000-0000-4000-8000-000000000099';
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    other,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [otherDossier, org, project, other],
  );
  await expect(channel.dossier(otherDossier)).rejects.toThrow();
  await expect(channel.dossierAction(otherDossier, 'documents')).rejects.toThrow();
});
it('keeps upload quarantined, scans before downloads/extraction, requires per-file consent and accepts fields separately', async () => {
  const source = await app.get(AssistanceService).pdf('nd100-application-01');
  doc = (
    await channel.dossierAction<{ id: string }>(dossier, 'documents', {
      name: 'GIẢ LẬP.pdf',
      type: 'identity',
      mime: 'application/pdf',
      base64: source.bytes.toString('base64'),
    })
  ).id;
  await expect(channel.file(dossier, 'documents/' + doc + '/download')).rejects.toThrow('quét');
  await expect(
    channel.dossierAction(dossier, 'documents/' + doc + '/extract', {
      accepted: true,
      noticeVersion: 'document-extraction-v1',
    }),
  ).rejects.toThrow('quét');
  scanner.result = 'clean';
  await channel.dossierAction(dossier, 'documents/' + doc + '/scan', {});
  expect((await channel.file(dossier, 'documents/' + doc + '/download')).type).toBe(
    'application/pdf',
  );
  await expect(
    channel.dossierAction(dossier, 'documents/' + doc + '/extract', {
      accepted: false,
      noticeVersion: 'document-extraction-v1',
    }),
  ).rejects.toThrow();
  expect(extraction.calls).toBe(0);
  const x = await channel.dossierAction<{ id: string; fields: unknown[] }>(
    dossier,
    'documents/' + doc + '/extract',
    { accepted: true, noticeVersion: 'document-extraction-v1' },
  );
  expect(extraction.calls).toBe(1);
  await channel.dossierAction(dossier, 'extractions/' + x.id + '/accept', {
    accepted: true,
    fields: x.fields,
  });
  expect((await channel.dossier(dossier)).declaration.fullName).toBe('NGƯỜI GIẢ LẬP');
  await expect(
    channel.dossierAction(dossier, 'extractions/' + x.id + '/accept', {
      accepted: true,
      fields: x.fields,
    }),
  ).rejects.toThrow();
  await expect(channel.file(otherDossier, 'documents/' + doc + '/download')).rejects.toThrow();
  await expect(
    channel.file(sameOwnerOtherDossier, 'documents/' + doc + '/download'),
  ).rejects.toThrow();
});
it('uses reviewed mappings for draft, explicit field confirmation and a real owner ZIP; new declaration invalidates packet', async () => {
  const assistance = app.get(AssistanceService),
    forms = app.get(FormService);
  const release = await assistance.publish(staff, project, {
    formId: 'nd100-application-01',
    mode: 'buy',
    group: 5,
    recipient: 'GIẢ LẬP',
    instructions: 'Hướng dẫn giả lập không áp dụng cho hồ sơ thật',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    reviewed: true,
  });
  await assistance.review(reviewer, project, String(release.id), {
    accepted: true,
    action: 'approve',
  });
  mapping = (
    await forms.draft(staff, project, {
      releaseId: release.id,
      title: 'Ánh xạ giả lập',
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
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      reviewedCoordinates: true,
    })
  ).id;
  await forms.review(reviewer, project, mapping, { accepted: true, action: 'approve' });
  const workspace = await channel.dossierAction<{
    mappings: { id: string; title: string; fields: unknown[] }[];
    inputVersion: number;
  }>(dossier, 'form-workspace');
  expect(workspace.mappings[0]).toMatchObject({
    id: mapping,
    title: 'Ánh xạ giả lập',
    fields: [{ key: 'fullName' }],
  });
  expect(workspace.inputVersion).toBe(version);
  generated = (
    await channel.dossierAction<{ id: string }>(dossier, 'generated-forms', {
      mappingId: mapping,
      inputVersion: version,
      values: { fullName: 'TÊN GIẢ LẬP' },
      evidenceIds: [doc],
    })
  ).id;
  expect(await channel.dossierAction(dossier, 'generated-forms/' + generated)).toMatchObject({
    status: 'draft',
    values: { fullName: 'TÊN GIẢ LẬP' },
  });
  await expect(
    channel.dossierAction(dossier, 'generated-forms/' + generated + '/confirm', {
      accepted: true,
      checkedFields: [],
    }),
  ).rejects.toThrow();
  expect((await channel.file(dossier, 'generated-forms/' + generated + '/download')).type).toBe(
    'application/pdf',
  );
  await expect(
    channel.file(sameOwnerOtherDossier, 'generated-forms/' + generated + '/download'),
  ).rejects.toThrow();
  await channel.dossierAction(dossier, 'generated-forms/' + generated + '/confirm', {
    accepted: true,
    checkedFields: ['fullName'],
  });
  const packet = await channel.file(dossier, 'form-packet');
  expect(packet.type).toBe('application/zip');
  expect(new Uint8Array(await packet.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([80, 75]));
  await channel.saveDeclaration(
    dossier,
    {
      ...emptyDeclaration,
      fullName: 'BẢN KHAI MỚI',
      dateOfBirth: '1990-01-01',
      address: 'ĐỊA CHỈ GIẢ LẬP',
      housingSituation: 'renting',
      confirmed: true,
    },
    version,
  );
  await expect(channel.file(dossier, 'form-packet')).rejects.toThrow();
  await expect(
    channel.dossierAction(dossier, 'generated-forms', {
      mappingId: mapping,
      inputVersion: version,
      values: { fullName: 'CŨ' },
      evidenceIds: [doc],
    }),
  ).rejects.toThrow();
});
it('withdraws core consent without blocking private reads, rejects new processing and can explicitly reconsent', async () => {
  await channel.withdrawPrivacy();
  const p = await channel.privacy();
  expect(p.accepted).toBe(false);
  expect((await channel.dossier(dossier)).declaration.fullName).toBe('BẢN KHAI MỚI');
  expect((await channel.file(dossier, 'generated-forms/' + generated + '/download')).type).toBe(
    'application/pdf',
  );
  await expect(channel.dossierAction(dossier, 'documents/' + doc + '/scan', {})).rejects.toThrow();
  await expect(channel.createDossier('20000000-0000-4000-8000-000000000002')).rejects.toThrow();
  expect(extraction.calls).toBe(1);
  await channel.acceptPrivacy(p.notice!.id, p.notice!.content_hash);
  expect((await channel.privacy()).accepted).toBe(true);
  await channel.logout();
  await expect(channel.dashboard()).rejects.toThrow('đăng nhập');
});
