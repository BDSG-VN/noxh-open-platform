import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  createRecoveryBundle,
  restoreRecoveryBundle,
  safeObjectKey,
  validateDrillTarget,
  verifySnapshotCheckpoint,
} from '../scripts/recovery-bundle.mjs';
import { decryptToFile, encryptPayload } from '../scripts/backup-restore.mjs';
const require = createRequire(import.meta.url);
const protocol = require('../apps/api/dist/audit-checkpoint-protocol.js');
const hash = (v) => createHash('sha256').update(v).digest('hex');
const zero = '0'.repeat(64);
async function fixture() {
  const dir = await realpath(await mkdtemp(resolve(tmpdir(), 'noxh-recovery-test-')));
  await chmod(dir, 0o700);
  const objectDirectory = resolve(dir, 'objects');
  await mkdir(objectDirectory, { mode: 0o700 });
  await mkdir(resolve(objectDirectory, 'synthetic'), { mode: 0o700 });
  const bytes = Buffer.from('SYNTHETIC ENCRYPTED OBJECT BYTES — no documents or citizens');
  await writeFile(resolve(objectDirectory, 'synthetic/object-1'), bytes, { mode: 0o600 });
  const org = randomUUID(),
    event = {
      id: randomUUID(),
      organization_id: org,
      actor_ref: 'synthetic-actor',
      action: 'synthetic.recovery',
      resource_ref: 'synthetic-resource',
      occurred_at: '2026-01-01T00:00:00.000Z',
      prev_hash: zero,
      sequence: '7',
    };
  event.event_hash = hash(
    JSON.stringify([
      'audit-v1',
      event.id,
      org,
      event.actor_ref,
      event.action,
      event.resource_ref,
      event.occurred_at,
      zero,
    ]),
  );
  const cursor = {
    sequence: '7',
    head: event.event_hash,
    eventCount: '1',
    sequenceDigest: hash(
      JSON.stringify(['audit-checkpoint-sequence-v1', zero, '7', event.event_hash, event.id]),
    ),
  };
  const pair = generateKeyPairSync('ed25519');
  const signed = protocol.signAuditCheckpoint(
    {
      version: protocol.CHECKPOINT_VERSION,
      id: randomUUID(),
      organizationId: org,
      signerId: 'recovery-test',
      requestedBy: 'a'.repeat(64),
      createdAt: new Date().toISOString(),
      previousCheckpointHash: null,
      cursor,
    },
    pair.privateKey,
  );
  const checkpointTrustFile = resolve(dir, 'trust.json');
  await writeFile(
    checkpointTrustFile,
    JSON.stringify([
      {
        organizationId: org,
        signerId: 'recovery-test',
        publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        notBefore: '2000-01-01T00:00:00.000Z',
        notAfter: '2100-01-01T00:00:00.000Z',
      },
    ]),
  );
  const references = {
    version: 1,
    references: ['application-encryption', 'application-hash', 'identity-signing'].map(
      (purpose) => ({ id: purpose, purpose, version: 'synthetic-v1' }),
    ),
  };
  for (const [name, value] of [
    [
      'identity.json',
      {
        realm: 'synthetic',
        users: [],
        clients: [{ clientId: 'synthetic-web', publicClient: true }],
      },
    ],
    [
      'deployment.json',
      {
        services: [
          { name: 'api', image: 'synthetic:test', secretRefs: ['application-encryption'] },
        ],
      },
    ],
    ['references.json', references],
    ['checkpoint.json', signed],
  ])
    await writeFile(resolve(dir, name), JSON.stringify(value), { mode: 0o600 });
  const migrationsDirectory = resolve(dir, 'migrations');
  await mkdir(migrationsDirectory, { mode: 0o700 });
  const sql = '-- Synthetic migration used only to test checksum replay';
  await writeFile(resolve(migrationsDirectory, '001_synthetic.sql'), sql);
  const migrations = [{ version: '001', sha256: hash(sql) }];
  const objects = [
    {
      object_key: 'synthetic/object-1',
      sha256: hash('synthetic-plaintext'),
      envelope_key_cipher: 'SYNTHETIC SEALED KEY REFERENCE',
    },
  ];
  const client = {
    query: async (query, values) => {
      if (query.includes('SELECT object_key,')) return { rows: objects };
      if (query.includes('schema_migrations')) return { rows: migrations };
      if (query.includes('audit_chain a')) return { rows: BigInt(values[1]) < 7n ? [event] : [] };
      throw Error('Unexpected fixture query');
    },
  };
  let restoreCalls = 0;
  const adapters = {
    backup: async (options) => {
      const snapshotData = await options.snapshotInspect(client);
      await writeFile(options.out, 'SYNTHETIC DB ARCHIVE', { mode: 0o600 });
      return { manifestHash: hash('synthetic-db-manifest'), snapshotData };
    },
    restoreDrill: async (options) => {
      restoreCalls++;
      assert.equal(await readFile(options.input, 'utf8'), 'SYNTHETIC DB ARCHIVE');
      assert.equal(options.drill, true);
      return {
        verified: true,
        manifestHash: hash('synthetic-db-manifest'),
        additionalVerification: await options.verifyRestored(client),
      };
    },
  };
  process.env.AUDIT_VERIFIER_BIN = resolve('target/release/audit-verifier');
  const key = randomBytes(32),
    input = resolve(dir, 'bundle.noxh');
  const capture = {
    sourceUrl: 'postgres://synthetic@localhost/synthetic_source',
    objectDirectory,
    identityConfig: resolve(dir, 'identity.json'),
    deploymentConfig: resolve(dir, 'deployment.json'),
    secretReferences: resolve(dir, 'references.json'),
    checkpoint: resolve(dir, 'checkpoint.json'),
    checkpointTrustFile,
    expectedCheckpointHash: protocol.checkpointHash(signed),
    captureAttestation: {
      writersStopped: true,
      identityWritersStopped: true,
      objectExportCompleted: true,
      observedAt: new Date().toISOString(),
    },
    out: input,
    key,
  };
  const restore = {
    input,
    key,
    targetDirectory: resolve(dir, 'noxh_recovery_' + 'b'.repeat(24)),
    secretAcknowledgements: capture.secretReferences,
    checkpointTrustFile,
    expectedCheckpointHash: capture.expectedCheckpointHash,
    adminUrl: 'postgres://synthetic@127.0.0.1/noxh_recovery_admin',
    migrationsDirectory,
  };
  return {
    dir,
    bytes,
    capture,
    restore,
    adapters,
    client,
    event,
    signed,
    calls: () => restoreCalls,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
async function mutate(f, change, name = 'changed.noxh') {
  const plain = resolve(f.dir, 'plain-' + randomUUID());
  await decryptToFile(f.restore.input, plain, f.restore.key);
  const raw = await readFile(plain),
    length = raw.readUInt32BE(),
    manifest = JSON.parse(raw.subarray(4, 4 + length));
  const data = raw.subarray(4 + length);
  change(manifest, data);
  const bytes = Buffer.from(JSON.stringify(manifest)),
    prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  const out = resolve(f.dir, name);
  await encryptPayload(Readable.from([prefix, bytes, data]), out, f.restore.key, {
    bundleFormat: 'noxh-recovery-bundle-v1',
  });
  await rm(plain);
  return out;
}

test('authenticated recovery plan has no effects; execute stages exact opaque objects/config, checks migrations and signed DB checkpoint', async () => {
  const f = await fixture();
  try {
    const capture = await createRecoveryBundle(f.capture, f.adapters);
    assert.equal(capture.encrypted, true);
    assert.equal(capture.objects, 1);
    assert.equal((await lstat(f.restore.input)).mode & 0o777, 0o600);
    assert.equal((await readFile(f.restore.input)).includes(f.bytes), false);
    const plan = await restoreRecoveryBundle(f.restore, f.adapters);
    assert.equal(plan.plan, true);
    assert.equal(plan.activationAllowed, false);
    assert.equal(f.calls(), 0);
    await assert.rejects(lstat(f.restore.targetDirectory), { code: 'ENOENT' });
    const report = await restoreRecoveryBundle({ ...f.restore, execute: true }, f.adapters);
    assert.equal(f.calls(), 1);
    assert.equal(report.migrationsRechecked, true);
    assert.equal(report.objectReferencesMatch, true);
    assert.equal(report.noServicesStarted, true);
    assert.deepEqual(
      await readFile(resolve(f.restore.targetDirectory, 'objects/00000000.bin')),
      f.bytes,
    );
    assert.equal((await lstat(f.restore.targetDirectory)).mode & 0o777, 0o700);
    assert.equal(
      (await lstat(resolve(f.restore.targetDirectory, 'identity.json'))).mode & 0o777,
      0o600,
    );
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, execute: true }, f.adapters),
      /exists/,
    );
    assert.equal(f.calls(), 1);
  } finally {
    await f.cleanup();
  }
});

test('tampered envelope, authenticated bad checksum, traversal, duplicate and missing inventory stop before database effects', async () => {
  const f = await fixture();
  try {
    await createRecoveryBundle(f.capture, f.adapters);
    const corrupt = Buffer.from(await readFile(f.restore.input));
    corrupt[corrupt.length - 1] ^= 1;
    const path = resolve(f.dir, 'corrupt.noxh');
    await writeFile(path, corrupt);
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, input: path, execute: true }, f.adapters),
    );
    const changes = [
      (m) => {
        m.files[0].path = '../outside';
      },
      (m) => {
        m.files[0].sha256 = '0'.repeat(64);
      },
      (m) => {
        m.files[1].path = m.files[0].path;
      },
      (m) => {
        m.snapshot.objects = [];
      },
      (_m, data) => {
        data[data.length - 1] ^= 1;
      },
    ];
    for (let i = 0; i < changes.length; i++) {
      const input = await mutate(f, changes[i], 'bad-' + i + '.noxh');
      await assert.rejects(
        restoreRecoveryBundle({ ...f.restore, input, execute: true }, f.adapters),
      );
    }
    assert.equal(f.calls(), 0);
    assert.equal(
      (await readdir(f.dir)).some((p) => p.startsWith('.noxh-recovery-')),
      false,
    );
    await assert.rejects(lstat(f.restore.targetDirectory), { code: 'ENOENT' });
  } finally {
    await f.cleanup();
  }
});

test('oversized sparse ciphertext and symlink inputs fail before plaintext or database effects', async () => {
  const f = await fixture();
  try {
    const sparse = resolve(f.dir, 'oversized.noxh'),
      plain = resolve(f.dir, 'must-not-exist');
    const handle = await open(sparse, 'wx', 0o600);
    await handle.truncate(100 * 1024 ** 3 + 16 * 1024 ** 2 + 4 + 12 + 4096 + 16 + 1);
    await handle.close();
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, input: sparse, execute: true }, f.adapters),
      /size limit/,
    );
    await assert.rejects(
      decryptToFile(sparse, plain, f.restore.key, { maxEncryptedBytes: 4096 }),
      /size limit/,
    );
    await assert.rejects(lstat(plain), { code: 'ENOENT' });
    assert.equal(f.calls(), 0);
    assert.equal(
      (await readdir(f.dir)).some((p) => p.startsWith('.noxh-recovery-')),
      false,
    );
    await rm(sparse);
    await createRecoveryBundle(f.capture, f.adapters);
    const link = resolve(f.dir, 'symlink-input.noxh');
    await symlink(f.restore.input, link);
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, input: link, execute: true }, f.adapters),
    );
    await assert.rejects(decryptToFile(link, plain, f.restore.key), { code: 'ELOOP' });
    await assert.rejects(lstat(plain), { code: 'ENOENT' });
    assert.equal(f.calls(), 0);
    assert.equal(
      (await readdir(f.dir)).some((p) => p.startsWith('.noxh-recovery-')),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test('capture refuses missing/extra objects, symlinks, embedded identity credentials and stale writer attestations', async () => {
  const f = await fixture();
  try {
    await rm(resolve(f.capture.objectDirectory, 'synthetic/object-1'));
    await assert.rejects(createRecoveryBundle(f.capture, f.adapters), /missing or extra/);
    await writeFile(resolve(f.capture.objectDirectory, 'synthetic/object-1'), f.bytes);
    await symlink(
      resolve(f.dir, 'identity.json'),
      resolve(f.capture.objectDirectory, 'synthetic/extra'),
    );
    await assert.rejects(createRecoveryBundle(f.capture, f.adapters), /symlinks/);
    await rm(resolve(f.capture.objectDirectory, 'synthetic/extra'));
    await writeFile(resolve(f.capture.objectDirectory, 'synthetic/extra'), 'SYNTHETIC ORPHAN');
    await assert.rejects(createRecoveryBundle(f.capture, f.adapters), /missing or extra/);
    await rm(resolve(f.capture.objectDirectory, 'synthetic/extra'));
    await writeFile(
      f.capture.identityConfig,
      JSON.stringify({ realm: 'synthetic', users: [{ username: 'synthetic' }] }),
    );
    await assert.rejects(createRecoveryBundle(f.capture, f.adapters), /users/);
    await assert.rejects(
      createRecoveryBundle(
        {
          ...f.capture,
          captureAttestation: {
            ...f.capture.captureAttestation,
            observedAt: '2000-01-01T00:00:00.000Z',
          },
        },
        f.adapters,
      ),
      /recent/,
    );
    for (const key of ['../key', '/key', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'a\0b'])
      assert.throws(() => safeObjectKey(key));
  } finally {
    await f.cleanup();
  }
});

test('restore refuses live/source, unsafe/existing targets, missing exact key references and unpinned checkpoints', async () => {
  const f = await fixture();
  try {
    await createRecoveryBundle(f.capture, f.adapters);
    await assert.rejects(
      restoreRecoveryBundle(
        { ...f.restore, adminUrl: f.capture.sourceUrl, execute: true },
        f.adapters,
      ),
      /Source database/,
    );
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, targetDirectory: resolve(f.dir, 'live') }, f.adapters),
      /isolated/,
    );
    await assert.rejects(
      restoreRecoveryBundle(
        { ...f.restore, expectedCheckpointHash: '0'.repeat(64), execute: true },
        f.adapters,
      ),
      /checkpoint hash/,
    );
    const refs = JSON.parse(await readFile(f.restore.secretAcknowledgements));
    refs.references[0].version = 'wrong-version';
    const wrong = resolve(f.dir, 'wrong-refs.json');
    await writeFile(wrong, JSON.stringify(refs));
    await assert.rejects(
      restoreRecoveryBundle(
        { ...f.restore, secretAcknowledgements: wrong, execute: true },
        f.adapters,
      ),
      /Missing exact/,
    );
    assert.equal(f.calls(), 0);
    const trust = resolve(f.dir, 'untrusted.json');
    await writeFile(trust, '[]');
    await assert.rejects(
      restoreRecoveryBundle(
        { ...f.restore, checkpointTrustFile: trust, execute: true },
        f.adapters,
      ),
    );
    assert.equal(f.calls(), 0);
  } finally {
    await f.cleanup();
  }
});

test('failed migration replay or restored object-reference mismatch leaves no promoted directory', async () => {
  const f = await fixture();
  try {
    await createRecoveryBundle(f.capture, f.adapters);
    await writeFile(
      resolve(f.restore.migrationsDirectory, '001_synthetic.sql'),
      '-- changed after capture',
    );
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, execute: true }, f.adapters),
      /checksum/,
    );
    assert.equal(f.calls(), 1);
    await assert.rejects(lstat(f.restore.targetDirectory), { code: 'ENOENT' });
    await writeFile(
      resolve(f.restore.migrationsDirectory, '001_synthetic.sql'),
      '-- Synthetic migration used only to test checksum replay',
    );
    const originalQuery = f.client.query;
    f.client.query = async (query, values) => {
      const result = await originalQuery(query, values);
      return query.includes('SELECT object_key,')
        ? { rows: result.rows.map((r) => ({ ...r, sha256: '0'.repeat(64) })) }
        : result;
    };
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, execute: true }, f.adapters),
      /object reference inventory mismatch/,
    );
    f.client.query = originalQuery;
    assert.equal(f.calls(), 2);
    const incomplete = {
      ...f.adapters,
      restoreDrill: async () => ({ verified: true, manifestHash: hash('synthetic-db-manifest') }),
    };
    await assert.rejects(
      restoreRecoveryBundle({ ...f.restore, execute: true }, incomplete),
      /incomplete/,
    );
    assert.equal(
      (await readdir(f.dir)).some((p) => p.startsWith('.noxh-recovery-')),
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test('dedicated drill target blocks remote, production names and PostgreSQL option injection', () => {
  for (const url of [
    'postgres://user@example.com/noxh_recovery_admin',
    'postgres://user@127.0.0.1/postgres',
    'postgres://user@localhost/noxh_recovery_admin',
    'postgres://user@127.0.0.1/noxh_recovery_admin?options=unsafe',
  ])
    assert.throws(() => validateDrillTarget(url));
  assert.doesNotThrow(() =>
    validateDrillTarget('postgres://synthetic@127.0.0.1:55440/noxh_recovery_admin?sslmode=disable'),
  );
});

test('real Rust rejects valid prefix under a pinned later checkpoint during backup inspection', async () => {
  const f = await fixture();
  try {
    assert.equal(await verifySnapshotCheckpoint(f.client, f.signed), true);
    const truncated = { query: async () => ({ rows: [] }) };
    await assert.rejects(verifySnapshotCheckpoint(truncated, f.signed), /truncated/);
    const relabeled = { query: async () => ({ rows: [{ ...f.event, sequence: '6' }] }) };
    await assert.rejects(verifySnapshotCheckpoint(relabeled, f.signed));
  } finally {
    await f.cleanup();
  }
});
