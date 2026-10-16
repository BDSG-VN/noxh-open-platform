/** Self-hosted OCR queue (migration 024) on embedded PostgreSQL with a fake local worker over HTTP. */
import 'reflect-metadata';
import { beforeAll, afterAll, afterEach, beforeEach, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { Database, type Row } from './database';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';
import { seedSyntheticPrivacy } from './test-privacy';
import { AssistanceService } from './assistance-service';
import { DocumentService } from './document-service';
import { DocumentStorage } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { DocumentOcrService, OcrWorkerError } from './document-ocr-service';
import { DocumentOcrLifecycle } from './document-ocr-lifecycle';
import { DossierService } from './dossier-service';
import { OpenAiService, OpenAiTransport } from './openai-service';
import { PrivacyService } from './privacy-service';
import { unseal } from './identity-crypto';

const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001',
  otherOrg = '10000000-0000-4000-8000-0000000000c2',
  otherUser = '30000000-0000-4000-8000-0000000000c2',
  foreignUser = '30000000-0000-4000-8000-0000000000c3',
  otherDossier = '40000000-0000-4000-8000-0000000000c2';
const citizen: Citizen = { organizationId: org, userId: owner },
  stranger: Citizen = { organizationId: org, userId: otherUser },
  foreign: Citizen = { organizationId: otherOrg, userId: foreignUser },
  admin: Staff = { organizationId: org, subject: 'synthetic-admin', role: 'org_admin' },
  manager: Staff = { organizationId: org, subject: 'synthetic-pm', role: 'project_manager' };
const SECRET_TEXT = 'NOXH-FAKE-OCR SYNTHETIC-LINE';
const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.from('synthetic png body for tests, not a real image'),
]);

class MemoryStorage extends DocumentStorage {
  objects = new Map<string, Uint8Array>();
  fail = false;
  override async put(k: string, b: Uint8Array) {
    this.objects.set(k, b);
  }
  override async get(k: string) {
    if (this.fail) throw new Error('storage down');
    return Buffer.from(this.objects.get(k)!);
  }
  override async remove(k: string) {
    this.objects.delete(k);
  }
}
class TestScanner extends DocumentScanner {
  result: 'clean' | 'rejected' | 'quarantined' = 'clean';
  override async scan() {
    return { status: this.result, engine: 'synthetic-test-only', reason: 'test' };
  }
}
/** Fake ai-worker: records requests, replies per configured mode, never echoes bytes. */
class FakeWorker {
  server!: Server;
  url = '';
  mode: 'ok' | 'low' | 'http-503' | 'http-422' | 'hang' | 'garbage' | 'bad-shape' | 'oversize' =
    'ok';
  requests: { mime: string; bytes: number; job: string }[] = [];
  async start() {
    this.server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        this.requests.push({
          mime: String(req.headers['content-type']),
          bytes: body.length,
          job: String(req.headers['x-noxh-ocr-job']),
        });
        if (req.url !== '/ocr' || req.method !== 'POST') {
          res.writeHead(404).end();
          return;
        }
        const reply = (status: number, payload: unknown) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
        };
        const result = (quality: number) => ({
          engine: 'fake',
          engine_version: 'fake-1',
          languages: ['fake'],
          pages: 1,
          quality,
          processing_ms: 12,
          blocks: [
            {
              page: 1,
              text: SECRET_TEXT,
              confidence: quality,
              bbox: { x: 0, y: 0, width: 100, height: 20 },
            },
            {
              page: 1,
              text: 'DÒNG THỨ HAI',
              confidence: 0.9,
              bbox: { x: 0, y: 30, width: 80, height: 20 },
            },
          ],
          warnings: [],
        });
        switch (this.mode) {
          case 'ok':
            return reply(200, result(0.91));
          case 'low':
            return reply(200, result(0.31));
          case 'http-503':
            return reply(503, { detail: 'engine-unavailable' });
          case 'http-422':
            return reply(422, { detail: 'unreadable-image' });
          case 'garbage':
            return reply(200, '{not json');
          case 'bad-shape':
            return reply(200, { engine: 'fake', blocks: 'nope' });
          case 'oversize':
            return reply(
              200,
              JSON.stringify({ ...result(0.9), warnings: ['x'.repeat(3 * 1024 * 1024)] }),
            );
          case 'hang':
            return; // never answers; the client deadline must fire
        }
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = 'http://127.0.0.1:' + (this.server.address() as { port: number }).port + '/';
  }
  stop() {
    this.server.closeAllConnections();
    this.server.close();
  }
}

const prior = { ...process.env };
let pg: PGlite,
  db: Database,
  docs: DocumentService,
  ocr: DocumentOcrService,
  storage: MemoryStorage,
  scanner: TestScanner,
  worker: FakeWorker,
  logs: Record<string, unknown>[] = [];
const consent = { accepted: true, noticeVersion: 'document-ocr-v1' } as const;
const due = (id: string) =>
  db.query(
    'UPDATE identity_private.document_ocr_jobs SET next_attempt_at=now(),version=version+1,updated_at=now() WHERE id=$1',
    [id],
  );
const job = async (id: string) =>
  (await db.query('SELECT * FROM identity_private.document_ocr_jobs WHERE id=$1', [id]))[0]!;
async function upload(c: Citizen = citizen, d = dossier, name = 'giay-to.png') {
  const id = (
    await docs.upload(c, d, {
      name,
      type: 'identity',
      mime: 'image/png',
      base64: PNG.toString('base64'),
    })
  ).id;
  return id;
}
async function cleanDocument() {
  scanner.result = 'clean';
  return upload();
}

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  await pg.query("INSERT INTO organizations(id,name) VALUES($1,'Tổ chức khác')", [otherOrg]);
  await pg.query(
    "INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active'),($3,$4,'active')",
    [otherUser, org, foreignUser, otherOrg],
  );
  await pg.query(
    "INSERT INTO projects(id,organization_id,name,locality,publication_status,is_synthetic) VALUES($1,$2,'Dự án khác','Địa bàn giả lập C','published',true)",
    ['20000000-0000-4000-8000-0000000000c2', otherOrg],
  );
  await pg.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [otherDossier, org, project, otherUser],
  );
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
  await seedSyntheticPrivacy(db, [citizen, stranger]);
  const assistance = new AssistanceService(db);
  scanner = new TestScanner();
  storage = new MemoryStorage();
  const privacy = new PrivacyService(db);
  const ai = new OpenAiService(db, new DossierService(db), assistance, new OpenAiTransport());
  docs = new DocumentService(db, assistance, storage, scanner, ai, privacy);
  ocr = new DocumentOcrService(db, assistance, storage, privacy);
  ocr.ocrDeadlineMs = 400;
  ocr.log = (entry) => logs.push(entry);
  worker = new FakeWorker();
  await worker.start();
}, 90000);
afterAll(async () => {
  worker.stop();
  await pg.close();
  process.env = prior;
});
beforeEach(() => {
  process.env.LOCAL_OCR_ENABLED = 'true';
  process.env.OCR_WORKER_URL = worker.url;
  process.env.AUTH_ORGANIZATION_ID = org;
  delete process.env.OCR_QUALITY_THRESHOLD;
  // Backoff always lands in the future; tests pull next_attempt_at forward explicitly.
  ocr.backoffMs = () => 60000;
  worker.mode = 'ok';
  worker.requests = [];
  logs = [];
  storage.fail = false;
});
afterEach(async () => {
  // Tests share one database: park any job a test left behind so later batches only see their own.
  await db.query(
    "UPDATE identity_private.document_ocr_jobs SET status='cancelled',reason='cancelled_by_owner',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE status IN('pending','running')",
  );
  delete process.env.LOCAL_OCR_ENABLED;
  delete process.env.OCR_WORKER_URL;
  delete process.env.AUTH_ORGANIZATION_ID;
});

describe('citizen request boundary', () => {
  it('requires purpose-specific consent and the deploy flag', async () => {
    const id = await cleanDocument();
    await expect(ocr.request(citizen, dossier, id, { accepted: true })).rejects.toThrow('đồng ý');
    await expect(
      ocr.request(citizen, dossier, id, {
        accepted: true,
        noticeVersion: 'document-extraction-v1',
      }),
    ).rejects.toThrow('đồng ý');
    await expect(ocr.request(citizen, dossier, id, { ...consent, extra: 1 })).rejects.toThrow(
      'đồng ý',
    );
    process.env.LOCAL_OCR_ENABLED = 'false';
    await expect(ocr.request(citizen, dossier, id, consent)).rejects.toThrow('chưa được bật');
    process.env.LOCAL_OCR_ENABLED = 'maybe';
    await expect(ocr.request(citizen, dossier, id, consent)).rejects.toThrow('true hoặc false');
    process.env.LOCAL_OCR_ENABLED = 'true';
    expect(
      (await ocr.workspace(citizen, dossier)).items.filter((j) => j.documentId === id),
    ).toEqual([]);
  });
  it('refuses quarantined or rejected documents and never contacts the worker for them', async () => {
    scanner.result = 'quarantined';
    const quarantined = await upload();
    await expect(ocr.request(citizen, dossier, quarantined, consent)).rejects.toThrow(
      'quét an toàn',
    );
    scanner.result = 'rejected';
    const rejected = await upload();
    await expect(ocr.request(citizen, dossier, rejected, consent)).rejects.toThrow('quét an toàn');
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 0 });
    expect(worker.requests).toEqual([]);
  });
  it('denies cross-owner and cross-organization access to documents, jobs and results', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    await expect(ocr.request(stranger, dossier, id, consent)).rejects.toThrow('hồ sơ');
    await expect(ocr.request(stranger, otherDossier, id, consent)).rejects.toThrow(
      'Không có giấy tờ',
    );
    await expect(ocr.request(foreign, dossier, id, consent)).rejects.toThrow();
    await expect(ocr.detail(stranger, dossier, j.id)).rejects.toThrow();
    await expect(ocr.detail(stranger, otherDossier, j.id)).rejects.toThrow('Không có tác vụ');
    await expect(ocr.cancel(stranger, otherDossier, j.id, j.version)).rejects.toThrow(
      'Không có tác vụ',
    );
    expect((await ocr.workspace(citizen, dossier)).items.some((x) => x.id === j.id)).toBe(true);
    await expect(ocr.workspace(stranger, dossier)).rejects.toThrow();
    await ocr.cancel(citizen, dossier, j.id, j.version);
  });
  it('allows one active job per document and records the consent purpose', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    expect(j).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      attemptBudget: 3,
      version: 1,
      documentId: id,
    });
    await expect(ocr.request(citizen, dossier, id, consent)).rejects.toThrow('đang có tác vụ');
    const [c] = await db.query('SELECT purpose,notice_version FROM consent_records WHERE id=$1', [
      (await job(j.id)).consent_id,
    ]);
    expect(c).toMatchObject({ notice_version: 'document-ocr-v1' });
    expect(String(c!.purpose)).toMatch(new RegExp('^local-ocr:' + id + ':[a-f0-9]{64}$'));
    await ocr.cancel(citizen, dossier, j.id, 1);
    expect((await ocr.request(citizen, dossier, id, consent)).status).toBe('pending');
  });
});

describe('worker lease, fencing and outcomes', () => {
  it('runs a job end to end: encrypted result, local-ocr extraction proposal, no declaration write', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    const batch = await ocr.runConfiguredBatch();
    expect(batch).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, lowQuality: 0 });
    expect(worker.requests).toEqual([{ mime: 'image/png', bytes: PNG.length, job: j.id }]);
    const row = await job(j.id);
    expect(row).toMatchObject({
      status: 'succeeded',
      attempt_count: 1,
      low_quality: false,
      engine: 'fake',
      lease_token: null,
    });
    expect(Number(row.quality_score)).toBeCloseTo(0.91);
    // Result is sealed with an AAD bound to organization, owner and job; raw text never sits in the row.
    expect(String(row.result_cipher)).not.toContain(SECRET_TEXT);
    expect(JSON.stringify(row)).not.toContain(SECRET_TEXT);
    expect(() =>
      unseal(String(row.result_cipher), 'ocr-result:' + org + ':' + otherUser + ':' + j.id),
    ).toThrow();
    const detail = await ocr.detail(citizen, dossier, j.id);
    expect(detail.result?.blocks[0]?.text).toBe(SECRET_TEXT);
    expect(detail.result?.blocks[0]?.bbox).toEqual({ x: 0, y: 0, width: 100, height: 20 });
    expect(detail.lowQuality).toBe(false);
    const ws = await docs.workspace(citizen, dossier);
    const extraction = ws.extractions.find((x) => x.id === row.extraction_id)!;
    expect(extraction).toMatchObject({
      model: 'local-ocr:fake',
      document_id: id,
      accepted_at: null,
    });
    expect(extraction.fields.map((f: { value: string }) => f.value)).toEqual([
      SECRET_TEXT,
      'DÒNG THỨ HAI',
    ]);
    expect(extraction.warnings[0]).toContain('đối chiếu');
    expect((await db.query('SELECT count(*)::int AS n FROM declaration_versions'))[0]!.n).toBe(0);
    // The existing accept path works unchanged on the OCR proposal.
    await docs.accept(citizen, dossier, extraction.id, {
      accepted: true,
      fields: [{ ...extraction.fields[0], value: 'ĐÃ KIỂM TRA' }],
    });
    expect(
      (await docs.workspace(citizen, dossier)).extractions.find((x) => x.id === extraction.id)
        ?.fields[0].value,
    ).toBe('ĐÃ KIỂM TRA');
    // Logs carry identifiers and codes only.
    expect(JSON.stringify(logs)).not.toContain(SECRET_TEXT);
    expect(logs.find((l) => l.outcome === 'succeeded')).toMatchObject({ jobId: j.id, blocks: 2 });
  });
  it('flags a result below the quality threshold and keeps the warning in the proposal', async () => {
    worker.mode = 'low';
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ succeeded: 1, lowQuality: 1 });
    const detail = await ocr.detail(citizen, dossier, j.id);
    expect(detail).toMatchObject({ status: 'succeeded', lowQuality: true, qualityThreshold: 0.6 });
    const ws = await docs.workspace(citizen, dossier);
    expect(
      ws.extractions
        .find((x) => x.id === detail.extractionId)
        ?.warnings.some((w: string) => w.includes('Chất lượng nhận dạng thấp')),
    ).toBe(true);
    process.env.OCR_QUALITY_THRESHOLD = '0.2';
    expect((await ocr.detail(citizen, dossier, j.id)).qualityThreshold).toBe(0.2);
  });
  it('claims with FOR UPDATE SKIP LOCKED, fences the lease and drops a result after owner cancellation while running', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    const claim = (await ocr.claimNext(org))!;
    expect(claim).toMatchObject({ jobId: j.id, organizationId: org });
    expect(await job(j.id)).toMatchObject({ status: 'running', version: 2 });
    expect(await ocr.claimNext(org)).toBeNull();
    // Owner cancels the running job: the lease is cleared and the in-flight result must be discarded.
    const cancelled = await ocr.cancel(citizen, dossier, j.id, 2);
    expect(cancelled).toMatchObject({ status: 'cancelled', reason: 'cancelled_by_owner' });
    expect(await ocr.processClaim(claim)).toBe('lost');
    expect(await job(j.id)).toMatchObject({
      status: 'cancelled',
      result_cipher: null,
      extraction_id: null,
    });
    expect(worker.requests).toEqual([]);
    await expect(ocr.cancel(citizen, dossier, j.id, 3)).rejects.toThrow('đã kết thúc');
    // A stale or foreign lease token never completes the job.
    const id2 = await cleanDocument();
    const j2 = await ocr.request(citizen, dossier, id2, consent);
    const c2 = (await ocr.claimNext(org))!;
    expect(
      await ocr.processClaim({ ...c2, leaseToken: '00000000-0000-4000-8000-000000000000' }),
    ).toBe('lost');
    expect(await job(j2.id)).toMatchObject({ status: 'running' });
    expect(await ocr.processClaim(c2)).toBe('succeeded');
  });
  it('discards the worker result when consent is withdrawn during recognition', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    const claim = (await ocr.claimNext(org))!;
    const original = ocr.recognise.bind(ocr);
    ocr.recognise = async (...args) => {
      const r = await original(...args);
      await db.query(
        'UPDATE consent_records SET withdrawn_at=now(),version=version+1 WHERE id=$1',
        [(await job(j.id)).consent_id],
      );
      return r;
    };
    try {
      expect(await ocr.processClaim(claim)).toBe('cancelled');
    } finally {
      ocr.recognise = original;
    }
    expect(await job(j.id)).toMatchObject({
      status: 'cancelled',
      reason: 'consent_unavailable',
      result_cipher: null,
    });
    expect(worker.requests).toHaveLength(1);
  });
  it('cancels a job whose document was withdrawn or changed before the worker ran', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    await docs.remove(citizen, dossier, id);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, cancelled: 1 });
    expect(await job(j.id)).toMatchObject({ status: 'cancelled', reason: 'document_unavailable' });
    expect(worker.requests).toEqual([]);
  });
  it('retries transient worker failures with backoff within the budget, then fails and allows one bounded operator requeue', async () => {
    worker.mode = 'http-503';
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, retried: 1 });
    const retry = await job(j.id);
    expect(retry).toMatchObject({
      status: 'pending',
      reason: 'worker_unavailable',
      attempt_count: 1,
    });
    expect(new Date(String(retry.next_attempt_at)).getTime()).toBeGreaterThan(Date.now() + 30000);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 0 });
    await due(j.id);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, retried: 1 });
    await due(j.id);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, failed: 1 });
    expect(await job(j.id)).toMatchObject({
      status: 'failed',
      reason: 'attempts_exhausted',
      attempt_count: 3,
    });
    expect(worker.requests).toHaveLength(3);
    // Attempts are exhausted: even the operator cannot requeue; the citizen requests a new job.
    const failed = await job(j.id);
    await expect(
      ocr.requeue(admin, j.id, { accepted: true }, Number(failed.version)),
    ).rejects.toThrow('hết ngân sách');
    expect((await ocr.request(citizen, dossier, id, consent)).status).toBe('pending');
  });
  it('treats timeouts as retryable, definite rejections and invalid replies as final', async () => {
    worker.mode = 'hang';
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ retried: 1 });
    expect(await job(j.id)).toMatchObject({
      status: 'pending',
      reason: 'worker_timeout',
      attempt_count: 1,
    });
    await due(j.id);
    worker.mode = 'http-422';
    expect(await ocr.runConfiguredBatch()).toMatchObject({ failed: 1 });
    expect(await job(j.id)).toMatchObject({
      status: 'failed',
      reason: 'worker_rejected',
      attempt_count: 2,
    });
    for (const [mode, reason] of [
      ['garbage', 'invalid_result'],
      ['bad-shape', 'invalid_result'],
      ['oversize', 'invalid_result'],
    ] as const) {
      worker.mode = mode;
      const d = await cleanDocument();
      const x = await ocr.request(citizen, dossier, d, consent);
      expect(await ocr.runConfiguredBatch()).toMatchObject({ failed: 1 });
      expect(await job(x.id)).toMatchObject({ status: 'failed', reason, attempt_count: 1 });
    }
  });
  it('requeues a failed job once within budget for the operator only, with If-Match', async () => {
    worker.mode = 'http-422';
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    expect(await ocr.runConfiguredBatch()).toMatchObject({ failed: 1 });
    const failed = await job(j.id);
    await expect(
      ocr.requeue(manager, j.id, { accepted: true }, Number(failed.version)),
    ).rejects.toThrow('quản trị');
    await expect(ocr.requeue(admin, j.id, {}, Number(failed.version))).rejects.toThrow('xác nhận');
    await expect(ocr.requeue(admin, j.id, { accepted: true }, 1)).rejects.toThrow('Phiên bản');
    await expect(
      ocr.requeue(
        { ...admin, organizationId: otherOrg },
        j.id,
        { accepted: true },
        Number(failed.version),
      ),
    ).rejects.toThrow('Không có tác vụ');
    const requeued = await ocr.requeue(admin, j.id, { accepted: true }, Number(failed.version));
    expect(requeued).toMatchObject({
      status: 'pending',
      reason: 'requeued',
      requeueCount: 1,
      attemptBudget: 2,
    });
    worker.mode = 'ok';
    expect(await ocr.runConfiguredBatch()).toMatchObject({ succeeded: 1 });
    await expect(ocr.requeue(admin, j.id, { accepted: true }, 5)).rejects.toThrow();
    const health = await ocr.health(admin);
    expect(health.counts.succeeded).toBeGreaterThan(0);
    expect(health).toMatchObject({ enabled: true, workerConfigured: true, staleLeases: 0 });
    expect(JSON.stringify(health)).not.toContain(SECRET_TEXT);
    await expect(ocr.health(manager)).rejects.toThrow('quản trị');
  });
  it('re-queues the job after an unexpected worker exception and dead-ends after five', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    storage.fail = true;
    for (let i = 1; i <= 5; i++) {
      await due(j.id);
      expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, workerFailures: 1 });
      expect(await job(j.id)).toMatchObject({
        status: i < 5 ? 'pending' : 'failed',
        reason: 'processing_failed',
        worker_failures: i,
      });
    }
    expect(JSON.stringify(logs)).not.toContain('storage down');
    expect(worker.requests).toEqual([]);
  });
  it('reclaims an expired lease from a dead worker', async () => {
    const id = await cleanDocument();
    const j = await ocr.request(citizen, dossier, id, consent);
    const stale = (await ocr.claimNext(org))!;
    await db.query(
      "UPDATE identity_private.document_ocr_jobs SET lease_until=now()-interval '1 second',version=version+1 WHERE id=$1",
      [j.id],
    );
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await ocr.processClaim(stale)).toBe('lost');
    expect(await job(j.id)).toMatchObject({ status: 'succeeded' });
  });
});

describe('configuration and transport boundary', () => {
  it('fails closed on a missing organization, a bad worker URL or a foreign organization', async () => {
    delete process.env.AUTH_ORGANIZATION_ID;
    expect(() => ocr.configuredOrganization()).toThrow('tổ chức');
    process.env.AUTH_ORGANIZATION_ID = org;
    for (const bad of [
      '',
      'ftp://ocr:4100',
      'http://user:pw@ocr:4100/',
      'http://ocr:4100/?x=1',
      'not a url',
    ]) {
      process.env.OCR_WORKER_URL = bad;
      expect(() => ocr.configuredOrganization()).toThrow('OCR_WORKER_URL');
    }
    process.env.OCR_WORKER_URL = 'http://ocr-worker:4100';
    expect(ocr.workerUrl()).toBe('http://ocr-worker:4100/ocr');
    process.env.OCR_WORKER_URL = 'http://ocr-worker:4100/internal/';
    expect(ocr.workerUrl()).toBe('http://ocr-worker:4100/internal/ocr');
    await expect(ocr.claimNext(otherOrg)).rejects.toThrow('tổ chức');
    process.env.LOCAL_OCR_ENABLED = 'false';
    expect(ocr.configuredOrganization()).toBeNull();
    expect(await ocr.runConfiguredBatch()).toMatchObject({ claimed: 0 });
  });
  it('classifies transport failures without leaking details', async () => {
    process.env.OCR_WORKER_URL = 'http://127.0.0.1:9/';
    await expect(ocr.recognise(PNG, 'image/png', 'job')).rejects.toSatisfy(
      (e) => e instanceof OcrWorkerError && e.kind === 'retryable',
    );
    process.env.OCR_WORKER_URL = worker.url;
    worker.mode = 'hang';
    await expect(ocr.recognise(PNG, 'image/png', 'job')).rejects.toSatisfy(
      (e) => e instanceof OcrWorkerError && e.kind === 'timeout',
    );
  });
  it('exposes counters only on the lifecycle status and never auto-starts when disabled', async () => {
    process.env.LOCAL_OCR_ENABLED = 'false';
    const life = new DocumentOcrLifecycle(ocr);
    life.onApplicationBootstrap();
    expect(life.status()).toMatchObject({
      enabled: false,
      scope: 'self-hosted-document-ocr',
      error: false,
    });
    await life.onModuleDestroy();
    process.env.LOCAL_OCR_ENABLED = 'true';
    const active = new DocumentOcrLifecycle(ocr);
    active.tick();
    await active.onModuleDestroy();
    expect(Object.keys(active.status().counters).sort()).toEqual([
      'cancelled',
      'claimed',
      'failed',
      'lowQuality',
      'retried',
      'succeeded',
      'workerFailures',
    ]);
  });
});
