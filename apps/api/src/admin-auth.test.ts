import { seedSyntheticPrivacy } from './test-privacy';
import 'reflect-metadata';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { Database } from './database';
import { AdminService } from './admin-service';
import { PhoneService, ZaloDelivery } from './phone-service';
import { WorkforceAuth, type Staff } from './workforce';
import { normalizePhone, unseal } from './identity-crypto';
const org = '10000000-0000-4000-8000-000000000001';
const project = '20000000-0000-4000-8000-000000000001';
const staff: Staff = { subject: 'synthetic-staff', organizationId: org, role: 'org_admin' };
let pg: PGlite, db: Database, admin: AdminService, phone: PhoneService;
let sent = '',
  fail = false,
  now = Date.now();
const prior = { ...process.env };
beforeAll(async () => {
  process.env.AUTH_ORGANIZATION_ID = org;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  process.env.WORKFORCE_ISSUER = 'https://identity.example.test/realms/noxh';
  delete process.env.DATABASE_URL;
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (q, v = []) => ({ rows: (await pg.query<Record<string, unknown>>(q, v)).rows }),
  };
  admin = new AdminService(db);
  const delivery = new ZaloDelivery();
  delivery.send = async (_s, _p, c) => {
    if (fail) throw new Error('test delivery rejected');
    sent = c;
  };
  phone = new PhoneService(db, delivery);
  phone.clock = () => now;
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});
const settings = {
  oaId: 'test-oa',
  appId: 'test-app',
  templateId: 'test-template',
  otpParameter: 'otp',
  accessToken: 'test-only-token',
  appSecret: 'test-only-app-secret',
  enabled: true,
};
it('rejects invalid phone and unconfigured or unconsented requests', async () => {
  expect(normalizePhone('090 000 0000')).toBe('84900000000');
  expect(() => normalizePhone('001234')).toThrow();
  await expect(
    phone.request({ phone: '0900000000', accepted: false }, 'test-peer'),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    phone.request({ phone: '0900000000', accepted: true }, 'test-peer'),
  ).rejects.toMatchObject({ status: 503 });
});
it('encrypts provider credentials; metadata never includes secrets; enforces role/version', async () => {
  await expect(
    admin.saveSettings({ ...staff, role: 'project_manager' }, settings, 0),
  ).rejects.toMatchObject({ status: 403 });
  const saved = await admin.saveSettings(staff, settings, 0);
  expect(saved.version).toBe(1);
  expect(JSON.stringify(saved)).not.toContain('test-only');
  const [raw] = await db.query('SELECT secret_cipher FROM identity_private.zalo_settings');
  expect(String(raw?.secret_cipher)).not.toContain(settings.accessToken);
  expect(JSON.parse(unseal(String(raw?.secret_cipher), 'zalo:' + org)).accessToken).toBe(
    settings.accessToken,
  );
  await expect(admin.saveSettings(staff, settings, 0)).rejects.toMatchObject({ status: 409 });
  await admin.saveSettings(staff, { ...settings, accessToken: '', appSecret: '' }, 1);
});
it('checks organization scope, optimistic versions and intake dates', async () => {
  const p = await admin.createProject(staff, {
    name: 'Synthetic new project',
    locality: 'Synthetic district',
  });
  expect(p?.publication_status).toBe('draft');
  await expect(
    admin.updateProject(
      { ...staff, organizationId: '10000000-0000-4000-8000-000000000002' },
      String(p?.id),
      { name: 'stolen', locality: 'x', publicationStatus: 'published' },
      1,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await admin.updateProject(
    staff,
    String(p?.id),
    { name: 'Published test', locality: 'Synthetic district', publicationStatus: 'published' },
    1,
  );
  await expect(
    admin.updateProject(
      staff,
      String(p?.id),
      { name: 'conflict', locality: 'x', publicationStatus: 'published' },
      1,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    admin.saveRound(staff, {
      projectId: p?.id,
      name: 'bad',
      status: 'open',
      opensAt: '2026-11-02T00:00:00Z',
      closesAt: '2026-11-01T00:00:00Z',
    }),
  ).rejects.toMatchObject({ status: 400 });
  const round = await admin.saveRound(staff, {
    projectId: p?.id,
    name: 'Synthetic intake',
    status: 'open',
    opensAt: '2026-11-01T00:00:00Z',
    closesAt: '2026-11-02T00:00:00Z',
  });
  expect(round?.version).toBe(1);
});
it('applies cooldown, commits failed attempts and locks after five wrong codes', async () => {
  const challenge = await phone.request({ phone: '0900000000', accepted: true }, 'test-peer');
  await expect(
    phone.request({ phone: '0900000000', accepted: true }, 'test-peer'),
  ).rejects.toMatchObject({ status: 429 });
  const wrong = sent === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    await expect(phone.verify({ ...challenge, code: wrong })).rejects.toMatchObject({
      status: 401,
    });
  const [row] = await db.query(
    'SELECT attempts,status FROM identity_private.phone_challenges WHERE id=$1',
    [challenge.challengeId],
  );
  expect(row).toMatchObject({ attempts: 5, status: 'locked' });
  await expect(phone.verify({ ...challenge, code: sent })).rejects.toMatchObject({ status: 401 });
});
it('does not create a session when delivery fails', async () => {
  fail = true;
  const [before] = await db.query(
    'SELECT count(*)::int AS n FROM identity_private.citizen_sessions',
  );
  await expect(
    phone.request({ phone: '0900000001', accepted: true }, 'test-peer'),
  ).rejects.toMatchObject({ status: 503 });
  fail = false;
  const [after] = await db.query(
    'SELECT count(*)::int AS n FROM identity_private.citizen_sessions',
  );
  expect(after?.n).toBe(before?.n);
});
it('expires OTP and rejects a browser proof mismatch', async () => {
  const c = await phone.request({ phone: '0900000002', accepted: true }, 'test-peer');
  const code = sent;
  await expect(phone.verify({ ...c, code, challengeProof: 'wrong-browser' })).rejects.toMatchObject(
    { status: 401 },
  );
  now += 300001;
  await expect(phone.verify({ ...c, code })).rejects.toMatchObject({ status: 401 });
});
it('consumes OTP once, scopes customer data, creates draft idempotently and revokes logout', async () => {
  const c = await phone.request({ phone: '0900000003', accepted: true }, 'test-peer');
  const code = sent;
  const outcomes = await Promise.allSettled([
    phone.verify({ ...c, code }),
    phone.verify({ ...c, code }),
  ]);
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const session = outcomes.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<{
    sessionToken: string;
  }>;
  const bearer = 'Bearer ' + session.value.sessionToken;
  const citizen = await phone.authenticate(bearer);
  const initial = await phone.dashboard(citizen);
  expect(initial.dossiers).toHaveLength(0);
  expect(initial.legalIdentityVerified).toBe(false);
  expect(initial.phoneMasked).not.toContain('0900000003');
  await seedSyntheticPrivacy(db, [citizen]);
  const a = await phone.createDossier(citizen, {
    projectId: project,
    ownerId: 'caller-cannot-set-owner',
  });
  const b = await phone.createDossier(citizen, { projectId: project });
  expect(a?.id).toBe(b?.id);
  expect((await phone.dashboard(citizen)).dossiers).toHaveLength(1);
  await admin.updateProject(staff, project, {}, 1, true);
  expect((await phone.dashboard(citizen)).dossiers).toHaveLength(1);
  await expect(phone.createDossier(citizen, { projectId: project })).rejects.toMatchObject({
    status: 400,
  });
  await phone.logout(bearer);
  await expect(phone.authenticate(bearer)).rejects.toMatchObject({ status: 401 });
});
it('prevents mutation of operational audit events', async () => {
  await expect(db.query("UPDATE identity_private.operations SET action='changed'")).rejects.toThrow(
    'append-only',
  );
});
it('validates actual signed JWT claims, MFA and roles, rejects forgery and revoked tokens', async () => {
  const keys = await generateKeyPair('RS256');
  const jwk = await exportJWK(keys.publicKey);
  jwk.kid = 'test';
  const auth = new WorkforceAuth(db);
  auth.testKey = createLocalJWKSet({ keys: [jwk] });
  const sign = (payload: Record<string, unknown>, aud = 'noxh-api') =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject('synthetic-staff')
      .setIssuer(process.env.WORKFORCE_ISSUER!)
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(keys.privateKey);
  const payload = {
    azp: 'noxh-investor',
    amr: ['pwd', 'otp'],
    realm_access: { roles: ['org_admin'] },
  };
  const token = await sign(payload);
  expect((await auth.authenticate('Bearer ' + token)).role).toBe('org_admin');
  await expect(
    auth.authenticate('Bearer ' + (await sign({ ...payload, amr: ['pwd'] }))),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    auth.authenticate(
      'Bearer ' + (await sign({ ...payload, realm_access: { roles: ['project_manager'] } })),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    auth.authenticate('Bearer ' + (await sign(payload, 'other-api'))),
  ).rejects.toMatchObject({ status: 401 });
  await expect(auth.authenticate('Bearer ' + token.slice(0, -5) + 'aaaaa')).rejects.toMatchObject({
    status: 401,
  });
  await auth.logout('Bearer ' + token);
  await expect(auth.authenticate('Bearer ' + token)).rejects.toMatchObject({ status: 401 });
});
