import 'reflect-metadata';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { Database, type Row } from './database';
import { ZaloIdentityService, ZaloIdentityTransport } from './zalo-identity-service';
import { PhoneService, ZaloDelivery } from './phone-service';
import { digest, seal, sha } from './identity-crypto';
import type { Staff } from './workforce';
const original = { ...process.env };
let pg: PGlite, db: Database;
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUTH_HASH_KEY = '1'.repeat(64);
  process.env.AUTH_ENCRYPTION_KEY = '2'.repeat(64);
  process.env.ZALO_MINIAPP_ENABLED = 'true';
  pg = new PGlite();
  for (const f of (await readdir(resolve('../..', 'db/migrations'))).sort())
    await pg.exec(await readFile(resolve('../..', 'db/migrations', f), 'utf8'));
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
}, 90000);
afterAll(async () => {
  await pg.close();
  process.env = original;
});
async function fixture() {
  const org = randomUUID(),
    app = '987654321',
    secret = 'SYNTHETIC-REVIEW-SECRET-' + randomUUID(),
    token = 'SYNTHETIC-REVIEW-TOKEN-' + randomUUID();
  process.env.AUTH_ORGANIZATION_ID = org;
  await db.query(
    "INSERT INTO organizations(id,name) VALUES($1,'Synthetic independent identity review')",
    [org],
  );
  const phone = new PhoneService(db, new ZaloDelivery()),
    provider = new ZaloIdentityTransport();
  provider.profile = async (accessToken, key) => {
    if (accessToken !== token || key !== secret)
      throw Object.assign(new Error('Synthetic provider rejection'), { status: 401 });
    return { subject: 'SYNTHETIC-SAME-SUBJECT' };
  };
  const service = new ZaloIdentityService(db, phone, provider),
    admin: Staff = { organizationId: org, subject: 'synthetic-review-admin', role: 'org_admin' };
  await service.configure(admin, { enabled: true, appId: app, appSecret: secret }, 0);
  async function person(n: number) {
    const user = randomUUID(),
      session = randomBytes(32).toString('base64url');
    await db.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
      user,
      org,
    ]);
    await db.query(
      'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
      [org, user, digest('phone', org + ':synthetic-' + n), seal('8490000000' + n, 'phone:' + org)],
    );
    await db.query(
      "INSERT INTO identity_private.citizen_sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
      [sha(session), org, user],
    );
    return { user, bearer: 'Bearer ' + session };
  }
  const one = await person(1),
    two = await person(2);
  const start = (bearer: string) =>
    service.startLink(bearer, { accessToken: token, accepted: true }, 'synthetic-review-peer');
  const confirm = (bearer: string, c: { challengeId: string; challengeProof: string }) =>
    service.confirmLink(
      bearer,
      {
        challengeId: c.challengeId,
        challengeProof: c.challengeProof,
        accessToken: token,
        accepted: true,
      },
      'synthetic-review-peer',
    );
  return { org, app, token, secret, phone, provider, service, admin, one, two, start, confirm };
}
it('allows only one winner when simultaneous exchanges use the same linked-account challenge', async () => {
  const f = await fixture();
  await f.confirm(f.one.bearer, await f.start(f.one.bearer));
  const c = await f.service.challenge({}, 'synthetic-review-peer'),
    body = {
      challengeId: c.challengeId,
      challengeProof: c.challengeProof,
      accessToken: f.token,
      accepted: true,
    };
  const outcomes = await Promise.allSettled([
    f.service.exchange(body, 'synthetic-review-peer'),
    f.service.exchange(body, 'synthetic-review-peer'),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const sessions = await db.query(
    "SELECT * FROM identity_private.citizen_sessions WHERE organization_id=$1 AND auth_method='zalo-miniapp'",
    [f.org],
  );
  expect(sessions).toHaveLength(1);
  const success = outcomes.find((r) => r.status === 'fulfilled');
  if (success?.status !== 'fulfilled' || !success.value.sessionEstablished)
    throw Error('Synthetic exchange did not succeed');
  expect((await f.phone.authenticate('Bearer ' + success.value.sessionToken)).userId).toBe(
    f.one.user,
  );
});
it('binds confirmation to the exact fresh phone session even for the same customer', async () => {
  const f = await fixture(),
    c = await f.start(f.one.bearer),
    other = randomBytes(32).toString('base64url');
  await db.query(
    "INSERT INTO identity_private.citizen_sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [sha(other), f.org, f.one.user],
  );
  await expect(f.confirm('Bearer ' + other, c)).rejects.toMatchObject({ status: 401 });
  expect(await f.confirm(f.one.bearer, c)).toMatchObject({ linked: true });
  const rows = await db.query(
    'SELECT user_id FROM identity_private.zalo_identity_links WHERE organization_id=$1',
    [f.org],
  );
  expect(rows.map((r) => r.user_id)).toEqual([f.one.user]);
});
it('does not merge two phone owners racing to link the same verified provider subject', async () => {
  const f = await fixture(),
    [a, b] = await Promise.all([f.start(f.one.bearer), f.start(f.two.bearer)]);
  const results = await Promise.allSettled([
    f.confirm(f.one.bearer, a),
    f.confirm(f.two.bearer, b),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
  expect(
    await db.query('SELECT id FROM identity_private.zalo_identity_links WHERE organization_id=$1', [
      f.org,
    ]),
  ).toHaveLength(1);
  const [{ n }] = (await db.query('SELECT count(*)::int AS n FROM users WHERE organization_id=$1', [
    f.org,
  ])) as [{ n: number }];
  expect(n).toBe(2);
});
it('fails closed on an enabled-config rotation during verification and keeps credentials out of persisted auth records', async () => {
  const f = await fixture();
  await f.confirm(f.one.bearer, await f.start(f.one.bearer));
  const c = await f.service.challenge({}, 'synthetic-review-peer'),
    profile = f.provider.profile.bind(f.provider);
  let once = true;
  f.provider.profile = async (token, secret) => {
    const r = await profile(token, secret);
    if (once) {
      once = false;
      await f.service.configure(f.admin, { enabled: true, appId: f.app, appSecret: f.secret }, 1);
    }
    return r;
  };
  await expect(
    f.service.exchange(
      {
        challengeId: c.challengeId,
        challengeProof: c.challengeProof,
        accessToken: f.token,
        accepted: true,
      },
      'synthetic-review-peer',
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await db.query(
      "SELECT token_hash FROM identity_private.citizen_sessions WHERE organization_id=$1 AND auth_method='zalo-miniapp'",
      [f.org],
    ),
  ).toHaveLength(0);
  const persisted = JSON.stringify(
    await db.query(
      'SELECT row_to_json(c) AS c FROM identity_private.zalo_identity_challenges c WHERE organization_id=$1',
      [f.org],
    ),
  );
  expect(persisted).not.toContain(f.token);
  expect(persisted).not.toContain(c.challengeProof);
  expect(persisted).not.toContain(f.secret);
});
