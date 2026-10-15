import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from './database';
import { OperationsService } from './operations-service';
import { InternalFileService } from './internal-file-service';
import { DocumentStorage } from './document-storage';
import { DocumentScanner } from './document-scanner';
import { AssistanceService } from './assistance-service';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  project = '20000000-0000-4000-8000-000000000001',
  otherProject = '20000000-0000-4000-8000-000000000002',
  author: Staff = { organizationId: org, subject: 'synthetic-author', role: 'org_admin' },
  reviewer: Staff = { ...author, subject: 'synthetic-reviewer' },
  reader: Staff = {
    organizationId: org,
    subject: 'synthetic-reader',
    role: 'project_manager',
    projectIds: [project],
    permissions: ['records_read'],
  };
class Store extends DocumentStorage {
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
class Scanner extends DocumentScanner {
  result: 'quarantined' | 'clean' | 'rejected' = 'quarantined';
  override async scan() {
    return { status: this.result, engine: 'isolated-synthetic-only', reason: 'test' };
  }
}
let pg: PGlite,
  db: Database,
  operations: OperationsService,
  files: InternalFileService,
  scanner: Scanner,
  storage: Store,
  file = '',
  hash = '',
  recordId = '',
  employeeId = '';
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
  operations = new OperationsService(db);
  storage = new Store();
  scanner = new Scanner();
  files = new InternalFileService(db, operations, storage, scanner);
  employeeId = (
    await operations.saveEmployee(author, {
      subject: reader.subject,
      name: 'NGƯỜI ĐỌC GIẢ LẬP',
      department: 'legal',
      status: 'active',
      permissions: ['records_read', 'records_write'],
      projectIds: [project],
    })
  ).id;
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('keeps encrypted uploaded source quarantined and denies unrelated staff/project', async () => {
  const f = await new AssistanceService(db).pdf('nd100-application-01');
  const result = await files.upload(author, project, {
    name: 'synthetic-internal.pdf',
    mime: 'application/pdf',
    base64: f.bytes.toString('base64'),
    department: 'legal',
    classification: 'restricted',
  });
  file = result.id;
  hash = result.sha256;
  expect((await files.list(author, project)).items).toHaveLength(1);
  expect((await files.list(reviewer, project)).items).toHaveLength(0);
  expect(Buffer.from([...storage.objects.values()][0]!).includes(Buffer.from('%PDF-'))).toBe(false);
  await expect(files.download(author, project, file)).rejects.toThrow('quét');
  await expect(files.download(reviewer, project, file)).rejects.toThrow();
  await expect(files.download(author, otherProject, file)).rejects.toThrow();
  await expect(
    db.query('UPDATE identity_private.investor_files SET sha256=$2 WHERE id=$1', [
      file,
      '0'.repeat(64),
    ]),
  ).rejects.toThrow('immutable');
});
it('binds a clean file to a restricted reviewed record and checks project/department/hash', async () => {
  const payload = {
    title: 'HỒ SƠ GIẢ LẬP',
    kind: 'record',
    classification: 'restricted',
    body: 'Nội dung kiểm thử với tệp mã hóa riêng',
    attachment: { reference: 'file:' + file, sha256: hash },
  };
  await expect(operations.saveRecord(author, project, payload)).rejects.toThrow('quét');
  scanner.result = 'clean';
  await files.scan(author, project, file);
  expect((await files.download(author, project, file)).mime).toBe('application/pdf');
  await expect(
    files.upload(reader, project, {
      name: 'bad-department.pdf',
      mime: 'application/pdf',
      base64: Buffer.from('%PDF-1.7\n%%EOF').toString('base64'),
      department: 'business',
      classification: 'restricted',
    }),
  ).rejects.toThrow('phòng ban');
  await expect(
    operations.saveRecord(author, project, {
      ...payload,
      attachment: { reference: 'file:' + file, sha256: '0'.repeat(64) },
    }),
  ).rejects.toThrow('SHA256');
  await expect(operations.saveRecord(author, otherProject, payload)).rejects.toThrow();
  await expect(
    operations.saveRecord(author, project, { ...payload, classification: 'internal' }),
  ).rejects.toThrow('Hạn chế');
  await expect(operations.saveRecord(reviewer, project, payload)).rejects.toThrow('người khác');
  const saved = await operations.saveRecord(author, project, {
    title: 'HỒ SƠ GIẢ LẬP',
    kind: 'record',
    classification: 'restricted',
    body: 'Nội dung kiểm thử với tệp mã hóa riêng',
    attachment: { reference: 'file:' + file, sha256: hash },
  });
  recordId = saved.id;
  expect((await files.list(reviewer, project)).items).toHaveLength(1);
  expect((await files.download(reviewer, project, file)).mime).toBe('application/pdf');
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM identity_private.investor_record_files WHERE record_revision_id=$1',
        [recordId],
      )
    )[0]!.n,
  ).toBe(1);
  await expect(
    operations.saveRecord(author, project, {
      ...payload,
      recordId: saved.recordId,
      classification: 'internal',
      attachment: null,
    }),
  ).rejects.toThrow('hạ phân loại');

  expect((await files.list(reader, project)).items).toHaveLength(0);
  await operations.reviewRecord(reviewer, project, recordId, { action: 'approve' }, 1);
  expect((await files.list(reader, project)).items).toHaveLength(1);
  expect((await files.download(reader, project, file)).bytes.length).toBeGreaterThan(1000);
});
it('revoking the record or employee grant blocks later file reads', async () => {
  await operations.reviewRecord(reviewer, project, recordId, { action: 'revoke' }, 2);
  await expect(files.download(reader, project, file)).rejects.toThrow();
  await db.query("UPDATE identity_private.investor_employees SET status='suspended' WHERE id=$1", [
    employeeId,
  ]);
  await expect(files.list(reader, project)).rejects.toThrow();
  await expect(files.download(reader, project, file)).rejects.toThrow();
  expect((await files.download(author, project, file)).mime).toBe('application/pdf');
});
