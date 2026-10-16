import 'reflect-metadata';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile, chmod, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Database, type Row } from './database';
import type { Staff } from './workforce';
import { auditHash } from './audit';
import { AuditCheckpointService } from './audit-checkpoint-service';
import { AuditCheckpointController } from './audit-checkpoint-controller';
import {
  checkpointHash,
  parseAuditProposal,
  parseAuditTrustedKeys,
  signAuditCheckpoint,
  verifyCheckpointSignature,
} from './audit-checkpoint-protocol';
import type { WorkforceAuth } from './workforce';

const prior = { ...process.env },
  root = resolve('../..');
let pg: PGlite, db: Database;
const keys = generateKeyPairSync('ed25519'),
  otherKeys = generateKeyPairSync('ed25519');
beforeAll(async () => {
  delete process.env.DATABASE_URL;
  process.env.AUDIT_VERIFIER_BIN = resolve(root, 'target/release/audit-verifier');
  pg = new PGlite();
  const files = (await readdir(resolve(root, 'db/migrations')))
    .filter((f) => /^0(?:0[1-9]|1[0-4])_/.test(f) || f === '017_audit_checkpoints.sql')
    .sort();
  for (const f of files) await pg.exec(await readFile(resolve(root, 'db/migrations', f), 'utf8'));
  db = new Database();
  db.testExecutor = { query: async (q, v = []) => ({ rows: (await pg.query<Row>(q, v)).rows }) };
}, 30000);
afterAll(async () => {
  await pg.close();
  process.env = prior;
});

async function fixture(count = 3) {
  const org = randomUUID(),
    author: Staff = { subject: 'synthetic-author', organizationId: org, role: 'org_admin' },
    reviewer: Staff = { ...author, subject: 'synthetic-reviewer' };
  const trust = [
    {
      organizationId: org,
      signerId: 'offline-custodian-1',
      publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      notBefore: '2000-01-01T00:00:00.000Z',
      notAfter: '2100-01-01T00:00:00.000Z',
    },
  ];
  process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS = JSON.stringify(trust);
  await pg.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [
    org,
    'Synthetic checkpoint test',
  ]);
  let previous = '0'.repeat(64);
  const ids: string[] = [];
  for (let offset = 0; offset < count; offset += 500) {
    const operationValues: unknown[] = [],
      eventValues: unknown[] = [],
      operations: string[] = [],
      events: string[] = [];
    for (let i = offset; i < Math.min(count, offset + 500); i++) {
      const id = randomUUID(),
        e = {
          id,
          organization_id: org,
          actor_ref: 'synthetic-reference',
          action: 'synthetic.checkpoint-test',
          resource_ref: 'synthetic-resource',
          occurred_at: '2026-01-01T00:00:00.000Z',
          prev_hash: previous,
        };
      ids.push(id);
      const eventHash = auditHash(e),
        opStart = operationValues.length,
        evStart = eventValues.length;
      operationValues.push(id, org, e.actor_ref, e.action, e.resource_ref);
      eventValues.push(
        id,
        org,
        e.actor_ref,
        e.action,
        e.resource_ref,
        e.occurred_at,
        previous,
        eventHash,
      );
      operations.push(
        '(' + Array.from({ length: 5 }, (_, n) => '$' + (opStart + n + 1)).join(',') + ')',
      );
      events.push(
        '(' + Array.from({ length: 8 }, (_, n) => '$' + (evStart + n + 1)).join(',') + ')',
      );
      previous = eventHash;
    }
    await pg.query(
      'INSERT INTO identity_private.operations(id,organization_id,actor_ref,action,resource_ref) VALUES' +
        operations.join(','),
      operationValues,
    );
    await pg.query(
      'INSERT INTO identity_private.audit_chain(id,organization_id,actor_ref,action,resource_ref,occurred_at,prev_hash,event_hash) VALUES' +
        events.join(','),
      eventValues,
    );
  }
  const service = new AuditCheckpointService(db);
  const request = { requestId: randomUUID(), signerId: 'offline-custodian-1' };
  return { org, author, reviewer, trust, service, request, ids };
}

it('pins Ed25519 keys by organization and signer; rejects forged payloads, unknown fields, revoked keys and wrong algorithms', async () => {
  const f = await fixture(),
    p = (await f.service.propose(f.author, f.request)).proposal;
  const signed = signAuditCheckpoint(p, keys.privateKey);
  expect(verifyCheckpointSignature(signed, parseAuditTrustedKeys(f.trust), f.org)).toEqual(signed);
  expect(() =>
    verifyCheckpointSignature(
      { ...signed, proposal: { ...p, cursor: { ...p.cursor, eventCount: '2' } } },
      f.trust,
      f.org,
    ),
  ).toThrow();
  expect(() =>
    verifyCheckpointSignature(signAuditCheckpoint(p, otherKeys.privateKey), f.trust, f.org),
  ).toThrow('INVALID_SIGNATURE');
  expect(() => verifyCheckpointSignature(signed, [], f.org)).toThrow('UNTRUSTED_SIGNER');
  expect(() => verifyCheckpointSignature(signed, f.trust, randomUUID())).toThrow(
    'WRONG_ORGANIZATION',
  );
  expect(() => parseAuditProposal({ ...p, privateKey: 'forbidden' })).toThrow();
  expect(() =>
    signAuditCheckpoint(p, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
  ).toThrow('INVALID_SIGNING_KEY');
  expect(() =>
    verifyCheckpointSignature(
      signed,
      [{ ...f.trust[0]!, notAfter: '2001-01-01T00:00:00.000Z' }],
      f.org,
    ),
  ).toThrow('SIGNER_OUTSIDE_WINDOW');
});

it('requires full organization admin, independent import and idempotent immutable proposals and checkpoints', async () => {
  const f = await fixture();
  await expect(f.service.propose({ ...f.author, role: 'staff' }, f.request)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    f.service.propose({ ...f.author, projectIds: [randomUUID()] }, f.request),
  ).rejects.toMatchObject({ status: 403 });
  process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS = JSON.stringify([{ ...f.trust[0]!, signerId: '123' }]);
  await expect(f.service.propose(f.author, { ...f.request, signerId: 123 })).rejects.toMatchObject({
    status: 400,
  });
  process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS = JSON.stringify(f.trust);
  const proposal = await f.service.propose(f.author, f.request);
  expect((await f.service.propose(f.author, f.request)).proposal).toEqual(proposal.proposal);
  await expect(f.service.propose(f.reviewer, f.request)).rejects.toMatchObject({ status: 409 });
  const envelope = signAuditCheckpoint(proposal.proposal, keys.privateKey);
  await expect(f.service.import(f.author, envelope)).rejects.toMatchObject({ status: 403 });
  expect(await f.service.import(f.reviewer, envelope)).toMatchObject({
    duplicate: false,
    custody: 'not-attested',
  });
  expect(await f.service.import(f.reviewer, envelope)).toMatchObject({
    duplicate: true,
    checkpointHash: checkpointHash(envelope),
  });
  await expect(
    pg.query('UPDATE identity_private.audit_checkpoints SET head=$1 WHERE id=$2', [
      '0'.repeat(64),
      envelope.proposal.id,
    ]),
  ).rejects.toThrow();
  await expect(
    pg.query('DELETE FROM identity_private.audit_checkpoint_proposals WHERE id=$1', [
      envelope.proposal.id,
    ]),
  ).rejects.toThrow();
});

it('rejects cross-organization evidence and prevents competing checkpoint branches from being imported', async () => {
  const f = await fixture(),
    p1 = await f.service.propose(f.author, f.request),
    p2 = await f.service.propose(f.author, { ...f.request, requestId: randomUUID() });
  const env = signAuditCheckpoint(p1.proposal, keys.privateKey);
  await expect(
    f.service.evidence({ ...f.author, organizationId: randomUUID() }, p1.proposal.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    f.service.verify({ ...f.author, organizationId: randomUUID() }, env),
  ).rejects.toMatchObject({ status: 400 });
  await f.service.import(f.reviewer, env);
  await expect(
    f.service.import(f.reviewer, signAuditCheckpoint(p2.proposal, keys.privateKey)),
  ).rejects.toMatchObject({ status: 409 });
});

it('detects a valid but truncated prefix and distinguishes verified checkpoint from newer database events', async () => {
  const f = await fixture(),
    p = (await f.service.propose(f.author, f.request)).proposal,
    signed = signAuditCheckpoint(p, keys.privateKey);
  expect(await f.service.verify(f.reviewer, signed)).toMatchObject({
    valid: true,
    completeToCheckpoint: true,
    currentHeadMatches: false,
    coversGenesis: true,
  });
  await pg.exec('ALTER TABLE identity_private.audit_chain DISABLE TRIGGER immutable_audit_chain');
  try {
    await pg.query('DELETE FROM identity_private.audit_chain WHERE organization_id=$1 AND id=$2', [
      f.org,
      f.ids.at(-1),
    ]);
    await expect(f.service.verify(f.reviewer, signed)).rejects.toMatchObject({ status: 409 });
  } finally {
    await pg.exec('ALTER TABLE identity_private.audit_chain ENABLE TRIGGER immutable_audit_chain');
  }
});

it('does not accept a modified proposal, replay an old branch or fall back when the native verifier fails', async () => {
  const f = await fixture(),
    p = (await f.service.propose(f.author, f.request)).proposal;
  const changed = signAuditCheckpoint(
    { ...p, createdAt: '2026-01-02T00:00:00.000Z' },
    keys.privateKey,
  );
  await expect(f.service.import(f.reviewer, changed)).rejects.toMatchObject({ status: 409 });
  const bad = new AuditCheckpointService(db);
  bad.kernel = async () => {
    throw Object.assign(new Error('synthetic-native-failure'), { status: 503 });
  };
  await expect(
    bad.propose(f.author, { ...f.request, requestId: randomUUID() }),
  ).rejects.toMatchObject({ status: 503 });
  expect(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM identity_private.audit_checkpoint_proposals WHERE organization_id=$1',
        [f.org],
      )
    )[0]!.n,
  ).toBe(1);
  delete process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS;
  await expect(
    f.service.verify(f.reviewer, signAuditCheckpoint(p, keys.privateKey)),
  ).rejects.toMatchObject({ status: 503 });
});

it('retains citizen-runtime denial and fails closed on malformed native checkpoint output', async () => {
  const f = await fixture(),
    p = (await f.service.propose(f.author, f.request)).proposal,
    signed = signAuditCheckpoint(p, keys.privateKey);
  const privileges = (
    await pg.query<{ proposals: boolean; checkpoints: boolean }>(
      "SELECT has_table_privilege('noxh_runtime','identity_private.audit_checkpoint_proposals','SELECT') AS proposals,has_table_privilege('noxh_runtime','identity_private.audit_checkpoints','INSERT') AS checkpoints",
    )
  ).rows[0]!;
  expect(privileges).toEqual({ proposals: false, checkpoints: false });
  const native = f.service.kernel;
  f.service.kernel = async (name, input) => {
    const value = input as { events?: unknown[] };
    return value.events?.length === 0
      ? { valid: true, checked: 0, completeToExpected: true, cursor: {} }
      : native(name, input);
  };
  await expect(f.service.verify(f.reviewer, signed)).rejects.toMatchObject({ status: 503 });
  expect((await f.service.status(f.author)).trustedKeysConfigured).toBe(true);
  delete process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS;
  expect((await f.service.status(f.author)).trustedKeysConfigured).toBe(false);
});

it('verifies more than the old 10,000-event ceiling in bounded Rust pages, with no public completeness claim per page', async () => {
  const f = await fixture(10005),
    p = (await f.service.propose(f.author, f.request)).proposal;
  expect(p.cursor.eventCount).toBe('10005');
  const page = await f.service.evidence(f.author, p.id);
  expect(page.events).toHaveLength(500);
  expect(page.segmentOnly).toBe(true);
  expect(page.nextAfterSequence).toBe(page.events.at(-1)!.sequence);
  const end = await f.service.evidence(f.author, p.id, p.cursor.sequence);
  expect(end.events).toHaveLength(0);
  expect(await f.service.verify(f.reviewer, signAuditCheckpoint(p, keys.privateKey))).toMatchObject(
    { valid: true, completeToCheckpoint: true, verified: p.cursor },
  );
}, 30000);

it('controller authenticates every operation before service access and rejects staff even with a valid identity', async () => {
  const f = await fixture();
  const auth = {
    authenticate: async (header: unknown) => {
      if (header !== 'Bearer synthetic')
        throw Object.assign(new Error('synthetic unauthorized'), { status: 401 });
      return { ...f.author, role: 'staff' };
    },
  } as unknown as WorkforceAuth;
  const controller = new AuditCheckpointController(auth, f.service);
  await expect(controller.status(undefined)).rejects.toMatchObject({ status: 401 });
  await expect(controller.propose('Bearer synthetic', f.request)).rejects.toMatchObject({
    status: 403,
  });
  await expect(controller.evidence(undefined, randomUUID(), '0')).rejects.toMatchObject({
    status: 401,
  });
  await expect(controller.import(undefined, {})).rejects.toMatchObject({ status: 401 });
  await expect(controller.verify(undefined, {})).rejects.toMatchObject({ status: 401 });
});

it('offline CLI signs using a private file and verifies exact independently pinned checkpoint across pages; rejects truncation and unsafe key permissions', async () => {
  const f = await fixture(501),
    p = (await f.service.propose(f.author, f.request)).proposal;
  const dir = await mkdtemp(join(tmpdir(), 'noxh-checkpoint-synthetic-')),
    pages = join(dir, 'pages');
  await mkdir(pages);
  const proposal = join(dir, 'proposal.json'),
    key = join(dir, 'synthetic-private.pem'),
    trust = join(dir, 'trust.json'),
    signed = join(dir, 'signed.json');
  await writeFile(proposal, JSON.stringify(p));
  await writeFile(key, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  await writeFile(trust, JSON.stringify(f.trust));
  const run = (args: string[]) =>
    spawnSync(process.execPath, [resolve(root, 'scripts/audit-checkpoint.mjs'), ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, AUDIT_VERIFIER_BIN: process.env.AUDIT_VERIFIER_BIN },
      timeout: 15000,
    });
  try {
    const first = await f.service.evidence(f.author, p.id),
      second = await f.service.evidence(f.author, p.id, first.nextAfterSequence);
    await writeFile(join(pages, 'page-000001.json'), JSON.stringify(first));
    await writeFile(join(pages, 'page-000002.json'), JSON.stringify(second));
    const sign = run([
      'sign',
      '--proposal',
      proposal,
      '--private-key-file',
      key,
      '--output',
      signed,
    ]);
    expect(sign.status, sign.stderr).toBe(0);
    const envelope = JSON.parse(await readFile(signed, 'utf8'));
    const verify = [
      'verify',
      '--checkpoint-file',
      signed,
      '--checkpoint-hash',
      checkpointHash(envelope),
      '--trust-file',
      trust,
      '--pages-directory',
      pages,
    ];
    expect(run(verify).status).toBe(0);
    await rm(join(pages, 'page-000002.json'));
    expect(run(verify).status).toBe(1);
    await chmod(key, 0o644);
    const unsafe = run([
      'sign',
      '--proposal',
      proposal,
      '--private-key-file',
      key,
      '--output',
      join(dir, 'unsafe.json'),
    ]);
    expect(unsafe.status).toBe(1);
    expect(unsafe.stderr).not.toContain('PRIVATE KEY');
    const wrong = [...verify];
    wrong[wrong.indexOf(checkpointHash(envelope))] = createHash('sha256')
      .update('wrong independent checkpoint')
      .digest('hex');
    expect(run(wrong).status).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // Five independently bounded CLI invocations can exceed 30 seconds on a loaded host.
  // Keep each child at 15 seconds; the aggregate budget also includes the SQL fixture.
}, 120000);
