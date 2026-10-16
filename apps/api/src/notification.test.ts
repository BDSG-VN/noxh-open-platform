import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database, type Row } from './database';
import { NotificationService } from './notification-service';
import { NotificationController } from './notification-controller';
import { PrivacyService } from './privacy-service';
import { seal } from './identity-crypto';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff, WorkforceAuth } from './workforce';
import type { PhoneService } from './phone-service';
const prior = { ...process.env };
let pg: PGlite, db: Database;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.NOTIFICATIONS_EXTERNAL_ENABLED;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
}, 90000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
const accepted = { accepted: true };
const review = {
  decision: 'approve',
  accepted: true,
  note: 'Đã kiểm tra nội dung và mục đích diễn tập độc lập.',
};
async function fixture(
  channel: 'in_app' | 'email' | 'zalo' = 'in_app',
  purpose: 'transactional' | 'marketing' = 'transactional',
) {
  const org = randomUUID(),
    project = randomUUID(),
    user = randomUUID(),
    dossier = randomUUID(),
    round = randomUUID(),
    application = randomUUID();
  const maker: Staff = {
      organizationId: org,
      subject: 'synthetic-notification-maker',
      role: 'org_admin',
    },
    reviewer: Staff = {
      ...maker,
      subject: 'synthetic-notification-reviewer',
      permissions: ['form_legal_approver', 'privacy_officer'],
    },
    citizen = { organizationId: org, userId: user };
  await db.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
    org,
    'Synthetic notifications',
  ]);
  await db.query(
    "INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES($1,$2,'Dự án giả lập','Địa bàn giả lập',true)",
    [project, org],
  );
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    user,
    org,
  ]);
  await db.query(
    'INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4)',
    [dossier, org, project, user],
  );
  await seedSyntheticPrivacy(db, [citizen]);
  const n = (await new PrivacyService(db).current(org))!;
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'Synthetic notifications','closed','2025-01-01','2025-02-01')",
    [round, org, project],
  );
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'submitted',$9,$10,1,$11,true,$12,$13)",
    [
      application,
      org,
      project,
      round,
      dossier,
      user,
      'DEMO-NOTIFY-' + application,
      'DEMO-' + application.toUpperCase(),
      seal('{}', 'application:' + org + ':' + application),
      'a'.repeat(64),
      n.id,
      randomUUID(),
      'b'.repeat(64),
    ],
  );
  const legalEmployee = randomUUID();
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,permissions,status) VALUES($1,$2,$3,'Synthetic legal reviewer','legal',$4,'active')",
    [legalEmployee, org, reviewer.subject, ['form_legal_approver', 'privacy_officer']],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, legalEmployee, project],
  );
  const svc = new NotificationService(db),
    input = {
      name: 'Thông báo hồ sơ diễn tập',
      title: 'Hồ sơ {applicationCode}',
      body: 'Dự án {projectName}: {reference}. Đây là dữ liệu giả lập.',
      basis: 'Mục đích và căn cứ chỉ phục vụ diễn tập; không xác lập nghĩa vụ pháp lý.',
      channel,
      purpose,
      idempotencyKey: randomUUID(),
    };
  const t = await svc.draft(maker, project, input);
  const prefs = { channel, purpose, enabled: true, accepted: true };
  const queue = {
    templateId: t.id,
    applicationId: application,
    reference: 'Thông tin diễn tập cần kiểm tra',
    idempotencyKey: randomUUID(),
  };
  return {
    org,
    project,
    user,
    dossier,
    application,
    maker,
    reviewer,
    citizen,
    svc,
    input,
    t,
    prefs,
    queue,
  };
}
async function ready(
  channel: 'in_app' | 'email' | 'zalo' = 'in_app',
  purpose: 'transactional' | 'marketing' = 'transactional',
) {
  const f = await fixture(channel, purpose);
  await f.svc.review(f.reviewer, f.project, f.t.id, review, 1);
  await f.svc.preference(f.citizen, f.project, f.prefs, 0);
  return f;
}
it('requires independent approval and exact request fields; stores immutable encrypted snapshots', async () => {
  const f = await fixture();
  await expect(f.svc.queue(f.maker, f.project, f.queue)).rejects.toMatchObject({ status: 409 });
  await expect(
    f.svc.review(
      { ...f.maker, permissions: ['form_legal_approver'] },
      f.project,
      f.t.id,
      review,
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    f.svc.review({ ...f.reviewer, permissions: [] }, f.project, f.t.id, review, 1),
  ).rejects.toMatchObject({ status: 403 });
  await expect(f.svc.draft(f.maker, f.project, { ...f.input, extra: true })).rejects.toMatchObject({
    status: 400,
  });
  await expect(
    f.svc.draft(f.maker, f.project, {
      ...f.input,
      body: '<script>unsafe</script>',
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    f.svc.draft(f.maker, f.project, {
      ...f.input,
      body: 'Không cho phép {user.phone}',
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const again = await f.svc.draft(f.maker, f.project, f.input);
  expect(again.id).toBe(f.t.id);
  await expect(
    f.svc.draft(f.maker, f.project, { ...f.input, title: 'Khác nội dung' }),
  ).rejects.toMatchObject({ status: 409 });
  await f.svc.review(f.reviewer, f.project, f.t.id, review, 1);
  await expect(
    db.query(
      "UPDATE identity_private.notification_templates SET payload_cipher='plaintext',version=version+1 WHERE id=$1",
      [f.t.id],
    ),
  ).rejects.toThrow('immutable');
  const [raw] = await db.query(
    'SELECT payload_cipher FROM identity_private.notification_templates WHERE id=$1',
    [f.t.id],
  );
  expect(raw!.payload_cipher).not.toContain('căn cứ');
});
it('runs in-app queue/delivery/read end to end and deduplicates repeated concurrent requests', async () => {
  const f = await ready();
  const [a, b] = await Promise.all([
    f.svc.queue(f.maker, f.project, f.queue),
    f.svc.queue(f.maker, f.project, f.queue),
  ]);
  expect(a.id).toBe(b.id);
  expect((await f.svc.citizenWorkspace(f.citizen)).items).toHaveLength(0);
  const results = await Promise.all([
    f.svc.deliver(f.maker, f.project, a.id, accepted, 1),
    f.svc.deliver(f.maker, f.project, a.id, accepted, 1),
  ]);
  expect(results.map((x) => x.status)).toEqual(['delivered', 'delivered']);
  expect(results[1]!.attempts).toHaveLength(1);
  const inbox = await f.svc.citizenWorkspace(f.citizen);
  expect(inbox.items[0]!.body).toContain('Dự án giả lập');
  expect(inbox.items[0]!.readAt).toBeNull();
  const ack = await f.svc.read(f.citizen, a.id, accepted, 2);
  expect(ack.readAt).not.toBeNull();
  expect((await f.svc.read(f.citizen, a.id, accepted, 2)).version).toBe(3);
  const workspace = await f.svc.workspace(f.maker, f.project);
  expect(workspace.applications[0]!.id).toBe(f.application);
  expect(workspace.messages).toHaveLength(1);
  const [raw] = await db.query(
    'SELECT payload_cipher FROM identity_private.notification_messages WHERE id=$1',
    [a.id],
  );
  expect(raw!.payload_cipher).not.toContain('Thông tin diễn tập');
  await expect(
    db.query('DELETE FROM identity_private.notification_attempts WHERE message_id=$1', [a.id]),
  ).rejects.toThrow('append-only');
});
it('does not infer transactional consent from marketing and cancels on withdrawal/regrant or privacy withdrawal', async () => {
  const f = await fixture();
  await f.svc.review(f.reviewer, f.project, f.t.id, review, 1);
  await f.svc.preference(f.citizen, f.project, { ...f.prefs, purpose: 'marketing' }, 0);
  await expect(f.svc.queue(f.maker, f.project, f.queue)).rejects.toMatchObject({ status: 428 });
  await f.svc.preference(f.citizen, f.project, f.prefs, 0);
  const a = await f.svc.queue(f.maker, f.project, f.queue);
  await f.svc.preference(f.citizen, f.project, { ...f.prefs, enabled: false }, 1);
  await f.svc.preference(f.citizen, f.project, f.prefs, 2);
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 2)).rejects.toMatchObject({
    status: 409,
  });
  const b = await f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() });
  await new PrivacyService(db).withdraw(f.citizen);
  expect((await f.svc.deliver(f.maker, f.project, b.id, accepted, 1)).status).toBe('cancelled');
  // Withdrawing notification preferences remains possible without an active processing grant.
  expect(
    (await f.svc.preference(f.citizen, f.project, { ...f.prefs, enabled: false }, 3)).enabled,
  ).toBe(false);
  expect((await f.svc.citizenWorkspace(f.citizen)).items).toHaveLength(0);
});
it('keeps providers disabled by default and supports only bounded explicit retries with stable provider idempotency', async () => {
  const f = await ready('email');
  const config = {
    channel: 'email',
    enabled: true,
    adapterId: 'test-email',
    maxAttempts: 2,
    accepted: true,
  };
  const calls: string[] = [];
  f.svc.transports.set('test-email', {
    channel: 'email',
    supportsIdempotency: true,
    send: async (input) => {
      calls.push(input.idempotencyKey);
      return { accepted: calls.length > 1, deliveryRef: 'synthetic-' + calls.length };
    },
  });
  await expect(f.svc.configure(f.reviewer, f.project, config, 0)).rejects.toMatchObject({
    status: 503,
  });
  const a = await f.svc.queue(f.maker, f.project, f.queue);
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 1)).rejects.toMatchObject({
    status: 503,
  });
  expect(calls).toHaveLength(0);
  process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'true';
  await f.svc.configure(f.reviewer, f.project, config, 0);
  const failed = await f.svc.deliver(f.maker, f.project, a.id, accepted, 1);
  expect(failed.status).toBe('failed');
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 1)).rejects.toMatchObject({
    status: 409,
  });
  const sent = await f.svc.deliver(f.maker, f.project, a.id, accepted, 2);
  expect(sent.status).toBe('delivered');
  expect(calls).toEqual([a.id, a.id]);
  await f.svc.deliver(f.maker, f.project, a.id, accepted, 2);
  expect(calls).toHaveLength(2);
  delete process.env.NOTIFICATIONS_EXTERNAL_ENABLED;
});
it('does not retry unknown provider results or exceed an approved attempt budget', async () => {
  const f = await ready('zalo');
  process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'true';
  let calls = 0;
  f.svc.transports.set('test-zalo', {
    channel: 'zalo',
    supportsIdempotency: true,
    send: async () => {
      calls++;
      throw new Error('provider-private-secret must never leak');
    },
  });
  await f.svc.configure(
    f.reviewer,
    f.project,
    { channel: 'zalo', enabled: true, adapterId: 'test-zalo', maxAttempts: 3, accepted: true },
    0,
  );
  const a = await f.svc.queue(f.maker, f.project, f.queue),
    unknown = await f.svc.deliver(f.maker, f.project, a.id, accepted, 1);
  expect(unknown.status).toBe('outcome_unknown');
  expect(JSON.stringify(unknown)).not.toContain('private-secret');
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 2)).rejects.toMatchObject({
    status: 409,
  });
  expect(calls).toBe(1);
  f.svc.transports.set('test-zalo', {
    channel: 'zalo',
    supportsIdempotency: true,
    send: async () => ({ accepted: false, deliveryRef: 'synthetic-rejected' }),
  });
  await f.svc.configure(
    f.reviewer,
    f.project,
    { channel: 'zalo', enabled: true, adapterId: 'test-zalo', maxAttempts: 1, accepted: true },
    1,
  );
  const b = await f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() });
  expect((await f.svc.deliver(f.maker, f.project, b.id, accepted, 1)).status).toBe('failed');
  await expect(f.svc.deliver(f.maker, f.project, b.id, accepted, 2)).rejects.toMatchObject({
    status: 409,
  });
  delete process.env.NOTIFICATIONS_EXTERNAL_ENABLED;
});
it('enforces organization/project/current employee scope and never exposes another customer inbox', async () => {
  const a = await ready(),
    b = await ready();
  const msg = await a.svc.queue(a.maker, a.project, a.queue);
  await a.svc.deliver(a.maker, a.project, msg.id, accepted, 1);
  await expect(a.svc.read(b.citizen, msg.id, accepted, 2)).rejects.toMatchObject({ status: 404 });
  await expect(a.svc.workspace(b.maker, a.project)).rejects.toMatchObject({ status: 404 });
  await expect(a.svc.preference(b.citizen, a.project, b.prefs, 0)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    a.svc.queue({ ...a.maker, projectIds: [randomUUID()] }, a.project, {
      ...a.queue,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  const employee = randomUUID(),
    staff: Staff = {
      ...a.maker,
      role: 'staff',
      subject: 'synthetic-revoked-employee',
      projectIds: [a.project],
    };
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,permissions,status) VALUES($1,$2,$3,$4,'administration',$5,'active')",
    [employee, a.org, staff.subject, 'Synthetic employee', ['records_read', 'records_write']],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [a.org, employee, a.project],
  );
  expect((await a.svc.workspace(staff, a.project)).templates).toHaveLength(1);
  await db.query("UPDATE identity_private.investor_employees SET status='suspended' WHERE id=$1", [
    employee,
  ]);
  await expect(a.svc.workspace(staff, a.project)).rejects.toMatchObject({ status: 403 });
  expect((await a.svc.citizenWorkspace(b.citizen)).items).toHaveLength(0);
});
it('cancels unsent work when a template is revoked; rejects stale preferences and denies direct runtime grants', async () => {
  const f = await ready(),
    a = await f.svc.queue(f.maker, f.project, f.queue);
  await expect(
    f.svc.preference(f.citizen, f.project, { ...f.prefs, enabled: false }, 0),
  ).rejects.toMatchObject({ status: 409 });
  await f.svc.review(f.reviewer, f.project, f.t.id, { ...review, decision: 'revoke' }, 2);
  expect((await f.svc.workspace(f.maker, f.project)).messages[0]!.status).toBe('cancelled');
  const reviewRows = await db.query(
    'SELECT decision FROM identity_private.notification_template_reviews WHERE template_id=$1 ORDER BY version',
    [f.t.id],
  );
  expect(reviewRows.map((r) => r.decision)).toEqual(['approve', 'revoke']);
  await expect(
    db.query('DELETE FROM identity_private.notification_template_reviews WHERE template_id=$1', [
      f.t.id,
    ]),
  ).rejects.toThrow('append-only');
  await expect(f.svc.deliver(f.maker, f.project, a.id, accepted, 2)).rejects.toMatchObject({
    status: 409,
  });
  const [p] = await db.query(
    "SELECT has_table_privilege('noxh_runtime','identity_private.notification_messages','SELECT') AS allowed",
  );
  expect(p!.allowed).toBe(false);
  await expect(
    db.query(
      "UPDATE identity_private.notification_messages SET status='delivered',attempt_count=1,version=version+1 WHERE id=$1",
      [a.id],
    ),
  ).rejects.toThrow();
});
it('authenticates every controller action before invoking the service', async () => {
  const staff = {
    authenticate: async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    },
  } as unknown as WorkforceAuth;
  const phone = {
    authenticate: async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    },
  } as unknown as PhoneService;
  const controller = new NotificationController(new NotificationService(db), staff, phone),
    p = randomUUID(),
    id = randomUUID();
  for (const action of [
    () => controller.workspace(undefined, p),
    () => controller.draft(undefined, p, {}),
    () => controller.review(undefined, p, id, {}, '1'),
    () => controller.queue(undefined, p, {}),
    () => controller.deliver(undefined, p, id, {}, '1'),
    () => controller.configure(undefined, p, {}, '0'),
    () => controller.citizen(undefined),
    () => controller.preference(undefined, p, {}, '0'),
    () => controller.read(undefined, id, {}, '1'),
  ])
    await expect(action()).rejects.toMatchObject({ status: 401 });
});

it('does not revive queued authorization after general privacy withdrawal and regrant', async () => {
  const f = await ready(),
    a = await f.svc.queue(f.maker, f.project, f.queue);
  const privacy = new PrivacyService(db),
    n = (await privacy.current(f.org))!;
  await privacy.withdraw(f.citizen);
  await privacy.choose(f.citizen, { noticeId: n.id, contentHash: n.content_hash, accepted: true });
  expect((await f.svc.citizenWorkspace(f.citizen)).preferences[0]!.enabled).toBe(false);
  await expect(
    f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 428 });
  expect((await f.svc.deliver(f.maker, f.project, a.id, accepted, 1)).status).toBe('cancelled');
  await f.svc.preference(f.citizen, f.project, f.prefs, 1);
  expect(
    (await f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() })).status,
  ).toBe('queued');
});
it('reloads independent review grants within the transaction instead of trusting a stale signed permission', async () => {
  const f = await fixture();
  await db.query(
    "UPDATE identity_private.investor_employees SET status='suspended' WHERE organization_id=$1 AND subject=$2",
    [f.org, f.reviewer.subject],
  );
  await expect(f.svc.review(f.reviewer, f.project, f.t.id, review, 1)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    f.svc.configure(
      f.reviewer,
      f.project,
      { channel: 'email', enabled: true, adapterId: 'test-email', maxAttempts: 1, accepted: true },
      0,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
it('cancels unsent notifications for a disabled customer and denies creating a fresh delivery for that account', async () => {
  const f = await ready(),
    a = await f.svc.queue(f.maker, f.project, f.queue);
  await db.query("UPDATE users SET status='disabled' WHERE organization_id=$1 AND id=$2", [
    f.org,
    f.user,
  ]);
  expect((await f.svc.deliver(f.maker, f.project, a.id, accepted, 1)).status).toBe('cancelled');
  await expect(
    f.svc.queue(f.maker, f.project, { ...f.queue, idempotencyKey: randomUUID() }),
  ).rejects.toMatchObject({ status: 404 });
});
