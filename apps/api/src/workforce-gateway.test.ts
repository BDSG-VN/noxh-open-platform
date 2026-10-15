import 'reflect-metadata';
import { beforeAll, afterEach, afterAll, it, expect, vi } from 'vitest';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { WorkforceAuth } from './workforce';
import { Database } from './database';

const prior = { ...process.env };
const org = '10000000-0000-4000-8000-000000000001';
let auth: WorkforceAuth, token: string;
beforeAll(async () => {
  process.env.AUTH_ORGANIZATION_ID = org;
  process.env.WORKFORCE_ISSUER = 'https://identity.example.test/realms/provider';
  process.env.WORKFORCE_CLIENT_ID = 'provider-client';
  process.env.WORKFORCE_AUDIENCE = 'provider-api';
  process.env.WORKFORCE_MEMBERSHIP_ENDPOINT = 'https://provider.example.test/api/workforce';
  process.env.WORKFORCE_MEMBERSHIP_KEY = 'a'.repeat(43);
  const db = new Database();
  db.testExecutor = { query: async () => ({ rows: [] }) };
  auth = new WorkforceAuth(db);
  const keys = await generateKeyPair('RS256');
  auth.testKey = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: 'test' }],
  });
  token = await new SignJWT({
    azp: 'provider-client',
    amr: ['otp'],
    realm_access: { roles: ['org_admin', 'privacy_officer'] },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setSubject('synthetic-member')
    .setIssuer(process.env.WORKFORCE_ISSUER)
    .setAudience('provider-api')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(keys.privateKey);
});
afterEach(() => {
  vi.unstubAllGlobals();
  auth.db.testExecutor = { query: async () => ({ rows: [] }) };
});
afterAll(() => {
  process.env = prior;
});
const access = {
  organizationId: org,
  subject: 'synthetic-member',
  active: true,
  role: 'org_admin',
  projectIds: [],
};
function gateway(body: unknown, status = 200) {
  return vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
}
it('requires a fresh provider membership check and ignores realm privilege claims', async () => {
  gateway(access);
  const result = await auth.authenticate('Bearer ' + token);
  expect(result).toMatchObject({ role: 'org_admin', organizationId: org, permissions: [] });
  const call = vi.mocked(fetch).mock.calls[0]!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({
    organizationId: org,
    subject: 'synthetic-member',
  });
  expect(String(call[1]?.body)).not.toContain(token);
  gateway({ ...access, active: false });
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 403 });
});
it('rejects cross-tenant, cross-subject, unknown roles and revoked members', async () => {
  for (const value of [
    { ...access, organizationId: 'another-org' },
    { ...access, subject: 'other-member' },
    { ...access, role: 'super_admin' },
  ]) {
    gateway(value);
    await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 403 });
  }
  gateway({}, 403);
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 403 });
});
it('fails closed on gateway outage, redirect, malformed or oversized response', async () => {
  for (const response of [
    new Response('', { status: 503 }),
    new Response('bad json', { headers: { 'content-type': 'application/json' } }),
    new Response('a'.repeat(4097), { headers: { 'content-type': 'application/json' } }),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 503 });
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw Error('Network unreachable');
    }),
  );
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 503 });
});
it('refuses partial or insecure gateway configuration without making a request', async () => {
  const configured = process.env.WORKFORCE_MEMBERSHIP_ENDPOINT;
  process.env.WORKFORCE_MEMBERSHIP_ENDPOINT = 'http://provider.example.test/api/workforce';
  gateway(access);
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 503 });
  expect(fetch).not.toHaveBeenCalled();
  delete process.env.WORKFORCE_MEMBERSHIP_ENDPOINT;
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 503 });
  process.env.WORKFORCE_MEMBERSHIP_ENDPOINT = configured;
});
it('denies stale local project grants outside the current central scope', async () => {
  const allowed = '20000000-0000-4000-8000-000000000001';
  const removed = '20000000-0000-4000-8000-000000000002';
  let grants = [allowed, removed];
  auth.db.testExecutor = {
    query: async (query: string) => ({
      rows: query.includes('investor_employees')
        ? [{ id: 'synthetic-employee', department: 'business', permissions: ['intake_officer'] }]
        : query.includes('investor_employee_projects')
          ? grants.map((project_id) => ({ project_id }))
          : [],
    }),
  };
  gateway({ ...access, role: 'staff', projectIds: [allowed] });
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 403 });
  grants = [allowed];
  expect(await auth.authenticate('Bearer ' + token)).toMatchObject({
    role: 'staff',
    projectIds: [allowed],
    permissions: ['intake_officer'],
  });
  auth.db.testExecutor = { query: async () => ({ rows: [] }) };
});

it('loads only explicit active tenant-local duties for provider admins, never realm duties', async () => {
  gateway(access);
  let active = true;
  auth.db.testExecutor = {
    query: async (query, values) => {
      if (!query.includes('investor_employees')) return { rows: [] };
      expect(query).toContain("status='active'");
      expect(values).toEqual([org, 'synthetic-member']);
      return {
        rows: active
          ? [{ permissions: ['form_legal_approver', 'lottery_operator', 'unknown_privilege'] }]
          : [],
      };
    },
  };
  expect((await auth.authenticate('Bearer ' + token)).permissions).toEqual([
    'form_legal_approver',
    'lottery_operator',
  ]);
  active = false;
  expect((await auth.authenticate('Bearer ' + token)).permissions).toEqual([]);
});
it('cannot upgrade a provider staff membership using realm admin or privacy roles', async () => {
  const allowed = '20000000-0000-4000-8000-000000000001';
  gateway({ ...access, role: 'staff', projectIds: [allowed] });
  auth.db.testExecutor = {
    query: async (query) => ({
      rows: query.includes('investor_employees')
        ? [{ id: 'synthetic-employee', department: 'business', permissions: ['reviewer'] }]
        : query.includes('investor_employee_projects')
          ? [{ project_id: allowed }]
          : [],
    }),
  };
  expect(await auth.authenticate('Bearer ' + token)).toMatchObject({
    role: 'staff',
    projectIds: [allowed],
    permissions: ['reviewer'],
  });
});
