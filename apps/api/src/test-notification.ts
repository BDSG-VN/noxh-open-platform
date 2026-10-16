/** Shared synthetic notification fixtures for test files only (excluded from the SQL inventory). */
import { randomUUID } from 'node:crypto';
import { Database } from './database';
import { NotificationService } from './notification-service';
import { PrivacyService } from './privacy-service';
import { seal } from './identity-crypto';
import { seedSyntheticPrivacy } from './test-privacy';
import type { Staff } from './workforce';
export const accepted = { accepted: true };
export const review = {
  decision: 'approve',
  accepted: true,
  note: 'Đã kiểm tra nội dung và mục đích diễn tập độc lập.',
};
export async function fixture(
  db: Database,
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
export async function ready(
  db: Database,
  channel: 'in_app' | 'email' | 'zalo' = 'in_app',
  purpose: 'transactional' | 'marketing' = 'transactional',
) {
  const f = await fixture(db, channel, purpose);
  await f.svc.review(f.reviewer, f.project, f.t.id, review, 1);
  await f.svc.preference(f.citizen, f.project, f.prefs, 0);
  return f;
}
export const emailProvider = (adapterId: string, host = '127.0.0.1', port = 2525) => ({
  channel: 'email',
  adapterId,
  host,
  port,
  security: 'starttls',
  username: 'synthetic-user',
  password: 'synthetic-smtp-password-NEVER-LOGGED',
  from: 'noxh@synthetic.example',
  sinkAddress: 'sink@synthetic.example',
  ratePerMinute: 60,
  accepted: true,
});
export const zaloProvider = (adapterId: string, sinkPhone?: string) => ({
  channel: 'zalo',
  adapterId,
  accessToken: 'synthetic-access-token-NEVER-LOGGED',
  appSecret: 'synthetic-app-secret-NEVER-LOGGED',
  templateId: 'tpl-synthetic',
  titleParameter: 'title',
  bodyParameter: 'content',
  ...(sinkPhone ? { sinkPhone } : {}),
  ratePerMinute: 60,
  accepted: true,
});
