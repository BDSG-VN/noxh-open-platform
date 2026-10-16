import 'reflect-metadata';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database, type Row } from './database';
import { NotificationService } from './notification-service';
import { NotificationAutomationService } from './notification-automation-service';
import { NotificationAutomationLifecycle } from './notification-automation-lifecycle';
import {
  notificationAutomationEnabled,
  recordApplicationNotificationEvent,
} from './notification-automation-producer';
import { ApplicationService } from './application-service';
import type { DossierService } from './dossier-service';
import { PrivacyService } from './privacy-service';
import { seal, unseal } from './identity-crypto';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff } from './workforce';
const prior = { ...process.env };
let pg: PGlite, db: Database;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  pg = new PGlite();
  for (const file of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', file), 'utf8'));
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
}, 90000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
const review = {
  decision: 'approve',
  accepted: true,
  note: 'Đã đối chiếu quy tắc trong ứng dụng cho dữ liệu diễn tập.',
};
async function fixture(
  approve = true,
  preference = true,
  eventType:
    | 'application.supplement-requested'
    | 'application.approved'
    | 'application.rejected' = 'application.supplement-requested',
  syntheticApplication = true,
) {
  const org = randomUUID(),
    project = randomUUID(),
    user = randomUUID(),
    dossier = randomUUID(),
    round = randomUUID(),
    app = randomUUID(),
    employee = randomUUID();
  process.env.NOTIFICATIONS_AUTOMATION_ENABLED = 'true';
  process.env.AUTH_ORGANIZATION_ID = org;
  const maker: Staff = {
    organizationId: org,
    subject: 'synthetic-author',
    role: 'org_admin',
    permissions: ['reviewer', 'approver'],
  };
  const legal: Staff = {
    ...maker,
    subject: 'synthetic-independent-reviewer',
    permissions: ['form_legal_approver'],
  };
  const citizen = { organizationId: org, userId: user };
  await db.query("INSERT INTO organizations(id,name) VALUES($1,'Synthetic 021')", [org]);
  await db.query(
    "INSERT INTO projects(id,organization_id,name,locality,is_synthetic) VALUES($1,$2,'Synthetic 021','Synthetic locality',true)",
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
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'Synthetic round','open','2025-01-01','2030-01-01')",
    [round, org, project],
  );
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash,assigned_reviewer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'under_review',$9,$10,1,$11,$15,$12,$13,$14)",
    [
      app,
      org,
      project,
      round,
      dossier,
      user,
      'DEMO-RECEIPT-' + app,
      'DEMO-' + app.toUpperCase(),
      seal(JSON.stringify({ mode: 'buy' }), 'application:' + org + ':' + app),
      'a'.repeat(64),
      n.id,
      randomUUID(),
      'b'.repeat(64),
      maker.subject,
      syntheticApplication,
    ],
  );
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,permissions,status) VALUES($1,$2,$3,'Synthetic legal reviewer','legal',$4,'active')",
    [employee, org, legal.subject, ['form_legal_approver']],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, employee, project],
  );
  const notifications = new NotificationService(db),
    svc = new NotificationAutomationService(db),
    application = new ApplicationService(db, {} as DossierService, new PrivacyService(db));
  const template = await notifications.draft(maker, project, {
    name: 'Hồ sơ diễn tập',
    title: 'Hồ sơ {applicationCode}',
    body: 'Dự án {projectName}: {reference}',
    basis: 'Quy trình thông báo nghiệp vụ chỉ trong ứng dụng với dữ liệu giả lập.',
    channel: 'in_app',
    purpose: 'transactional',
    idempotencyKey: randomUUID(),
  });
  await notifications.review(legal, project, template.id, review, 1);
  const policy = await svc.draft(maker, project, {
    eventType,
    templateId: template.id,
    idempotencyKey: randomUUID(),
  });
  if (approve) await svc.review(legal, project, policy.id, review, 1);
  if (preference)
    await notifications.preference(
      citizen,
      project,
      { channel: 'in_app', purpose: 'transactional', enabled: true, accepted: true },
      0,
    );
  return {
    org,
    project,
    user,
    app,
    dossier,
    employee,
    maker,
    legal,
    citizen,
    notifications,
    svc,
    application,
    template,
    policy,
  };
}
async function emit(f: Awaited<ReturnType<typeof fixture>>) {
  await f.application.requestSupplement(
    f.maker,
    f.app,
    { message: 'SYNTHETIC_PRIVATE_REASON_NOT_FOR_NOTIFICATION_BODY' },
    1,
  );
  return (
    await db.query(
      'SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1',
      [f.org],
    )
  )[0]!;
}
async function rows(f: Awaited<ReturnType<typeof fixture>>) {
  return db.query(
    'SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1',
    [f.org],
  );
}
async function expire(id: string) {
  await db.query(
    "UPDATE identity_private.notification_automation_events SET lease_until=now()-interval '1 second',version=version+1 WHERE id=$1",
    [id],
  );
}
it('real supplement mutation emits exactly one metadata event; worker atomically creates one encrypted inbox and ack', async () => {
  const f = await fixture();
  const e = await emit(f);
  expect(e.status).toBe('pending');
  expect(e.application_version).toBe(2);
  await expect(
    f.application.requestSupplement(f.maker, f.app, { message: 'replay' }, 1),
  ).rejects.toMatchObject({ status: 409 });
  const stats = await f.svc.runConfiguredBatch();
  expect(stats).toEqual({ claimed: 1, delivered: 1, skipped: 0, failed: 0 });
  expect((await f.svc.runConfiguredBatch()).claimed).toBe(0);
  const inbox = await f.notifications.citizenWorkspace(f.citizen);
  expect(inbox.items).toHaveLength(1);
  expect(inbox.items[0]!.body).not.toContain('SYNTHETIC_PRIVATE_REASON');
  expect((await rows(f))[0]!.status).toBe('delivered');
  const m = (
    await db.query(
      'SELECT payload_cipher FROM identity_private.notification_messages WHERE id=$1',
      [e.id],
    )
  )[0]!;
  expect(String(m.payload_cipher)).not.toContain('Synthetic 021');
  expect(unseal(String(m.payload_cipher), 'notification-message:' + f.org + ':' + e.id)).toContain(
    'Synthetic 021',
  );
  await expect(
    db.query('DELETE FROM identity_private.notification_automation_events WHERE id=$1', [e.id]),
  ).rejects.toThrow();
});
it('both real decision branches emit the typed source event within the application transaction', async () => {
  for (const eligible of [true, false]) {
    const f = await fixture(true, true, eligible ? 'application.approved' : 'application.rejected'),
      recommendation = randomUUID();
    await db.query(
      'INSERT INTO application_reviews(id,application_id,organization_id,input_version,eligible,reviewer,payload_cipher) VALUES($1,$2,$3,1,$4,$5,$6)',
      [
        recommendation,
        f.app,
        f.org,
        eligible,
        'another-independent-reviewer',
        seal('{}', 'application:' + f.org + ':' + f.app),
      ],
    );
    await db.query(
      "UPDATE applications SET status='recommended',recommendation_id=$2,version=2 WHERE id=$1",
      [f.app, recommendation],
    );
    await f.application.decide(
      f.maker,
      f.app,
      {
        recommendationId: recommendation,
        accepted: true,
        decisionReference: 'SYNTHETIC-DECISION',
        publicReason: 'SYNTHETIC_PRIVATE_REASON_NOT_FOR_NOTIFICATION_BODY',
      },
      2,
    );
    expect((await rows(f))[0]!.event_type).toBe(
      eligible ? 'application.approved' : 'application.rejected',
    );
    expect((await f.svc.runConfiguredBatch()).delivered).toBe(1);
  }
});
it('source rollback leaves neither changed application nor outbox event; retry producer is idempotent', async () => {
  const f = await fixture();
  await expect(
    db.tx(async (q) => {
      await q.query("UPDATE applications SET status='supplement',version=2 WHERE id=$1", [f.app]);
      await recordApplicationNotificationEvent(q, {
        organizationId: f.org,
        applicationId: f.app,
        applicationVersion: 2,
        eventType: 'application.supplement-requested',
        sourceRef: f.app,
      });
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect(await rows(f)).toHaveLength(0);
  expect((await db.query('SELECT status FROM applications WHERE id=$1', [f.app]))[0]!.status).toBe(
    'under_review',
  );
  await emit(f);
  await db.tx((q) =>
    recordApplicationNotificationEvent(q, {
      organizationId: f.org,
      applicationId: f.app,
      applicationVersion: 2,
      eventType: 'application.supplement-requested',
      sourceRef: f.app,
    }),
  );
  expect(await rows(f)).toHaveLength(1);
});
it('default-off and malformed/missing-org configuration fail closed without global claims', async () => {
  const f = await fixture();
  delete process.env.NOTIFICATIONS_AUTOMATION_ENABLED;
  await emit(f);
  expect(await rows(f)).toHaveLength(0);
  expect((await f.svc.runConfiguredBatch()).claimed).toBe(0);
  process.env.NOTIFICATIONS_AUTOMATION_ENABLED = 'TRUE';
  expect(() => notificationAutomationEnabled()).toThrow();
  process.env.NOTIFICATIONS_AUTOMATION_ENABLED = 'true';
  delete process.env.AUTH_ORGANIZATION_ID;
  await expect(f.svc.runConfiguredBatch()).rejects.toMatchObject({ status: 503 });
});
it('enabled automation still ignores non-synthetic application or project sources', async () => {
  const f = await fixture(true, false, 'application.supplement-requested', false);
  await f.application.requestSupplement(
    f.maker,
    f.app,
    { message: 'Synthetic test of a non-synthetic marker' },
    1,
  );
  expect(await rows(f)).toHaveLength(0);
  const g = await fixture();
  await db.query('UPDATE projects SET is_synthetic=false WHERE id=$1', [g.project]);
  await g.application.requestSupplement(
    g.maker,
    g.app,
    { message: 'Synthetic test of a non-synthetic project marker' },
    1,
  );
  expect(await rows(g)).toHaveLength(0);
  expect((await g.svc.runConfiguredBatch()).claimed).toBe(0);
});
it('policy approval is independent/current/scoped; duplicates and changed requests cannot bypass it', async () => {
  const f = await fixture(false);
  await expect(
    f.svc.review(
      { ...f.maker, permissions: ['form_legal_approver'] },
      f.project,
      f.policy.id,
      review,
      1,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await db.query("UPDATE identity_private.investor_employees SET status='suspended' WHERE id=$1", [
    f.employee,
  ]);
  await expect(f.svc.review(f.legal, f.project, f.policy.id, review, 1)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    f.svc.workspace({ ...f.maker, organizationId: randomUUID() }, f.project),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.svc.draft(f.maker, f.project, {
      eventType: 'other',
      templateId: f.template.id,
      idempotencyKey: randomUUID(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const key = randomUUID(),
    body = { eventType: 'application.approved', templateId: f.template.id, idempotencyKey: key };
  const a = await f.svc.draft(f.maker, f.project, body);
  expect((await f.svc.draft(f.maker, f.project, body)).id).toBe(a.id);
  await expect(
    f.svc.draft(f.maker, f.project, { ...body, eventType: 'application.rejected' }),
  ).rejects.toMatchObject({ status: 409 });
});
it('unconfigured policy and later opt-in never resurrect skipped source events', async () => {
  const f = await fixture(false, false);
  await emit(f);
  expect((await rows(f))[0]!.reason).toBe('no_policy');
  await f.svc.review(f.legal, f.project, f.policy.id, review, 1);
  await f.notifications.preference(
    f.citizen,
    f.project,
    { channel: 'in_app', purpose: 'transactional', enabled: true, accepted: true },
    0,
  );
  expect((await f.svc.runConfiguredBatch()).claimed).toBe(0);
  const g = await fixture(true, false);
  await emit(g);
  expect((await rows(g))[0]!.reason).toBe('preference_unavailable');
  await g.notifications.preference(
    g.citizen,
    g.project,
    { channel: 'in_app', purpose: 'transactional', enabled: true, accepted: true },
    0,
  );
  expect((await g.svc.runConfiguredBatch()).claimed).toBe(0);
});
it('withdraw and regrant of processing or channel consent cancels the old authorization', async () => {
  for (const channel of [true, false]) {
    const f = await fixture();
    await emit(f);
    if (channel) {
      await f.notifications.preference(
        f.citizen,
        f.project,
        { channel: 'in_app', purpose: 'transactional', enabled: false, accepted: true },
        1,
      );
      await f.notifications.preference(
        f.citizen,
        f.project,
        { channel: 'in_app', purpose: 'transactional', enabled: true, accepted: true },
        2,
      );
    } else {
      const privacy = new PrivacyService(db);
      await privacy.withdraw(f.citizen);
      const n = (await privacy.current(f.org))!;
      await privacy.choose(f.citizen, {
        noticeId: n.id,
        contentHash: n.content_hash,
        accepted: true,
      });
    }
    expect((await f.svc.runConfiguredBatch()).skipped).toBe(1);
    expect((await f.notifications.citizenWorkspace(f.citizen)).items).toHaveLength(0);
  }
});
it('current rule/template/reviewer/project/application state is rechecked before dispatch', async () => {
  for (const kind of [
    'rule',
    'template',
    'reviewer',
    'reviewer-regrant',
    'project',
    'application',
  ]) {
    const f = await fixture();
    await emit(f);
    if (kind === 'rule')
      await f.svc.review(f.legal, f.project, f.policy.id, { ...review, decision: 'revoke' }, 2);
    if (kind === 'template')
      await f.notifications.review(
        f.legal,
        f.project,
        f.template.id,
        { ...review, decision: 'revoke' },
        2,
      );
    if (kind === 'reviewer')
      await db.query(
        "UPDATE identity_private.investor_employees SET status='suspended' WHERE id=$1",
        [f.employee],
      );
    if (kind === 'reviewer-regrant') {
      await db.query(
        "UPDATE identity_private.investor_employees SET status='suspended',version=version+1 WHERE id=$1",
        [f.employee],
      );
      await db.query(
        "UPDATE identity_private.investor_employees SET status='active',version=version+1 WHERE id=$1",
        [f.employee],
      );
    }
    if (kind === 'project')
      await db.query('UPDATE projects SET archived_at=now() WHERE id=$1', [f.project]);
    if (kind === 'application') await f.application.withdraw(f.citizen, f.app, 2);
    await f.svc.runConfiguredBatch();
    expect((await rows(f))[0]!.status).toBe('skipped');
    expect((await f.notifications.citizenWorkspace(f.citizen)).items).toHaveLength(0);
  }
});
it('a manually queued idempotency collision is never overwritten or delivered by automation', async () => {
  const f = await fixture();
  const e = await emit(f);
  const manual = await f.notifications.queue(f.maker, f.project, {
    templateId: f.template.id,
    applicationId: f.app,
    reference: 'Thông báo thủ công diễn tập tách biệt',
    idempotencyKey: e.id,
  });
  expect((await f.svc.runConfiguredBatch()).skipped).toBe(1);
  expect((await rows(f))[0]!.reason).toBe('idempotency_conflict');
  const messages = await db.query(
    'SELECT id,status FROM identity_private.notification_messages WHERE organization_id=$1',
    [f.org],
  );
  expect(messages).toHaveLength(1);
  expect(messages[0]!.id).toBe(manual.id);
  expect(messages[0]!.status).toBe('queued');
});
it('leases fence stale consumers, recover crash-before-commit, and stop after three abandoned claims', async () => {
  const f = await fixture();
  await emit(f);
  const old = (await f.svc.claimNext(f.org))!;
  await expire(old.id);
  const current = (await f.svc.claimNext(f.org))!;
  expect(await f.svc.processClaim(old)).toBe('lost');
  expect(await f.svc.processClaim(current)).toBe('delivered');
  const g = await fixture();
  await emit(g);
  const claim = (await g.svc.claimNext(g.org))!;
  const tx = db.tx.bind(db);
  const spy = vi.spyOn(db, 'tx').mockImplementationOnce((work) =>
    tx(async (q) => {
      await work(q);
      throw new Error('synthetic crash before COMMIT');
    }),
  );
  await expect(g.svc.processClaim(claim)).rejects.toThrow('synthetic crash');
  spy.mockRestore();
  expect((await g.notifications.citizenWorkspace(g.citizen)).items).toHaveLength(0);
  await expire(claim.id);
  expect(await g.svc.processClaim((await g.svc.claimNext(g.org))!)).toBe('delivered');
  const h = await fixture();
  await emit(h);
  for (let i = 0; i < 3; i++) {
    const lease = (await h.svc.claimNext(h.org))!;
    await expire(lease.id);
  }
  expect(await h.svc.claimNext(h.org)).toBeNull();
  expect((await rows(h))[0]!.status).toBe('failed');
  expect((await rows(h))[0]!.attempt_count).toBe(3);
});
it('bounded retries preserve failure evidence and cross-org claims are rejected', async () => {
  const f = await fixture();
  await emit(f);
  await expect(f.svc.claimNext(randomUUID())).rejects.toMatchObject({ status: 403 });
  const broken = vi
    .spyOn(f.svc, 'processClaim')
    .mockRejectedValue(new Error('synthetic internal failure'));
  for (let i = 0; i < 3; i++) {
    expect((await f.svc.runConfiguredBatch()).failed).toBe(1);
    if (i < 2)
      await db.query(
        "UPDATE identity_private.notification_automation_events SET next_attempt_at=now()-interval '1 second',version=version+1 WHERE organization_id=$1",
        [f.org],
      );
  }
  broken.mockRestore();
  expect((await rows(f))[0]!.status).toBe('failed');
  expect((await f.svc.runConfiguredBatch()).claimed).toBe(0);
});
it('interval lifecycle is opt-in/unref and does not overlap or claim more work after shutdown', async () => {
  const service = {
    configuredOrganization: (): string | null => null,
    runConfiguredBatch: vi.fn(),
  };
  const off = new NotificationAutomationLifecycle(
    service as unknown as NotificationAutomationService,
  );
  off.onApplicationBootstrap();
  expect(service.runConfiguredBatch).not.toHaveBeenCalled();
  await off.onModuleDestroy();
  let complete: (value: {
    claimed: number;
    delivered: number;
    skipped: number;
    failed: number;
  }) => void = () => {};
  const pending = new Promise<{
    claimed: number;
    delivered: number;
    skipped: number;
    failed: number;
  }>((resolve) => {
    complete = resolve;
  });
  service.runConfiguredBatch.mockReturnValue(pending);
  service.configuredOrganization = () => 'synthetic-org';
  const live = new NotificationAutomationLifecycle(
    service as unknown as NotificationAutomationService,
  );
  live.tick();
  live.tick();
  expect(service.runConfiguredBatch).toHaveBeenCalledTimes(1);
  const closing = live.onModuleDestroy();
  complete({ claimed: 1, delivered: 1, skipped: 0, failed: 0 });
  await closing;
  live.tick();
  expect(service.runConfiguredBatch).toHaveBeenCalledTimes(1);
  expect(live.status().processedCount).toBe(1);
});
