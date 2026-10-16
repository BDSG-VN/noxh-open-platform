/** Independent opt-in native PostgreSQL review; never connects without an explicitly disposable loopback URL. */
import 'reflect-metadata';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database, type Sql } from './database';
import { ApplicationService } from './application-service';
import { DossierService } from './dossier-service';
import { NotificationService } from './notification-service';
import { NotificationAutomationService } from './notification-automation-service';
import { recordApplicationNotificationEvent } from './notification-automation-producer';
import { PrivacyService } from './privacy-service';
import { seal } from './identity-crypto';
import type { Staff } from './workforce';
import type { ApplicationNotificationEvent } from '@noxh/contracts';
const supplied = process.env.NOTIFICATION_AUTOMATION_PG_URL;
const prior = { ...process.env };
const pools: Database[] = [];
let administrator: Client, db: Database, workerA: Database, workerB: Database, testDatabase: string;
function freshDb<T extends Database>(Ctor: new () => T, name: string): T {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set('application_name', 'qa021-' + name);
  const old = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.href;
  const value = new Ctor();
  process.env.DATABASE_URL = old;
  pools.push(value);
  return value;
}
class HookDatabase extends Database {
  beforeCommit?: (value: unknown, q: Sql) => Promise<void>;
  beforeQuery?: (sql: string) => Promise<void>;
  override tx<T>(work: (q: Sql) => Promise<T>): Promise<T> {
    return super.tx(async (q) => {
      const wrapped: Sql = {
        query: async (sql, values) => {
          await this.beforeQuery?.(sql);
          return q.query(sql, values);
        },
      };
      const value = await work(wrapped);
      await this.beforeCommit?.(value, q);
      return value;
    });
  }
}
function barrier() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
async function blockedBy(pid: number, owner: number) {
  const end = Date.now() + 1400;
  while (Date.now() < end) {
    const [row] = await db.query('SELECT pg_blocking_pids($1) AS blockers', [pid]);
    if ((row?.blockers as number[]).includes(owner)) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('Expected actual PostgreSQL lock wait was not observed');
}
const review = {
  decision: 'approve',
  accepted: true,
  note: 'Người kiểm tra độc lập rà soát dữ liệu giả lập, không chứng nhận pháp lý.',
};
const prefs = { channel: 'in_app', purpose: 'transactional', enabled: true, accepted: true };
const appService = (d: Database) =>
  new ApplicationService(d, new DossierService(d), new PrivacyService(d));
async function fixture(
  options: {
    consent?: boolean;
    preference?: boolean;
    policy?: boolean;
    eventType?: ApplicationNotificationEvent;
  } = {},
) {
  const org = randomUUID(),
    project = randomUUID(),
    user = randomUUID(),
    dossier = randomUUID(),
    round = randomUUID(),
    application = randomUUID(),
    employee = randomUUID(),
    notice = randomUUID();
  process.env.AUTH_ORGANIZATION_ID = org;
  const maker: Staff = { organizationId: org, subject: 'synthetic-maker', role: 'org_admin' };
  const legal: Staff = {
    ...maker,
    subject: 'synthetic-legal-reviewer',
    permissions: ['form_legal_approver', 'privacy_officer'],
  };
  const reviewer: Staff = {
    ...maker,
    subject: 'synthetic-case-reviewer',
    permissions: ['reviewer'],
  };
  const approver: Staff = {
    ...maker,
    subject: 'synthetic-case-approver',
    permissions: ['approver'],
  };
  const citizen = { organizationId: org, userId: user },
    privacy = new PrivacyService(db),
    manual = new NotificationService(db),
    auto = new NotificationAutomationService(db);
  await db.query("INSERT INTO organizations(id,name) VALUES($1,'Synthetic native PG021 review')", [
    org,
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
  await db.query(
    "INSERT INTO privacy_notices(id,organization_id,version,payload,content_hash,created_by,status,approved_by,approved_at) VALUES($1,$2,1,'{}',$3,'SYNTHETIC AUTHOR','approved','SYNTHETIC REVIEWER',now())",
    [notice, org, 'c'.repeat(64)],
  );
  const choose = () =>
    privacy.choose(citizen, { noticeId: notice, contentHash: 'c'.repeat(64), accepted: true });
  if (options.consent !== false) await choose();
  await db.query(
    "INSERT INTO intake_rounds(id,organization_id,project_id,name,status,opens_at,closes_at) VALUES($1,$2,$3,'Synthetic closed intake','closed','2025-01-01','2025-02-01')",
    [round, org, project],
  );
  await db.query(
    "INSERT INTO applications(id,organization_id,project_id,round_id,dossier_id,owner_user_id,receipt_code,public_code,status,snapshot_cipher,snapshot_hash,input_version,consent_notice_id,synthetic,idempotency_key,request_hash,assigned_reviewer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'under_review',$9,$10,1,$11,true,$12,$13,$14)",
    [
      application,
      org,
      project,
      round,
      dossier,
      user,
      'DEMO-NATIVE-' + application,
      'DEMO-' + application,
      seal(
        JSON.stringify({ mode: 'buy', subjectGroup: 5 }),
        'application:' + org + ':' + application,
      ),
      'a'.repeat(64),
      notice,
      randomUUID(),
      'b'.repeat(64),
      reviewer.subject,
    ],
  );
  await db.query(
    "INSERT INTO identity_private.investor_employees(id,organization_id,subject,name,department,status,permissions) VALUES($1,$2,$3,'NGƯỜI DUYỆT GIẢ LẬP','legal','active',$4)",
    [employee, org, legal.subject, legal.permissions],
  );
  await db.query(
    'INSERT INTO investor_employee_projects(organization_id,employee_id,project_id) VALUES($1,$2,$3)',
    [org, employee, project],
  );
  const template = await manual.draft(maker, project, {
    name: 'Thông báo giả lập',
    title: 'Hồ sơ {applicationCode}',
    body: 'Dự án {projectName}: {reference}',
    basis: 'Chỉ phục vụ kiểm thử dữ liệu giả lập, không xác lập giao dịch pháp lý.',
    channel: 'in_app',
    purpose: 'transactional',
    idempotencyKey: randomUUID(),
  });
  await manual.review(legal, project, template.id, review, 1);
  if (options.preference !== false && options.consent !== false)
    await manual.preference(citizen, project, prefs, 0);
  const eventType = options.eventType ?? 'application.supplement-requested';
  let policy: Awaited<ReturnType<NotificationAutomationService['draft']>> | undefined;
  if (options.policy !== false) {
    policy = await auto.draft(maker, project, {
      eventType,
      templateId: template.id,
      idempotencyKey: randomUUID(),
    });
    await auto.review(legal, project, policy.id, review, 1);
  }
  return {
    org,
    project,
    user,
    dossier,
    application,
    employee,
    notice,
    maker,
    legal,
    reviewer,
    approver,
    citizen,
    privacy,
    manual,
    auto,
    template,
    policy,
    eventType,
    choose,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function source(f: Fixture, d = db) {
  const service = appService(d);
  if (f.eventType === 'application.supplement-requested')
    await service.requestSupplement(
      f.reviewer,
      f.application,
      { message: 'Yêu cầu bổ sung hoàn toàn giả lập cho kiểm thử.' },
      1,
    );
  else {
    const r = await service.recommend(
      f.reviewer,
      f.application,
      {
        eligible: f.eventType === 'application.approved',
        reasonCode: 'SYNTHETIC_ONLY',
        reason: 'Đánh giá persona giả lập nhằm kiểm thử kỹ thuật, không quyết định người thật.',
        evidenceRefs: ['synthetic-only'],
        accepted: true,
      },
      1,
    );
    await service.decide(
      f.approver,
      f.application,
      {
        recommendationId: r.id,
        accepted: true,
        decisionReference: 'SYNTHETIC-TEST-DECISION',
        publicReason: 'Thông tin quyết định chỉ phục vụ kiểm thử giả lập.',
      },
      2,
    );
  }
  const [e] = await db.query(
    'SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1 AND application_id=$2',
    [f.org, f.application],
  );
  return e;
}
async function rows(f: Fixture) {
  return db.query(
    'SELECT * FROM identity_private.notification_automation_events WHERE organization_id=$1 AND application_id=$2',
    [f.org, f.application],
  );
}
async function messages(f: Fixture) {
  return db.query(
    'SELECT * FROM identity_private.notification_messages WHERE organization_id=$1 AND application_id=$2',
    [f.org, f.application],
  );
}
async function expire(f: Fixture) {
  await db.query(
    "UPDATE identity_private.notification_automation_events SET lease_until=now()-interval '1 second',version=version+1 WHERE organization_id=$1 AND status='processing'",
    [f.org],
  );
}

describe.skipIf(!supplied)('independent PostgreSQL021 concurrency and authorization review', () => {
  beforeAll(async () => {
    const base = new URL(supplied!);
    if (
      !['postgres:', 'postgresql:'].includes(base.protocol) ||
      base.hostname !== '127.0.0.1' ||
      base.port !== '23699' ||
      base.pathname !== '/noxh_021_qa'
    )
      throw new Error('Only explicitly disposable isolated PG021 loopback database is permitted');
    administrator = new Client({ connectionString: base.href });
    await administrator.connect();
    const info = (
      await administrator.query(
        "SELECT version() AS version,current_setting('data_directory') AS data",
      )
    ).rows[0];
    if (
      !String(info.version).startsWith('PostgreSQL 17.6') ||
      !String(info.data).includes('completion-notifications021-20261016/pg-data')
    )
      throw new Error('Unexpected PostgreSQL QA instance');
    testDatabase = 'noxh_021_qa_' + randomUUID().replaceAll('-', '').slice(0, 12);
    await administrator.query('CREATE DATABASE "' + testDatabase + '"');
    base.pathname = '/' + testDatabase;
    process.env.DATABASE_URL = base.href;
    process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.AUTH_HASH_KEY = 'b'.repeat(64);
    process.env.NOTIFICATIONS_AUTOMATION_ENABLED = 'true';
    process.env.NOTIFICATIONS_EXTERNAL_ENABLED = 'false';
    db = freshDb(Database, 'producer');
    workerA = freshDb(Database, 'worker-a');
    workerB = freshDb(Database, 'worker-b');
    for (const file of (await readdir(resolve('../..', 'db/migrations'))).sort())
      await db.query(await readFile(resolve('../..', 'db/migrations', file), 'utf8'));
    const a = await workerA.query('SELECT pg_backend_pid() AS pid'),
      b = await workerB.query('SELECT pg_backend_pid() AS pid');
    expect(a[0]!.pid).not.toEqual(b[0]!.pid);
  }, 30000);
  afterAll(async () => {
    await Promise.all(pools.map((d) => d.onModuleDestroy()));
    if (administrator) {
      if (testDatabase)
        await administrator.query('DROP DATABASE "' + testDatabase + '" WITH (FORCE)');
      await administrator.end();
    }
    process.env = prior;
  });

  it('uses real SKIP LOCKED claims and one committed inbox for two workers processing the same claim', async () => {
    const f = await fixture();
    await source(f);
    const held = freshDb(HookDatabase, 'held-claim'),
      entered = barrier(),
      release = barrier();
    held.beforeCommit = async (value) => {
      if (value && typeof value === 'object' && 'leaseToken' in value) {
        entered.open();
        await release.promise;
      }
    };
    const pending = new NotificationAutomationService(held).claimNext(f.org);
    await entered.promise;
    try {
      expect(await new NotificationAutomationService(workerB).claimNext(f.org)).toBeNull();
    } finally {
      release.open();
    }
    const claim = (await pending)!;
    const d = freshDb(HookDatabase, 'held-delivery'),
      inside = barrier(),
      commit = barrier();
    let owner = 0;
    d.beforeCommit = async (value, q) => {
      if (value === 'delivered') {
        owner = Number((await q.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
        inside.open();
        await commit.promise;
      }
    };
    const delivery = new NotificationAutomationService(d).processClaim(claim);
    await inside.promise;
    expect(await messages(f)).toHaveLength(0);
    const pid = Number((await workerB.query('SELECT pg_backend_pid() AS pid'))[0]!.pid);
    const duplicate = new NotificationAutomationService(workerB).processClaim(claim);
    try {
      await blockedBy(pid, owner);
    } finally {
      commit.open();
    }
    expect(await delivery).toBe('delivered');
    expect(await duplicate).toBe('lost');
    expect(await messages(f)).toHaveLength(1);
    expect((await rows(f))[0]!.status).toBe('delivered');
  });

  it('rolls back inbox+ack on a crash before COMMIT, reclaims a fenced lease and delivers once', async () => {
    const f = await fixture();
    await source(f);
    const service = new NotificationAutomationService(workerA),
      claim = (await service.claimNext(f.org))!;
    const fault = freshDb(HookDatabase, 'crash-before-commit');
    let armed = true;
    fault.beforeCommit = async (value) => {
      if (armed && value === 'delivered') {
        armed = false;
        throw new Error('Synthetic crash before COMMIT');
      }
    };
    await expect(new NotificationAutomationService(fault).processClaim(claim)).rejects.toThrow(
      'Synthetic crash',
    );
    expect(await messages(f)).toHaveLength(0);
    expect((await rows(f))[0]!.status).toBe('processing');
    expect(
      await db.query(
        'SELECT * FROM identity_private.notification_attempts WHERE organization_id=$1',
        [f.org],
      ),
    ).toHaveLength(0);
    await expire(f);
    const newer = (await service.claimNext(f.org))!;
    expect(newer.leaseToken).not.toBe(claim.leaseToken);
    expect(await service.processClaim(claim)).toBe('lost');
    expect(await service.processClaim(newer)).toBe('delivered');
    expect(await messages(f)).toHaveLength(1);
  });

  it.each(['consent', 'preference', 'policy'] as const)(
    'never revives an event after a later %s grant',
    async (missing) => {
      const f = await fixture({ [missing]: false });
      const e = await source(f);
      expect(e!.status).toBe('skipped');
      if (missing === 'consent') {
        await f.choose();
        await f.manual.preference(f.citizen, f.project, prefs, 0);
      }
      if (missing === 'preference') await f.manual.preference(f.citizen, f.project, prefs, 0);
      if (missing === 'policy') {
        const p = await f.auto.draft(f.maker, f.project, {
          eventType: f.eventType,
          templateId: f.template.id,
          idempotencyKey: randomUUID(),
        });
        await f.auto.review(f.legal, f.project, p.id, review, 1);
      }
      expect(await f.auto.claimNext(f.org)).toBeNull();
      expect(await messages(f)).toHaveLength(0);
      expect((await rows(f))[0]!.status).toBe('skipped');
    },
  );

  it('pins privacy grant and preference revisions across withdraw/regrant', async () => {
    const f = await fixture();
    await source(f);
    await f.privacy.withdraw(f.citizen);
    await f.choose();
    const [pref] = await db.query(
      'SELECT version FROM identity_private.notification_preferences WHERE organization_id=$1 AND user_id=$2',
      [f.org, f.user],
    );
    await f.manual.preference(f.citizen, f.project, prefs, Number(pref!.version));
    const c = (await f.auto.claimNext(f.org))!;
    expect(await f.auto.processClaim(c)).toBe('skipped');
    expect(await messages(f)).toHaveLength(0);
  });

  it('linearizes an in-flight delivery before a concurrent withdrawal on real organization locks', async () => {
    const f = await fixture();
    await source(f);
    const claim = (await f.auto.claimNext(f.org))!;
    const deliveryDb = freshDb(HookDatabase, 'privacy-delivery-first');
    const withdrawingDb = freshDb(Database, 'privacy-withdraw-second');
    const entered = barrier(),
      release = barrier();
    let owner = 0;
    deliveryDb.beforeCommit = async (value, q) => {
      if (value === 'delivered') {
        owner = Number((await q.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
        entered.open();
        await release.promise;
      }
    };
    const delivery = new NotificationAutomationService(deliveryDb).processClaim(claim);
    await entered.promise;
    const withdrawPid = Number(
      (await withdrawingDb.query('SELECT pg_backend_pid() AS pid'))[0]!.pid,
    );
    const withdrawal = new PrivacyService(withdrawingDb).withdraw(f.citizen);
    try {
      await blockedBy(withdrawPid, owner);
    } finally {
      release.open();
      await Promise.allSettled([delivery, withdrawal]);
    }
    expect(await delivery).toBe('delivered');
    await withdrawal;
    expect(await messages(f)).toHaveLength(1);
    expect((await f.privacy.workspace(f.citizen)).accepted).toBe(false);
  });

  it('suppresses delivery when a concurrent withdrawal commits first', async () => {
    const f = await fixture();
    await source(f);
    const claim = (await f.auto.claimNext(f.org))!;
    const withdrawingDb = freshDb(HookDatabase, 'privacy-withdraw-first');
    const consumingDb = freshDb(Database, 'privacy-delivery-second');
    const entered = barrier(),
      release = barrier();
    let held = false;
    const owner = Number((await withdrawingDb.query('SELECT pg_backend_pid() AS pid'))[0]!.pid);
    withdrawingDb.beforeQuery = async (sql) => {
      if (!held && sql.startsWith('INSERT INTO identity_private.operations')) {
        held = true;
        entered.open();
        await release.promise;
      }
    };
    const withdrawal = new PrivacyService(withdrawingDb).withdraw(f.citizen);
    await Promise.race([
      entered.promise,
      withdrawal.then(() => {
        throw new Error('Withdrawal missed barrier');
      }),
    ]);
    const processPid = Number((await consumingDb.query('SELECT pg_backend_pid() AS pid'))[0]!.pid);
    const delivery = new NotificationAutomationService(consumingDb).processClaim(claim);
    try {
      await blockedBy(processPid, owner);
    } finally {
      release.open();
      await Promise.allSettled([withdrawal, delivery]);
    }
    await withdrawal;
    expect(await delivery).toBe('skipped');
    expect((await rows(f))[0]!.reason).toBe('consent_unavailable');
    expect(await messages(f)).toHaveLength(0);
  });

  it.each(['permission', 'project-grant', 'suspended'] as const)(
    'revalidates the independent policy reviewer after %s revocation',
    async (kind) => {
      const f = await fixture();
      await source(f);
      if (kind === 'permission')
        await db.query(
          "UPDATE identity_private.investor_employees SET permissions='{}',version=version+1 WHERE id=$1",
          [f.employee],
        );
      if (kind === 'project-grant')
        await db.query('DELETE FROM investor_employee_projects WHERE employee_id=$1', [f.employee]);
      if (kind === 'suspended')
        await db.query(
          "UPDATE identity_private.investor_employees SET status='suspended',version=version+1 WHERE id=$1",
          [f.employee],
        );
      const c = (await f.auto.claimNext(f.org))!;
      expect(await f.auto.processClaim(c)).toBe('skipped');
      expect((await rows(f))[0]!.reason).toBe('rule_unavailable');
      expect(await messages(f)).toHaveLength(0);
    },
  );

  it('does not revive an approved rule after the reviewer is suspended and regranted', async () => {
    const f = await fixture();
    await source(f);
    await db.query(
      "UPDATE identity_private.investor_employees SET status='suspended',version=version+1 WHERE id=$1",
      [f.employee],
    );
    await db.query(
      "UPDATE identity_private.investor_employees SET status='active',version=version+1 WHERE id=$1",
      [f.employee],
    );
    const c = (await f.auto.claimNext(f.org))!;
    expect(await f.auto.processClaim(c)).toBe('skipped');
    expect((await rows(f))[0]!.reason).toBe('rule_unavailable');
    expect(await messages(f)).toHaveLength(0);
  });

  it('honors policy/template revoke before consumption and keeps terminal events terminal', async () => {
    for (const kind of ['policy', 'template'] as const) {
      const f = await fixture();
      await source(f);
      const c = (await f.auto.claimNext(f.org))!;
      if (kind === 'policy')
        await f.auto.review(f.legal, f.project, f.policy!.id, { ...review, decision: 'revoke' }, 2);
      else
        await f.manual.review(
          f.legal,
          f.project,
          f.template.id,
          { ...review, decision: 'revoke' },
          2,
        );
      expect(['lost', 'skipped']).toContain(await f.auto.processClaim(c));
      expect(await messages(f)).toHaveLength(0);
      expect((await rows(f))[0]!.status).toBe('skipped');
    }
  });

  it('stops a rejected decision notice after real reopen, while approved reopen remains prohibited', async () => {
    const f = await fixture({ eventType: 'application.rejected' });
    await source(f);
    await appService(db).reopen(
      f.approver,
      f.application,
      { reason: 'Mở lại phiên thẩm định giả lập để kiểm tra phiên bản sự kiện.', accepted: true },
      3,
    );
    const c = (await f.auto.claimNext(f.org))!;
    expect(await f.auto.processClaim(c)).toBe('skipped');
    expect((await rows(f))[0]!.reason).toBe('application_stale');
    const approved = await fixture({ eventType: 'application.approved' });
    await source(approved);
    await expect(
      appService(db).reopen(
        approved.approver,
        approved.application,
        { reason: 'Không tự thu hồi suất đã phê duyệt trong bài kiểm thử.', accepted: true },
        3,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await approved.auto.processClaim((await approved.auto.claimNext(approved.org))!)).toBe(
      'delivered',
    );
  });

  it('cannot process a foreign organization claim, detach immutable owner/project, or deliver to a disabled user', async () => {
    const f = await fixture();
    const e = await source(f);
    await expect(f.auto.claimNext(randomUUID())).rejects.toMatchObject({ status: 403 });
    await expect(
      f.auto.processClaim({
        id: String(e!.id),
        organizationId: randomUUID(),
        leaseToken: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      db.query('UPDATE applications SET owner_user_id=$2,version=version+1 WHERE id=$1', [
        f.application,
        randomUUID(),
      ]),
    ).rejects.toThrow();
    await expect(
      db.query('UPDATE applications SET project_id=$2,version=version+1 WHERE id=$1', [
        f.application,
        randomUUID(),
      ]),
    ).rejects.toThrow();
    await db.query("UPDATE users SET status='disabled',version=version+1 WHERE id=$1", [f.user]);
    expect(await f.auto.processClaim((await f.auto.claimNext(f.org))!)).toBe('skipped');
    expect((await rows(f))[0]!.reason).toBe('recipient_unavailable');
  });

  it('bounds poison SQL failures to three attempts without leaking or half-persisting inbox rows', async () => {
    const f = await fixture();
    await source(f);
    await db.query(
      "CREATE FUNCTION public.qa021_poison() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id='" +
        f.org +
        "'::uuid THEN RAISE EXCEPTION 'synthetic storage failure'; END IF; RETURN NEW; END $$",
    );
    await db.query(
      'CREATE TRIGGER qa021_poison BEFORE INSERT ON identity_private.notification_messages FOR EACH ROW EXECUTE FUNCTION public.qa021_poison()',
    );
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const stats = await f.auto.runConfiguredBatch();
        expect(stats.claimed).toBe(1);
        expect(stats.failed).toBe(1);
        expect(Number((await rows(f))[0]!.attempt_count)).toBe(attempt);
        expect(await messages(f)).toHaveLength(0);
        if (attempt < 3)
          await db.query(
            "UPDATE identity_private.notification_automation_events SET next_attempt_at=now()-interval '1 second',version=version+1 WHERE organization_id=$1",
            [f.org],
          );
      }
      expect((await rows(f))[0]).toMatchObject({ status: 'failed', reason: 'attempts_exhausted' });
      expect(await f.auto.claimNext(f.org)).toBeNull();
    } finally {
      await db.query('DROP TRIGGER qa021_poison ON identity_private.notification_messages');
      await db.query('DROP FUNCTION public.qa021_poison()');
    }
  });

  it('atomically rolls back the source action, event and audit before COMMIT, then retries once without recursive events', async () => {
    const f = await fixture(),
      fault = freshDb(HookDatabase, 'source-rollback');
    let armed = true;
    fault.beforeCommit = async (value) => {
      if (armed && value && typeof value === 'object' && 'saved' in value) {
        armed = false;
        throw new Error('Synthetic source transaction crash');
      }
    };
    await expect(source(f, fault)).rejects.toThrow('Synthetic source transaction crash');
    expect(await rows(f)).toHaveLength(0);
    expect(
      (await db.query('SELECT status,version FROM applications WHERE id=$1', [f.application]))[0],
    ).toMatchObject({ status: 'under_review', version: 1 });
    const e = (await source(f))!;
    await db.tx((q) =>
      recordApplicationNotificationEvent(q, {
        organizationId: f.org,
        applicationId: f.application,
        applicationVersion: 2,
        eventType: f.eventType,
        sourceRef: randomUUID(),
      }),
    );
    expect(await rows(f)).toHaveLength(1);
    expect(String((await rows(f))[0]!.source_ref)).toBe(String(e.source_ref));
    expect(await f.auto.processClaim((await f.auto.claimNext(f.org))!)).toBe('delivered');
    expect(await rows(f)).toHaveLength(1);
    expect(await messages(f)).toHaveLength(1);
    expect(
      await db.query(
        "SELECT * FROM identity_private.audit_chain WHERE organization_id=$1 AND action='application.supplement-requested'",
        [f.org],
      ),
    ).toHaveLength(1);
  });

  it('keeps automation tables private and enforces organization RLS for a non-bypass role', async () => {
    const f = await fixture();
    await source(f);
    const [privilege] = await db.query(
      "SELECT has_table_privilege('noxh_runtime','identity_private.notification_automation_events','SELECT') AS allowed",
    );
    expect(privilege!.allowed).toBe(false);
    await expect(
      db.tx(async (q) => {
        await q.query('SET LOCAL ROLE noxh_runtime');
        await q.query('SELECT id FROM identity_private.notification_automation_events');
      }),
    ).rejects.toMatchObject({ code: '42501' });
    const rollback = new Error('Rollback temporary QA-only grants');
    await expect(
      db.tx(async (q) => {
        // Temporary SELECT grants exist only in this rollback transaction; production
        // migration intentionally grants no private-table access to noxh_runtime.
        await q.query('GRANT USAGE ON SCHEMA identity_private TO noxh_runtime');
        await q.query(
          'GRANT SELECT ON identity_private.notification_automation_events TO noxh_runtime',
        );
        await q.query('SET LOCAL ROLE noxh_runtime');
        const role = (
          await q.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
        ).rows[0]!;
        expect(role.rolsuper).toBe(false);
        expect(role.rolbypassrls).toBe(false);
        await q.query("SELECT set_config('app.organization_id','',true)");
        expect(
          (await q.query('SELECT id FROM identity_private.notification_automation_events')).rows,
        ).toHaveLength(0);
        await q.query("SELECT set_config('app.organization_id',$1,true)", [randomUUID()]);
        expect(
          (await q.query('SELECT id FROM identity_private.notification_automation_events')).rows,
        ).toHaveLength(0);
        await q.query("SELECT set_config('app.organization_id',$1,true)", [f.org]);
        expect(
          (await q.query('SELECT id FROM identity_private.notification_automation_events')).rows,
        ).toHaveLength(1);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      (
        await db.query(
          "SELECT has_table_privilege('noxh_runtime','identity_private.notification_automation_events','SELECT') AS allowed",
        )
      )[0]!.allowed,
    ).toBe(false);
  });

  it('serializes a source FK wait against template revocation without an audit-lock deadlock', async () => {
    const f = await fixture(),
      revokeDb = freshDb(HookDatabase, 'template-revoke'),
      sourceDb = freshDb(Database, 'source-template-race'),
      entered = barrier(),
      release = barrier();
    let held = false;
    let owner = 0;
    revokeDb.beforeQuery = async (sql) => {
      if (!held && sql.startsWith('INSERT INTO identity_private.operations')) {
        held = true;
        entered.open();
        await release.promise;
      }
    };
    owner = Number((await revokeDb.query('SELECT pg_backend_pid() AS pid'))[0]!.pid);
    const revocation = new NotificationService(revokeDb).review(
      f.legal,
      f.project,
      f.template.id,
      { ...review, decision: 'revoke' },
      2,
    );
    await Promise.race([
      entered.promise,
      revocation.then(() => {
        throw new Error('Revocation finished before barrier');
      }),
    ]);
    const sourcePid = Number((await sourceDb.query('SELECT pg_backend_pid() AS pid'))[0]!.pid);
    const action = source(f, sourceDb);
    try {
      // The FK may wait for the template's changing indexed status. Source must not
      // hold the audit lock while waiting, otherwise releasing review deadlocks.
      await blockedBy(sourcePid, owner);
    } finally {
      release.open();
      await Promise.allSettled([revocation, action]);
    }
    await revocation;
    expect((await action)!.status).toBe('pending');
    expect(await f.auto.processClaim((await f.auto.claimNext(f.org))!)).toBe('skipped');
    expect(await messages(f)).toHaveLength(0);
  });
});
