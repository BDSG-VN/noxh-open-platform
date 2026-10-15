import 'reflect-metadata';
import { afterAll, beforeAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from './database';
import { PrivacyService } from './privacy-service';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  user = '30000000-0000-4000-8000-000000000001';
const c = { organizationId: org, userId: user },
  s: Staff = { organizationId: org, subject: 'test-author', role: 'org_admin' },
  reviewer = { ...s, subject: 'test-officer', permissions: ['privacy_officer'] };
let pg: PGlite, db: Database, svc: PrivacyService;
const prior = { ...process.env };
const body = {
  controller: 'CHỦ ĐẦU TƯ GIẢ LẬP',
  contact: 'privacy@example.test',
  purposes: 'Chỉ chuẩn bị hồ sơ giả lập.',
  categories: 'Thông tin bản khai và hộ gia đình giả lập.',
  legalBasis: 'Đồng ý tự nguyện trong môi trường kiểm thử.',
  recipients: 'Nhân sự được phân quyền, không chia sẻ bên ngoài.',
  retention: 'Chỉ dữ liệu kiểm thử, xóa theo đợt thử nghiệm.',
  transfers: 'Không thực hiện chuyển dữ liệu thật ra nước ngoài.',
  safeguards: 'Mã hóa, phân quyền và ghi nhật ký kiểm thử.',
  rights: 'Yêu cầu trên hệ thống và liên hệ email đầu mối.',
  consequences: 'Có thể từ chối và không gửi thêm thông tin.',
  governance: 'Kiểm thử phần mềm, không phải phê duyệt pháp lý.',
  reviewed: true,
};
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
  svc = new PrivacyService(db);
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
it('requires a current separately approved notice and exact explicit content acceptance', async () => {
  await expect(svc.assertProcessing(c)).rejects.toMatchObject({ status: 428 });
  const n = await svc.draft(s, body);
  await expect(svc.review(s, n.id, { action: 'approve', accepted: true })).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    svc.review({ ...s, permissions: ['privacy_officer'] }, n.id, {
      action: 'approve',
      accepted: true,
    }),
  ).rejects.toMatchObject({ status: 403 });
  await svc.review(reviewer, n.id, { action: 'approve', accepted: true });
  const w = await svc.workspace(c);
  expect(w.accepted).toBe(false);
  await expect(
    svc.choose(c, { noticeId: n.id, contentHash: '0'.repeat(64), accepted: true }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    svc.choose(c, { noticeId: n.id, contentHash: w.notice!.content_hash, accepted: false }),
  ).rejects.toMatchObject({ status: 400 });
  await svc.choose(c, { noticeId: n.id, contentHash: w.notice!.content_hash, accepted: true });
  await svc.assertProcessing(c);
  await expect(
    db.query("UPDATE privacy_notices SET payload='{}'::jsonb WHERE id=$1", [n.id]),
  ).rejects.toThrow('immutable');
});
it('withdrawal is append-only, idempotent and prevents more processing; a new notice needs fresh consent', async () => {
  await svc.withdraw(c);
  await svc.withdraw(c);
  expect((await svc.workspace(c)).accepted).toBe(false);
  await expect(svc.assertProcessing(c)).rejects.toMatchObject({ status: 428 });
  const old = (await svc.workspace(c)).notice!;
  await svc.choose(c, { noticeId: old.id, contentHash: old.content_hash, accepted: true });
  const next = await svc.draft(s, {
    ...body,
    purposes: 'Thay đổi phạm vi giả lập cần đồng ý lại.',
  });
  await svc.review(reviewer, next.id, { action: 'approve', accepted: true });
  await expect(svc.assertProcessing(c)).rejects.toMatchObject({ status: 428 });
  await expect(
    svc.choose(c, { noticeId: old.id, contentHash: old.content_hash, accepted: true }),
  ).rejects.toMatchObject({ status: 409 });
  const current = (await svc.workspace(c)).notice!;
  await svc.choose(c, { noticeId: current.id, contentHash: current.content_hash, accepted: true });
  await svc.restrict(c, { restricted: true });
  await expect(svc.assertProcessing(c)).rejects.toMatchObject({ status: 403 });
  await svc.restrict(c, { restricted: false });
  await svc.assertProcessing(c);
  await svc.review(reviewer, next.id, { action: 'revoke', accepted: true });
  expect((await svc.workspace(c)).notice).toBe(null);
});
it('encrypts rights requests, isolates owners and requires the privacy officer with concurrency checks', async () => {
  const r = await svc.request(c, { kind: 'erase', message: 'YÊU CẦU GIẢ LẬP XÓA DỮ LIỆU' });
  const raw = (
    await db.query('SELECT message_cipher FROM privacy_requests WHERE id=$1', [r.id])
  )[0]!;
  expect(String(raw.message_cipher)).not.toContain('GIẢ LẬP');
  await expect(svc.requests(s)).rejects.toMatchObject({ status: 403 });
  expect(
    (await svc.workspace({ ...c, userId: '30000000-0000-4000-8000-000000000099' })).requests,
  ).toHaveLength(0);
  await expect(
    svc.respond(
      reviewer,
      r.id,
      { reply: 'Phản hồi giả lập chưa xóa tự động.', status: 'responded' },
      99,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await svc.respond(
    reviewer,
    r.id.toUpperCase(),
    { reply: 'Phản hồi giả lập; sẽ kiểm tra nghĩa vụ giữ lại.', status: 'responded' },
    1,
  );
  expect((await svc.workspace(c)).requests[0]?.reply).toContain('nghĩa vụ');
});
