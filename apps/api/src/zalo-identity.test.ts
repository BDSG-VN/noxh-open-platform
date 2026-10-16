import 'reflect-metadata';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { Database } from './database';
import { PhoneService, ZaloDelivery } from './phone-service';
import { AdminService } from './admin-service';
import { ZaloIdentityService, ZaloIdentityTransport } from './zalo-identity-service';
import { seedSyntheticPrivacy } from './test-privacy';
import { digest, seal, sha } from './identity-crypto';
import type { Staff } from './workforce';
const org = '10000000-0000-4000-8000-000000000001',
  owner = '30000000-0000-4000-8000-000000000001',
  dossier = '40000000-0000-4000-8000-000000000001',
  app = '123456789',
  secret = 'SYNTHETIC-MINIAPP-APP-SECRET-ONLY';
const tokenA = 'SYNTHETIC-ACCESS-TOKEN-ALPHA-ONLY',
  tokenB = 'SYNTHETIC-ACCESS-TOKEN-BETA-ONLY';
const staff: Staff = { organizationId: org, subject: 'SYNTHETIC ADMIN', role: 'org_admin' };
class Fake extends ZaloIdentityTransport {
  calls = 0;
  hook?: () => Promise<void>;
  override async profile(token: string, key: string) {
    this.calls++;
    await this.hook?.();
    if (key !== secret || ![tokenA, tokenB].includes(token)) throw { status: 401 };
    return { subject: token === tokenA ? 'SYNTHETIC-SUBJECT-A' : 'SYNTHETIC-SUBJECT-B' };
  }
}
let pg: PGlite,
  db: Database,
  phone: PhoneService,
  service: ZaloIdentityService,
  provider: Fake,
  bearer: string,
  sessionToken: string,
  sent = '';
const prior = { ...process.env };
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_ORGANIZATION_ID = org;
  process.env.AUTH_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.AUTH_HASH_KEY = 'b'.repeat(64);
  delete process.env.ZALO_MINIAPP_ENABLED;
  pg = new PGlite();
  for (const file of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', file), 'utf8'));
  await pg.exec(await readFile(resolve('../..', 'db/fixtures/seed.sql'), 'utf8'));
  db = new Database();
  db.testExecutor = {
    query: async (sql, values = []) => ({
      rows: (await pg.query<Record<string, unknown>>(sql, values)).rows,
    }),
  };
  const delivery = new ZaloDelivery();
  delivery.send = async (_s, _p, code) => {
    sent = code;
  };
  phone = new PhoneService(db, delivery);
  provider = new Fake();
  service = new ZaloIdentityService(db, phone, provider);
  await db.query(
    'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
    [org, owner, digest('phone', org + ':84900000000'), seal('84900000000', 'phone:' + org)],
  );
  await new AdminService(db).saveSettings(
    staff,
    {
      enabled: true,
      oaId: 'SYNTHETIC-OA',
      appId: 'SYNTHETIC-DELIVERY-APP',
      templateId: 'SYNTHETIC-TEMPLATE',
      otpParameter: 'otp',
      accessToken: 'SYNTHETIC-NONPROVIDER-TOKEN',
      appSecret: 'SYNTHETIC-DELIVERY-SECRET',
    },
    0,
  );
  const challenge = await phone.request({ phone: '0900000000', accepted: true }, 'synthetic-peer');
  bearer = 'Bearer ' + (await phone.verify({ ...challenge, code: sent })).sessionToken;
  await seedSyntheticPrivacy(db, [{ organizationId: org, userId: owner }]);
}, 60000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await pg.close();
  process.env = prior;
});

it('defaults off, separates delivery secrets, enforces admin and config version, never returns the Mini App key', async () => {
  expect((await service.status()).enabled).toBe(false);
  await expect(
    service.configure(staff, { enabled: true, appId: app, appSecret: secret }, 0),
  ).rejects.toMatchObject({ status: 503 });
  process.env.ZALO_MINIAPP_ENABLED = 'true';
  await expect(
    service.configure(
      { ...staff, role: 'staff' },
      { enabled: true, appId: app, appSecret: secret },
      0,
    ),
  ).rejects.toMatchObject({ status: 403 });
  await service.configure(staff, { enabled: true, appId: app, appSecret: secret }, 0);
  expect(JSON.stringify(await service.settings(staff))).not.toContain(secret);
  expect(
    (await db.query('SELECT secret_cipher FROM identity_private.zalo_identity_settings'))[0]
      ?.secret_cipher,
  ).not.toContain(secret);
  await expect(service.configure(staff, { enabled: false, appId: app }, 0)).rejects.toMatchObject({
    status: 409,
  });
});

it('requires trusted provider verification and a one-use server challenge; unbound Zalo never creates a user', async () => {
  const challenge = await service.challenge({}, 'synthetic-peer');
  const before = (await db.query('SELECT count(*)::int AS n FROM users'))[0]?.n;
  const result = await service.exchange(
    {
      challengeId: challenge.challengeId,
      challengeProof: challenge.challengeProof,
      accessToken: tokenA,
      accepted: true,
    },
    'synthetic-peer',
  );
  expect(result).toEqual({
    sessionEstablished: false,
    needsLink: true,
    legalIdentityVerified: false,
  });
  expect((await db.query('SELECT count(*)::int AS n FROM users'))[0]?.n).toBe(before);
  await expect(
    service.exchange(
      { ...challenge, expiresIn: undefined, accessToken: tokenA, accepted: true },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.exchange(
      {
        challengeId: challenge.challengeId,
        challengeProof: challenge.challengeProof,
        accessToken: tokenA,
        accepted: true,
      },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
  const other = await service.challenge({}, 'synthetic-peer');
  await expect(
    service.exchange(
      {
        challengeId: other.challengeId,
        challengeProof: other.challengeProof,
        accessToken: 'SYNTHETIC-FOREIGN-APP-TOKEN',
        accepted: true,
      },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    service.exchange(
      {
        challengeId: other.challengeId,
        challengeProof: other.challengeProof,
        accessToken: tokenA,
        accepted: true,
        userId: owner,
      },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 400 });
});

it('bounds challenge proof attempts and expiry before contacting the provider', async () => {
  const nonce = await service.challenge({}, 'synthetic-proof-peer'),
    calls = provider.calls;
  for (let i = 0; i < 5; i++)
    await expect(
      service.exchange(
        {
          challengeId: nonce.challengeId,
          challengeProof: 'x'.repeat(43),
          accessToken: tokenA,
          accepted: true,
        },
        'synthetic-proof-peer',
      ),
    ).rejects.toMatchObject({ status: 401 });
  await expect(
    service.exchange(
      {
        challengeId: nonce.challengeId,
        challengeProof: nonce.challengeProof,
        accessToken: tokenA,
        accepted: true,
      },
      'synthetic-proof-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
  expect(provider.calls).toBe(calls);
  const expired = await service.challenge({}, 'synthetic-proof-peer');
  phone.clock = () => Date.now() + 121000;
  await expect(
    service.exchange(
      {
        challengeId: expired.challengeId,
        challengeProof: expired.challengeProof,
        accessToken: tokenB,
        accepted: true,
      },
      'synthetic-proof-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
  phone.clock = () => Date.now();
});

it('links only after fresh phone OTP and explicit challenge confirmation, then resumes the exact web dossier', async () => {
  await expect(
    service.startLink(undefined, { accessToken: tokenA, accepted: true }, 'synthetic-peer'),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    service.startLink(bearer, { accessToken: tokenA, accepted: false }, 'synthetic-peer'),
  ).rejects.toMatchObject({ status: 400 });
  const proposal = await service.startLink(
    bearer,
    { accessToken: tokenA, accepted: true },
    'synthetic-peer',
  );
  expect(
    (await db.query('SELECT count(*)::int AS n FROM identity_private.zalo_identity_links'))[0]?.n,
  ).toBe(0);
  const confirm = {
    challengeId: proposal.challengeId,
    challengeProof: proposal.challengeProof,
    accessToken: tokenA,
    accepted: true,
  };
  await expect(
    service.confirmLink(bearer, { ...confirm, accessToken: tokenB }, 'synthetic-peer'),
  ).rejects.toMatchObject({ status: 401 });
  await service.confirmLink(bearer, confirm, 'synthetic-peer');
  await expect(service.confirmLink(bearer, confirm, 'synthetic-peer')).rejects.toMatchObject({
    status: 401,
  });
  const challenge = await service.challenge({}, 'synthetic-peer');
  const result = await service.exchange(
    {
      challengeId: challenge.challengeId,
      challengeProof: challenge.challengeProof,
      accessToken: tokenA,
      accepted: true,
    },
    'synthetic-peer',
  );
  expect(result.sessionEstablished).toBe(true);
  if (!result.sessionEstablished) throw Error('synthetic fixture failed');
  sessionToken = result.sessionToken;
  const citizen = await phone.authenticate('Bearer ' + sessionToken);
  expect(citizen).toEqual({ organizationId: org, userId: owner });
  expect((await phone.dashboard(citizen)).dossiers.map((d) => d.id)).toContain(dossier);
  await expect(
    service.startLink(
      'Bearer ' + sessionToken,
      { accessToken: tokenA, accepted: true },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
});

it('refuses account merges and stale phone reauthentication even with a valid Zalo token', async () => {
  const another = '30000000-0000-4000-8000-000000000002',
    phoneToken = randomBytes(32).toString('base64url');
  await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
    another,
    org,
  ]);
  await db.query(
    'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
    [org, another, digest('phone', org + ':84900000001'), seal('84900000001', 'phone:' + org)],
  );
  await db.query(
    "INSERT INTO identity_private.citizen_sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [sha(phoneToken), org, another],
  );
  await expect(
    service.startLink(
      'Bearer ' + phoneToken,
      { accessToken: tokenA, accepted: true },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    service.startLink(bearer, { accessToken: tokenB, accepted: true }, 'synthetic-peer'),
  ).rejects.toMatchObject({ status: 409 });
  await db.query(
    "UPDATE identity_private.citizen_sessions SET created_at=now()-interval '6 minutes' WHERE token_hash=$1",
    [sha(phoneToken)],
  );
  await expect(
    service.startLink(
      'Bearer ' + phoneToken,
      { accessToken: tokenB, accepted: true },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 401 });
});

it('revokes only channel sessions on key rotation/disable and rejects cross-organization sessions', async () => {
  await service.configure(staff, { enabled: true, appId: app, appSecret: secret }, 1);
  await expect(phone.authenticate('Bearer ' + sessionToken)).rejects.toMatchObject({ status: 401 });
  expect((await phone.authenticate(bearer)).userId).toBe(owner);
  const challenge = await service.challenge({}, 'synthetic-peer');
  provider.hook = async () => {
    provider.hook = undefined;
    await service.configure(staff, { enabled: false, appId: app }, 2);
  };
  await expect(
    service.exchange(
      {
        challengeId: challenge.challengeId,
        challengeProof: challenge.challengeProof,
        accessToken: tokenA,
        accepted: true,
      },
      'synthetic-peer',
    ),
  ).rejects.toMatchObject({ status: 503 });
  process.env.AUTH_ORGANIZATION_ID = '10000000-0000-4000-8000-000000000099';
  await expect(phone.authenticate(bearer)).rejects.toMatchObject({ status: 401 });
  process.env.AUTH_ORGANIZATION_ID = org;
});

it('implements official HMAC header contract and rejects success-shaped provider failures, timeouts and oversized bodies', async () => {
  const transport = new ZaloIdentityTransport();
  let seen: RequestInit | undefined;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('https://graph.zalo.me/v2.0/me?fields=id');
    seen = init;
    return new Response(JSON.stringify({ error: 0, id: 'SYNTHETIC-SUBJECT' }));
  });
  expect(await transport.profile(tokenA, secret)).toEqual({ subject: 'SYNTHETIC-SUBJECT' });
  expect(seen?.redirect).toBe('error');
  expect(seen?.headers).toEqual({
    access_token: tokenA,
    appsecret_proof: createHmac('sha256', secret).update(tokenA).digest('hex'),
  });
  for (const body of [
    { error: 1, id: 'ATTACKER' },
    { error: 0, id: 123 },
    { error: 0, id: 'bad\nsubject' },
    { id: 'MISSING-ERROR' },
    { error: 0, id: 'a', padding: 'x'.repeat(17000) },
  ]) {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)));
    await expect(transport.profile(tokenA, secret)).rejects.toMatchObject({ status: 401 });
  }
  vi.stubGlobal('fetch', async () => {
    throw Error('timeout with SENSITIVE PROVIDER TOKEN');
  });
  await expect(transport.profile(tokenA, secret)).rejects.toMatchObject({ status: 401 });
  vi.unstubAllGlobals();
}, 20000);
