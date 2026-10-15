import { sha } from './identity-crypto';
import type { Row, Sql } from './database';
export function auditHash(r: Row) {
  return sha(
    JSON.stringify([
      'audit-v1',
      r.id,
      r.organization_id,
      r.actor_ref,
      r.action,
      r.resource_ref,
      r.occurred_at,
      r.prev_hash,
    ]),
  );
}
export async function appendAudit(
  sql: Sql,
  id: string,
  organizationId: string,
  actor: string,
  action: string,
  resource: string,
) {
  await sql.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['audit:' + organizationId]);
  const previous = (
    await sql.query(
      'SELECT event_hash FROM identity_private.audit_chain WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1',
      [organizationId],
    )
  ).rows[0];
  const r = {
    id,
    organization_id: organizationId,
    actor_ref: actor,
    action,
    resource_ref: resource,
    occurred_at: new Date().toISOString(),
    prev_hash: previous?.event_hash ?? '0'.repeat(64),
  };
  await sql.query(
    'INSERT INTO identity_private.audit_chain(id,organization_id,actor_ref,action,resource_ref,occurred_at,prev_hash,event_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, organizationId, actor, action, resource, r.occurred_at, r.prev_hash, auditHash(r)],
  );
}
export function verifyAudit(rows: Row[]) {
  let previous = '0'.repeat(64);
  for (const row of rows) {
    if (row.prev_hash !== previous || auditHash(row) !== row.event_hash)
      return { valid: false, checked: rows.length, brokenAt: String(row.id) };
    previous = String(row.event_hash);
  }
  return { valid: true, checked: rows.length, head: previous };
}
