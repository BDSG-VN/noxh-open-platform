import { describe, it, expect } from 'vitest';
import { authorize, type Principal, type Role } from './index';
const resource = {
  organizationId: 'org-a',
  projectId: 'project-a',
  ownerUserId: 'user-a',
  preparedBy: 'reviewer-a',
};
const p = (role: Role = 'citizen'): Principal => ({
  userId: 'user-a',
  verified: true,
  mfa: true,
  grants: [{ role, organizationId: 'org-a', projectId: 'project-a', expiresAt: 200 }],
});
describe('deny-by-default authorization', () => {
  it('rejects anonymous', () =>
    expect(authorize(undefined, 'dossier:read', resource, 100).allowed).toBe(false));
  it('allows citizen owner', () =>
    expect(authorize(p(), 'dossier:write', resource, 100).allowed).toBe(true));
  it('rejects another owner', () =>
    expect(
      authorize(p(), 'dossier:read', { ...resource, ownerUserId: 'user-b' }, 100).allowed,
    ).toBe(false));
  it('rejects another project', () =>
    expect(
      authorize(p(), 'dossier:read', { ...resource, projectId: 'project-b' }, 100).allowed,
    ).toBe(false));
  it('rejects another organization', () =>
    expect(
      authorize(p(), 'dossier:read', { ...resource, organizationId: 'org-b' }, 100).allowed,
    ).toBe(false));
  it('rejects expired grant', () =>
    expect(authorize(p(), 'dossier:read', resource, 201).allowed).toBe(false));
  it('rejects unverified principal', () =>
    expect(authorize({ ...p(), verified: false }, 'dossier:read', resource, 100).allowed).toBe(
      false,
    ));
  it('rejects staff without MFA', () =>
    expect(
      authorize({ ...p('reviewer'), mfa: false }, 'review:assess', resource, 100).allowed,
    ).toBe(false));
  it('rejects self approval', () =>
    expect(
      authorize({ ...p('approver'), userId: 'reviewer-a' }, 'review:approve', resource, 100)
        .allowed,
    ).toBe(false));
  it('allows independent approver', () =>
    expect(authorize(p('approver'), 'review:approve', resource, 100).allowed).toBe(true));
  it('rejects approval missing author provenance', () =>
    expect(
      authorize(p('approver'), 'review:approve', { ...resource, preparedBy: undefined }, 100)
        .allowed,
    ).toBe(false));
  it('does not grant PII access to infrastructure admin', () =>
    expect(authorize(p('infra_admin'), 'dossier:read', resource, 100).allowed).toBe(false));
});
