export type Role =
  | 'citizen'
  | 'intake_officer'
  | 'reviewer'
  | 'approver'
  | 'project_manager'
  | 'form_legal_editor'
  | 'form_legal_approver'
  | 'lottery_operator'
  | 'lottery_supervisor'
  | 'auditor'
  | 'infra_admin'
  | 'org_admin';
export type Action =
  | 'dossier:read'
  | 'dossier:write'
  | 'review:assess'
  | 'review:approve'
  | 'form:edit'
  | 'form:approve'
  | 'lottery:operate'
  | 'lottery:certify'
  | 'audit:read';
export interface Grant {
  role: Role;
  organizationId: string;
  projectId: string;
  expiresAt: number;
}
export interface Principal {
  userId: string;
  grants: readonly Grant[];
  verified: boolean;
  mfa: boolean;
}
export interface Resource {
  organizationId: string;
  projectId: string;
  ownerUserId?: string;
  preparedBy?: string;
}
export interface Decision {
  allowed: boolean;
  reason: string;
}
const roles: Record<Action, readonly Role[]> = {
  'dossier:read': ['citizen', 'intake_officer', 'reviewer'],
  'dossier:write': ['citizen'],
  'review:assess': ['reviewer'],
  'review:approve': ['approver'],
  'form:edit': ['form_legal_editor'],
  'form:approve': ['form_legal_approver'],
  'lottery:operate': ['lottery_operator'],
  'lottery:certify': ['lottery_supervisor'],
  'audit:read': ['auditor'],
};
export function authorize(
  principal: Principal | undefined,
  action: Action,
  resource: Resource,
  now = Date.now(),
): Decision {
  if (!principal?.verified || !principal.userId)
    return { allowed: false, reason: 'UNAUTHENTICATED' };
  const candidates = principal.grants.filter(
    (g) =>
      g.organizationId === resource.organizationId &&
      g.projectId === resource.projectId &&
      g.expiresAt > now &&
      roles[action].includes(g.role),
  );
  for (const g of candidates) {
    if (g.role === 'citizen') {
      if (resource.ownerUserId === principal.userId) return { allowed: true, reason: 'OWNER' };
      continue;
    }
    if (!principal.mfa) continue;
    if (
      ['review:approve', 'form:approve', 'lottery:certify'].includes(action) &&
      (!resource.preparedBy || resource.preparedBy === principal.userId)
    )
      continue;
    return { allowed: true, reason: 'SCOPED_GRANT' };
  }
  return { allowed: false, reason: 'NO_MATCHING_GRANT_OR_SEPARATION_OF_DUTIES' };
}
