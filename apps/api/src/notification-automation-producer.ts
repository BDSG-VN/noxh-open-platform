import { ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ApplicationNotificationEvent } from '@noxh/contracts';
import type { Sql } from './database';
export function notificationAutomationEnabled() {
  const value = process.env.NOTIFICATIONS_AUTOMATION_ENABLED;
  if (value === undefined || value === 'false') return false;
  if (value !== 'true')
    throw new ServiceUnavailableException('Cờ thông báo tự động phải là true hoặc false');
  return true;
}
/** Must use the application's existing transaction. Reads only snapshots; never takes notification locks or sends. */
export async function recordApplicationNotificationEvent(
  q: Sql,
  input: {
    organizationId: string;
    applicationId: string;
    applicationVersion: number;
    eventType: ApplicationNotificationEvent;
    sourceRef: string;
  },
) {
  if (!notificationAutomationEnabled()) return;
  const status = {
    'application.supplement-requested': 'supplement',
    'application.approved': 'approved',
    'application.rejected': 'rejected',
  }[input.eventType];
  if (!status) throw new ServiceUnavailableException('Loại sự kiện thông báo không hợp lệ');
  const a = (
    await q.query(
      `SELECT a.*,p.is_synthetic AS project_synthetic FROM applications a JOIN projects p ON p.id=a.project_id AND p.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.id=$2 AND a.version=$3 AND a.status=$4`,
      [input.organizationId, input.applicationId, input.applicationVersion, status],
    )
  ).rows[0];
  if (!a || a.synthetic !== true || a.project_synthetic !== true) return;
  const rule = (
    await q.query(
      `SELECT r.*,t.status AS template_status,t.version AS current_template_version,t.channel,t.purpose FROM identity_private.notification_automation_policies r JOIN identity_private.notification_templates t ON t.id=r.template_id AND t.organization_id=r.organization_id AND t.project_id=r.project_id WHERE r.organization_id=$1 AND r.project_id=$2 AND r.event_type=$3 AND r.status='approved'`,
      [input.organizationId, a.project_id, input.eventType],
    )
  ).rows[0];
  const choice = (
    await q.query(
      `SELECT c.*,n.status AS notice_status,n.content_hash,n.id AS current_notice_id FROM identity_private.privacy_choices c LEFT JOIN LATERAL(SELECT id,status,content_hash FROM privacy_notices WHERE organization_id=c.organization_id AND status IN('approved','revoked') ORDER BY version DESC LIMIT 1) n ON true WHERE c.organization_id=$1 AND c.user_id=$2 ORDER BY c.sequence DESC LIMIT 1`,
      [input.organizationId, a.owner_user_id],
    )
  ).rows[0];
  const pref = (
    await q.query(
      `SELECT * FROM identity_private.notification_preferences WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 AND channel='in_app' AND purpose='transactional'`,
      [input.organizationId, a.project_id, a.owner_user_id],
    )
  ).rows[0];
  const restricted = (
    await q.query(
      'SELECT restricted FROM identity_private.privacy_preferences WHERE organization_id=$1 AND user_id=$2',
      [input.organizationId, a.owner_user_id],
    )
  ).rows[0];
  let reason: string | null = null;
  if (!rule) reason = 'no_policy';
  else if (
    rule.template_status !== 'approved' ||
    rule.current_template_version !== rule.template_version ||
    rule.channel !== 'in_app' ||
    rule.purpose !== 'transactional'
  )
    reason = 'template_unavailable';
  else if (
    !choice ||
    choice.action !== 'grant' ||
    choice.notice_status !== 'approved' ||
    choice.notice_id !== choice.current_notice_id ||
    choice.notice_hash !== choice.content_hash ||
    restricted?.restricted === true
  )
    reason = 'consent_unavailable';
  else if (
    pref?.enabled !== true ||
    pref.choice_id !== choice.id ||
    pref.notice_id !== choice.notice_id ||
    pref.notice_hash !== choice.notice_hash
  )
    reason = 'preference_unavailable';
  await q.query(
    `INSERT INTO identity_private.notification_automation_events(id,organization_id,project_id,application_id,owner_user_id,event_type,application_version,application_code,source_ref,policy_id,policy_version,template_id,template_version,notice_id,notice_hash,choice_id,preference_version,status,reason,processed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,CASE WHEN $19::text IS NULL THEN NULL ELSE now() END) ON CONFLICT(organization_id,application_id,event_type,application_version) DO NOTHING`,
    [
      randomUUID(),
      input.organizationId,
      a.project_id,
      a.id,
      a.owner_user_id,
      input.eventType,
      input.applicationVersion,
      a.public_code,
      input.sourceRef,
      rule?.id ?? null,
      rule?.version ?? null,
      rule?.template_id ?? null,
      rule?.template_version ?? null,
      choice?.notice_id ?? null,
      choice?.notice_hash ?? null,
      choice?.id ?? null,
      pref?.version ?? null,
      reason ? 'skipped' : 'pending',
      reason,
    ],
  );
}
