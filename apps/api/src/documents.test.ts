import 'reflect-metadata';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer } from 'node:net';
import { DocumentScanner } from './document-scanner';
import { encryptObject, decryptObject } from './document-storage';
import { validateDocument } from './document-service';
import { FormMappingSchema, DocumentUploadSchema } from '@noxh/contracts';
process.env.AUTH_ENCRYPTION_KEY = 'e'.repeat(64);
describe('private document boundary', () => {
  it('authenticates envelope bytes and owner context', () => {
    const e = encryptObject(Buffer.from('synthetic'), 'org:owner:id');
    expect(decryptObject(e.bytes, e.keyCipher, 'org:owner:id').toString()).toBe('synthetic');
    expect(() => decryptObject(e.bytes, e.keyCipher, 'org:other:id')).toThrow();
    const bad = Buffer.from(e.bytes);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    expect(() => decryptObject(bad, e.keyCipher, 'org:owner:id')).toThrow();
  });
  it('rejects mismatched MIME, active PDFs and malformed upload metadata', () => {
    expect(() =>
      validateDocument(Buffer.from('%PDF-1.7\n/JavaScript doSomething\n%%EOF'), 'application/pdf'),
    ).toThrow();
    expect(() => validateDocument(Buffer.from('this is no image'), 'image/jpeg')).toThrow();
    expect(
      DocumentUploadSchema.safeParse({
        name: '../private.pdf',
        type: 'identity',
        mime: 'application/pdf',
        base64: 'AAAA',
      }).success,
    ).toBe(false);
    expect(FormMappingSchema.safeParse({}).success).toBe(false);
  });
});
describe('ClamAV INSTREAM fail closed', () => {
  afterEach(() => {
    delete process.env.CLAMD_HOST;
    delete process.env.CLAMD_PORT;
  });
  it('quarantines if scanner is absent', async () => {
    delete process.env.CLAMD_HOST;
    expect((await new DocumentScanner().scan(Buffer.from('a'))).status).toBe('quarantined');
  });
  it.each([
    ['stream: OK\0', 'clean'],
    ['stream: Eicar-Test-Signature FOUND\0', 'rejected'],
    ['stream: error ERROR\0', 'quarantined'],
    ['stream: OK\0unexpected', 'quarantined'],
  ])('accepts only protocol-clean response %s', async (reply, status) => {
    let chunks = Buffer.alloc(0);
    const server = createServer((s) =>
      s.on('data', (b) => {
        chunks = Buffer.concat([chunks, b]);
        if (chunks.length >= 20) s.write(reply);
      }),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address() as { port: number };
    process.env.CLAMD_HOST = '127.0.0.1';
    process.env.CLAMD_PORT = String(address.port);
    try {
      expect((await new DocumentScanner().scan(Buffer.from('synthetic test data'))).status).toBe(
        status,
      );
      expect(chunks.subarray(0, 10).toString()).toBe('zINSTREAM\0');
    } finally {
      server.close();
    }
  });
});

import { beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database, type Sql } from './database';
import type { Citizen } from './phone-service';
import { seedSyntheticPrivacy } from './test-privacy';
import { AssistanceService } from './assistance-service';
import { DocumentService } from './document-service';
import { DocumentStorage } from './document-storage';
import { DossierService } from './dossier-service';
import { OpenAiService, OpenAiTransport } from './openai-service';
import { PrivacyService } from './privacy-service';
import { FormService } from './form-service';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001';
const citizen = { organizationId: org, userId: owner },
  staff: Staff = { organizationId: org, subject: 'synthetic-editor', role: 'org_admin' },
  reviewer: Staff = {
    ...staff,
    subject: 'synthetic-reviewer',
    permissions: ['form_legal_approver'],
  };
class MemoryStorage extends DocumentStorage {
  objects = new Map<string, Uint8Array>();
  override async put(k: string, b: Uint8Array) {
    this.objects.set(k, b);
  }
  override async get(k: string) {
    return Buffer.from(this.objects.get(k)!);
  }
  override async remove(k: string) {
    this.objects.delete(k);
  }
}
class TestScanner extends DocumentScanner {
  result: 'clean' | 'rejected' | 'quarantined' = 'quarantined';
  override async scan() {
    return { status: this.result, engine: 'synthetic-test-only', reason: 'test' };
  }
}
class TestPrivacy extends PrivacyService {
  allowed = true;
  override async assertProcessing(c: Citizen, q?: Sql) {
    if (!this.allowed) throw new Error('restricted');
    return super.assertProcessing(c, q);
  }
}
class ExtractTransport extends OpenAiTransport {
  calls = 0;
  after?: () => Promise<void>;
  override async respond(_key: string, b: Record<string, unknown>) {
    this.calls++;
    if (this.after) await this.after();
    expect(b.store).toBe(false);
    expect(b.tools).toBeUndefined();
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
                warnings: ['Phải đối chiếu bản gốc'],
              }),
            },
          ],
        },
      ],
    };
  }
}
describe('document to reviewed PDF workflow', () => {
  let pg: PGlite,
    db: Database,
    assistance: AssistanceService,
    docs: DocumentService,
    forms: FormService,
    scanner: TestScanner,
    storage: MemoryStorage,
    privacy: TestPrivacy,
    transport: ExtractTransport;
  let doc = '',
    mapping = '',
    generated = '';
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
    await seedSyntheticPrivacy(db, [citizen]);
    assistance = new AssistanceService(db);
    scanner = new TestScanner();
    storage = new MemoryStorage();
    privacy = new TestPrivacy(db);
    transport = new ExtractTransport();
    const ai = new OpenAiService(db, new DossierService(db), assistance, transport);
    docs = new DocumentService(db, assistance, storage, scanner, ai, privacy);
    forms = new FormService(db, assistance, storage, docs, privacy);
    await ai.configure(
      staff,
      {
        enabled: true,
        apiKey: 'synthetic-key-not-used-for-network',
        model: 'synthetic-model',
        dailyLimit: 20,
      },
      0,
    );
  }, 30000);
  afterAll(async () => {
    await pg.close();
    process.env = prior;
  });
  it('quarantines encrypted source and forbids unscanned reads/extraction and cross-owner access', async () => {
    const file = await assistance.pdf('nd100-application-01');
    doc = (
      await docs.upload(citizen, dossier, {
        name: 'synthetic.pdf',
        type: 'identity',
        mime: 'application/pdf',
        base64: file.bytes.toString('base64'),
      })
    ).id;
    expect((await docs.workspace(citizen, dossier)).items[0]?.scan_status).toBe('quarantined');
    expect(Buffer.from([...storage.objects.values()][0]!).includes(Buffer.from('%PDF-'))).toBe(
      false,
    );
    await expect(docs.download(citizen, dossier, doc)).rejects.toThrow('quét');
    await expect(
      docs.extract(citizen, dossier, doc, {
        accepted: true,
        noticeVersion: 'document-extraction-v1',
      }),
    ).rejects.toThrow('quét');
    await expect(
      docs.download({ ...citizen, userId: '30000000-0000-4000-8000-000000000099' }, dossier, doc),
    ).rejects.toThrow();
    expect(transport.calls).toBe(0);
  });
  it('extracts clean only after consent, requires human acceptance and never overwrites declaration', async () => {
    scanner.result = 'clean';
    await docs.scan(citizen, dossier, doc);
    await expect(docs.extract(citizen, dossier, doc, { accepted: false })).rejects.toThrow(
      'đồng ý',
    );
    const ex = await docs.extract(citizen, dossier, doc, {
      accepted: true,
      noticeVersion: 'document-extraction-v1',
    });
    expect(transport.calls).toBe(1);
    expect((await db.query('SELECT count(*)::int AS n FROM declaration_versions'))[0]!.n).toBe(0);
    await docs.accept(citizen, dossier, ex.id, {
      accepted: true,
      fields: [{ ...ex.fields[0]!, value: 'TÊN ĐÃ KIỂM TRA' }],
    });
    expect((await docs.workspace(citizen, dossier)).extractions[0]?.fields[0].value).toBe(
      'TÊN ĐÃ KIỂM TRA',
    );
    await expect(
      docs.accept(citizen, dossier, ex.id, { accepted: true, fields: ex.fields }),
    ).rejects.toThrow();
  });
  it('requires independent mapping approval and source hash, produces draft then confirmed PDF with immutable provenance', async () => {
    const release = await assistance.publish(staff, project, {
      formId: 'nd100-application-01',
      mode: 'buy',
      group: 5,
      recipient: 'CƠ QUAN GIẢ LẬP',
      instructions: 'Hướng dẫn giả lập để kiểm thử không dùng thật',
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
    await expect(
      forms.review(staff, project, mapping, { accepted: true, action: 'approve' }),
    ).rejects.toThrow();
    await forms.review(reviewer, project, mapping, { accepted: true, action: 'approve' });
    const w = await forms.workspace(citizen, dossier);
    expect(w.mappings).toHaveLength(1);
    generated = (
      await forms.generate(citizen, dossier, {
        mappingId: mapping,
        inputVersion: Number(w.inputVersion),
        values: { fullName: 'TÊN GIẢ LẬP' },
        evidenceIds: [doc],
      })
    ).id;
    expect((await forms.detail(citizen, dossier, generated)).status).toBe('draft');
    await expect(
      forms.confirm(citizen, dossier, generated, { accepted: true, checkedFields: [] }),
    ).rejects.toThrow('toàn bộ');
    await forms.confirm(citizen, dossier, generated, {
      accepted: true,
      checkedFields: ['fullName'],
    });
    expect(
      (await forms.download(citizen, dossier, generated)).bytes.subarray(0, 5).toString(),
    ).toBe('%PDF-');
    expect((await forms.readForAuthorizedStaff(generated, org)).mime).toBe('application/pdf');
    expect((await forms.packet(citizen, dossier)).mime).toBe('application/zip');
    expect((await forms.preview(reviewer, project, mapping)).bytes.length).toBeGreaterThan(1000);
    await expect(
      forms.confirm(citizen, dossier, generated, { accepted: true, checkedFields: ['fullName'] }),
    ).rejects.toThrow();
  });
  it('does not persist results after file/run consent withdrawal even when core consent is immediately granted again', async () => {
    const before = (await docs.workspace(citizen, dossier)).extractions.length;
    transport.after = async () => {
      const p = new PrivacyService(db),
        w = await p.workspace(citizen);
      await p.withdraw(citizen);
      await p.choose(citizen, {
        noticeId: w.notice!.id,
        contentHash: w.notice!.content_hash,
        accepted: true,
      });
    };
    try {
      await expect(
        docs.extract(citizen, dossier, doc, {
          accepted: true,
          noticeVersion: 'document-extraction-v1',
        }),
      ).rejects.toThrow();
    } finally {
      transport.after = undefined;
    }
    expect((await docs.workspace(citizen, dossier)).extractions).toHaveLength(before);
    expect(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM consent_records WHERE purpose LIKE 'openai-document:%' AND withdrawn_at IS NULL",
        )
      )[0]!.n,
    ).toBe(0);
  });
  it('keeps malformed PDFs opaque before AV and rejects them without parser warnings after a clean scan', async () => {
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const malformed = Buffer.from(
      '%PDF-1.7\n1 0 obj\n<<SYNTHETIC-MALFORMED-OBJECT>>\nendobj\n%%EOF',
    );
    scanner.result = 'quarantined';
    try {
      const result = await docs.upload(citizen, dossier, {
        name: 'MALFORMED-SYNTHETIC.pdf',
        type: 'other',
        mime: 'application/pdf',
        base64: malformed.toString('base64'),
      });
      expect(
        (await docs.workspace(citizen, dossier)).items.find((d) => d.id === result.id)?.scan_status,
      ).toBe('quarantined');
      expect(warnings).not.toHaveBeenCalled();
      scanner.result = 'clean';
      expect((await docs.scan(citizen, dossier, result.id)).status).toBe('rejected');
      expect(warnings).not.toHaveBeenCalled();
      await expect(docs.download(citizen, dossier, result.id)).rejects.toThrow('quét');
    } finally {
      warnings.mockRestore();
      scanner.result = 'clean';
    }
  });
  it('blocks revoked mappings, changed source and further processing after privacy restriction', async () => {
    await forms.review(reviewer, project, mapping, { accepted: true, action: 'revoke' });
    expect((await forms.workspace(citizen, dossier)).mappings).toHaveLength(0);
    await expect(
      forms.generate(citizen, dossier, {
        mappingId: mapping,
        inputVersion: 1,
        values: {},
        evidenceIds: [],
      }),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE documents SET sha256=$2 WHERE id=$1', [doc, '0'.repeat(64)]),
    ).rejects.toThrow('immutable');
    privacy.allowed = false;
    await expect(docs.scan(citizen, dossier, doc)).rejects.toThrow('restricted');
    expect((await docs.download(citizen, dossier, doc)).mime).toBe('application/pdf');
  });
});
