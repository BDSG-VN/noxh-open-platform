/** Private, authenticated recovery staging. Never starts services or targets a live bucket/realm. */
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  backup,
  backupKey,
  databaseIdentity,
  decryptToFile,
  encryptPayload,
  restoreDrill,
} from './backup-restore.mjs';

const require = createRequire(import.meta.url);
const FORMAT = 'noxh-recovery-bundle-v1';
const MAX_MANIFEST = 16 * 1024 * 1024;
const MAX_FILES = 100_010;
const MAX_TOTAL = 100 * 1024 ** 3;
const MAX_ENCRYPTED_BYTES = MAX_TOTAL + MAX_MANIFEST + 4 + 12 + 4096 + 16;
const hash = (value) => createHash('sha256').update(value).digest('hex');
class RecoveryError extends Error {}
const fail = (message) => {
  throw new RecoveryError(message);
};
function exact(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k)) ||
    fields.some((k) => !Object.hasOwn(value, k))
  )
    fail('Invalid recovery schema');
  return value;
}
function text(value, max = 200) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > max ||
    [...value].some((char) => char.charCodeAt(0) < 32)
  )
    fail('Invalid recovery metadata');
  return value;
}
function digest(value) {
  if (!/^[a-f0-9]{64}$/.test(value)) fail('Invalid checksum');
  return value;
}
export function safeObjectKey(value) {
  text(value, 1024);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..')
  )
    fail('Unsafe object key');
  return value;
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  fail('Destination exists; refusing overwrite');
}
async function privateDirectory(path) {
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid())
  )
    fail('A private owner-only directory is required');
  return realpath(path);
}
async function safeFile(root, key) {
  safeObjectKey(key);
  let path = root;
  const parts = key.split('/');
  for (let i = 0; i < parts.length; i++) {
    path = resolve(path, parts[i]);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (i === parts.length - 1 ? !info.isFile() : !info.isDirectory()))
      fail('Symlink or non-regular recovery input');
  }
  const actual = await realpath(path);
  if (relative(root, actual).startsWith('..' + sep) || !relative(root, actual))
    fail('Recovery input escapes root');
  return actual;
}
async function fileInfo(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_TOTAL || !Number.isSafeInteger(stat.size))
      fail('Invalid recovery file');
    const h = createHash('sha256');
    for await (const part of handle.createReadStream({ autoClose: false })) h.update(part);
    return { bytes: stat.size, sha256: h.digest('hex') };
  } finally {
    await handle.close();
  }
}
async function boundedJson(path, maximum = MAX_MANIFEST) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) fail('Invalid JSON input');
  return JSON.parse(await readFile(path, 'utf8'));
}
function noEmbeddedSecrets(value, depth = 0) {
  if (depth > 30) fail('Configuration is too deep');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /password|private.?key|client.?secret|encryption.?key|hash.?key|access.?key|secret.?key|token/i.test(
        key,
      ) &&
      !/refs?$|lifespan|policy|signature|algorithm|type|claim/i.test(key) &&
      child !== null &&
      child !== '' &&
      child !== false &&
      child !== 0
    )
      fail('Configuration contains secret-bearing fields; use references');
    if (['users', 'credentials'].includes(key) && Array.isArray(child) && child.length)
      fail('Identity users/credentials are not configuration exports');
    noEmbeddedSecrets(child, depth + 1);
  }
}
export function parseReferences(value) {
  const v = exact(value, ['version', 'references']);
  if (
    v.version !== 1 ||
    !Array.isArray(v.references) ||
    !v.references.length ||
    v.references.length > 100
  )
    fail('Invalid secret references');
  const ids = new Set();
  for (const r of v.references) {
    exact(r, ['id', 'purpose', 'version']);
    if (!/^[a-z][a-z0-9._-]{2,79}$/.test(r.id) || ids.has(r.id))
      fail('Invalid or duplicate secret reference');
    ids.add(r.id);
    text(r.purpose);
    text(r.version, 80);
  }
  for (const needed of ['application-encryption', 'application-hash', 'identity-signing'])
    if (!v.references.some((r) => r.purpose === needed)) fail('Missing required secret reference');
  return v;
}
function requireReferences(required, available) {
  const have = parseReferences(available);
  for (const r of required.references)
    if (
      !have.references.some(
        (x) => x.id === r.id && x.purpose === r.purpose && x.version === r.version,
      )
    )
      fail('Missing exact secret reference acknowledgement');
}
function parseSnapshot(value) {
  exact(value, ['objects', 'migrations']);
  if (
    !Array.isArray(value.objects) ||
    value.objects.length > 100_000 ||
    !Array.isArray(value.migrations)
  )
    fail('Invalid snapshot inventory');
  const keys = new Set();
  for (const o of value.objects) {
    exact(o, ['key', 'contentHash', 'envelopeKeyHash']);
    safeObjectKey(o.key);
    digest(o.contentHash);
    digest(o.envelopeKeyHash);
    if (keys.has(o.key)) fail('Duplicate database object reference');
    keys.add(o.key);
  }
  for (const m of value.migrations) {
    exact(m, ['version', 'sha256']);
    text(m.version, 20);
    digest(m.sha256);
  }
  return value;
}
/** Run only on the connection holding pg_export_snapshot(), never a second unbound read. */
export async function inspectSnapshot(client) {
  const rows = (
    await client.query(
      'SELECT object_key,envelope_key_cipher,sha256 FROM documents UNION ALL SELECT object_key,envelope_key_cipher,sha256 FROM generated_forms UNION ALL SELECT object_key,envelope_key_cipher,sha256 FROM identity_private.investor_files ORDER BY object_key',
    )
  ).rows;
  return parseSnapshot({
    objects: rows.map((r) => ({
      key: r.object_key,
      contentHash: r.sha256,
      envelopeKeyHash: hash(r.envelope_key_cipher ?? ''),
    })),
    migrations: (
      await client.query('SELECT version,sha256 FROM schema_migrations ORDER BY version')
    ).rows,
  });
}
async function listObjects(root, prefix = '') {
  const output = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const key = prefix + item.name;
    if (item.isSymbolicLink()) fail('Object exports may not contain symlinks');
    if (item.isDirectory())
      output.push(...(await listObjects(resolve(root, item.name), key + '/')));
    else if (item.isFile()) {
      safeObjectKey(key);
      output.push(key);
    } else fail('Object export contains a special file');
    if (output.length > 100_000) fail('Object export exceeds limit');
  }
  return output.sort();
}
function attestation(v) {
  exact(v, ['writersStopped', 'identityWritersStopped', 'objectExportCompleted', 'observedAt']);
  if (
    v.writersStopped !== true ||
    v.identityWritersStopped !== true ||
    v.objectExportCompleted !== true ||
    typeof v.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(v.observedAt)) ||
    Date.now() - Date.parse(v.observedAt) > 3600_000 ||
    Date.parse(v.observedAt) > Date.now() + 5000
  )
    fail('A recent explicit capture attestation is required');
  return v;
}
export async function verifySnapshotCheckpoint(client, envelope) {
  const protocol = require('../apps/api/dist/audit-checkpoint-protocol.js');
  const proposal = protocol.parseAuditProposal(envelope.proposal);
  const binary = process.env.AUDIT_VERIFIER_BIN;
  if (!binary || !isAbsolute(binary)) fail('Absolute Rust audit verifier is required');
  if (BigInt(proposal.cursor.eventCount) > 1_000_000n) fail('Checkpoint exceeds drill event limit');
  let cursor = protocol.genesisCursor();
  const kernel = (events, expectedEnd) => {
    const input = JSON.stringify({
      expectedOrganizationId: proposal.organizationId,
      events,
      anchor: cursor,
      ...(expectedEnd ? { expectedEnd } : {}),
    });
    if (Buffer.byteLength(input) > 2_000_000) fail('Audit verification page too large');
    const result = spawnSync(binary, [], {
      input,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 2_000_000,
      env: { LANG: 'C.UTF-8', RUST_BACKTRACE: '0' },
      shell: false,
    });
    if (result.error || result.signal || result.status !== 0)
      fail('Rust audit verification failed');
    const output = JSON.parse(result.stdout);
    if (
      output.valid !== true ||
      output.checked !== events.length ||
      (expectedEnd && output.completeToExpected !== true)
    )
      fail('Audit checkpoint mismatch');
    const next = protocol.parseAuditCursor(output.cursor);
    if (BigInt(next.eventCount) !== BigInt(cursor.eventCount) + BigInt(events.length))
      fail('Invalid audit verifier cursor');
    return next;
  };
  while (BigInt(cursor.sequence) < BigInt(proposal.cursor.sequence)) {
    const events = (
      await client.query(
        'SELECT a.id,a.organization_id,a.actor_ref,a.action,a.resource_ref,a.occurred_at,a.prev_hash,a.event_hash,a.sequence::text FROM identity_private.audit_chain a WHERE a.organization_id=$1 AND a.sequence>$2::bigint AND a.sequence<=$3::bigint ORDER BY a.sequence LIMIT 500',
        [proposal.organizationId, cursor.sequence, proposal.cursor.sequence],
      )
    ).rows;
    if (!events.length) fail('Audit checkpoint is truncated');
    const next = kernel(events);
    if (BigInt(next.sequence) <= BigInt(cursor.sequence) || BigInt(next.eventCount) > 1_000_000n)
      fail('Audit cursor did not advance');
    cursor = next;
  }
  const result = kernel([], proposal.cursor);
  if (JSON.stringify(result) !== JSON.stringify(proposal.cursor))
    fail('Audit checkpoint endpoint mismatch');
  return true;
}
async function verifyPinnedCheckpoint(value, trustFile, expectedHash) {
  digest(expectedHash);
  const protocol = require('../apps/api/dist/audit-checkpoint-protocol.js');
  const trusted = protocol.parseAuditTrustedKeys(await boundedJson(trustFile, 65_536));
  const envelope = protocol.parseSignedCheckpoint(value);
  if (protocol.checkpointHash(envelope) !== expectedHash)
    fail('Independent checkpoint hash mismatch');
  protocol.verifyCheckpointSignature(envelope, trusted, envelope.proposal.organizationId);
  return envelope;
}
export async function createRecoveryBundle(
  {
    sourceUrl,
    objectDirectory,
    identityConfig,
    deploymentConfig,
    secretReferences,
    checkpoint,
    checkpointTrustFile,
    expectedCheckpointHash,
    captureAttestation,
    out,
    key,
  },
  adapters = {},
) {
  const capture = attestation(captureAttestation);
  const objectsRoot = await privateDirectory(objectDirectory);
  const refs = parseReferences(await boundedJson(secretReferences, 65_536));
  const identity = await boundedJson(identityConfig, 2_000_000),
    config = await boundedJson(deploymentConfig, 2_000_000);
  noEmbeddedSecrets(identity);
  noEmbeddedSecrets(config);
  if (typeof identity.realm !== 'string' || !identity.realm)
    fail('Identity realm configuration is required');
  const checkpointValue = await boundedJson(checkpoint, 65_536);
  const signedCheckpoint = await verifyPinnedCheckpoint(
    checkpointValue,
    checkpointTrustFile,
    expectedCheckpointHash,
  );
  if (!checkpointValue.proposal || typeof checkpointValue.signature !== 'string')
    fail('A signed checkpoint artifact is required');
  const stage = await mkdtemp(resolve(tmpdir(), 'noxh-bundle-'));
  await chmod(stage, 0o700);
  try {
    const archive = resolve(stage, 'database.noxh');
    const captured = await (adapters.backup ?? backup)({
      url: sourceUrl,
      out: archive,
      key,
      snapshotInspect: async (client) => {
        await verifySnapshotCheckpoint(client, signedCheckpoint);
        return inspectSnapshot(client);
      },
    });
    const snapshot = parseSnapshot(captured.snapshotData);
    const actualObjects = await listObjects(objectsRoot);
    const expectedKeys = snapshot.objects.map((o) => o.key).sort();
    if (JSON.stringify(actualObjects) !== JSON.stringify(expectedKeys))
      fail('Object export differs from snapshot references (missing or extra objects)');
    const files = [];
    const add = async (path, source, kind, objectKey = null) =>
      files.push({ path, kind, objectKey, ...(await fileInfo(source)), source });
    await add('database.noxh', archive, 'database');
    for (const [path, value] of [
      ['identity.json', identity],
      ['deployment.json', config],
      ['secret-references.json', refs],
      ['checkpoint.json', checkpointValue],
    ]) {
      const source = resolve(stage, path);
      await writeFile(source, JSON.stringify(value), { mode: 0o600 });
      await add(path, source, 'configuration');
    }
    for (let i = 0; i < snapshot.objects.length; i++) {
      const o = snapshot.objects[i];
      await add(
        'objects/' + String(i).padStart(8, '0') + '.bin',
        await safeFile(objectsRoot, o.key),
        'object',
        o.key,
      );
    }
    const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
    if (totalBytes > MAX_TOTAL) fail('Bundle exceeds size limit');
    const manifest = {
      format: FORMAT,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      sourceFingerprint: hash(databaseIdentity(sourceUrl)),
      capture,
      databaseManifestHash: digest(captured.manifestHash),
      snapshot,
      checkpointArtifactHash: hash(JSON.stringify(checkpointValue)),
      checkpointTrust: 'signature-pinned-latest-not-attested',
      checkpointHash: expectedCheckpointHash,
      activationAllowed: false,
      files: files.map(({ source: _source, ...f }) => f),
      totalBytes,
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    if (bytes.length > MAX_MANIFEST) fail('Manifest exceeds size limit');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    const input = Readable.from(
      (async function* () {
        yield length;
        yield bytes;
        for (const f of files) {
          const h = createHash('sha256');
          let size = 0;
          const handle = await open(f.source, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            for await (const part of handle.createReadStream({ autoClose: false })) {
              size += part.length;
              h.update(part);
              yield part;
            }
          } finally {
            await handle.close();
          }
          if (size !== f.bytes || h.digest('hex') !== f.sha256)
            fail('Capture input changed while packaging');
        }
      })(),
    );
    const result = await encryptPayload(input, out, key, { bundleFormat: FORMAT });
    return {
      bundleId: manifest.id,
      bytes: result.bytes,
      files: files.length,
      objects: snapshot.objects.length,
      manifestHash: hash(bytes),
      encrypted: true,
      offHostCustody: 'not-attested',
      captureConsistency: 'operator-attested',
    };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
function parseManifest(v) {
  exact(v, [
    'format',
    'id',
    'createdAt',
    'sourceFingerprint',
    'capture',
    'databaseManifestHash',
    'snapshot',
    'checkpointArtifactHash',
    'checkpointTrust',
    'checkpointHash',
    'activationAllowed',
    'files',
    'totalBytes',
  ]);
  if (
    v.format !== FORMAT ||
    !/^[a-f0-9-]{36}$/.test(v.id) ||
    v.activationAllowed !== false ||
    v.checkpointTrust !== 'signature-pinned-latest-not-attested'
  )
    fail('Unsupported recovery bundle');
  exact(v.capture, [
    'writersStopped',
    'identityWritersStopped',
    'objectExportCompleted',
    'observedAt',
  ]);
  if (
    v.capture.writersStopped !== true ||
    v.capture.identityWritersStopped !== true ||
    v.capture.objectExportCompleted !== true ||
    !Number.isFinite(Date.parse(v.capture.observedAt)) ||
    !Number.isFinite(Date.parse(v.createdAt))
  )
    fail('Invalid capture metadata');
  digest(v.sourceFingerprint);
  digest(v.databaseManifestHash);
  digest(v.checkpointArtifactHash);
  digest(v.checkpointHash);
  parseSnapshot(v.snapshot);
  if (!Array.isArray(v.files) || v.files.length < 5 || v.files.length > MAX_FILES)
    fail('Invalid file inventory');
  const paths = new Set(),
    objectKeys = new Set();
  let total = 0;
  for (const f of v.files) {
    exact(f, ['path', 'kind', 'objectKey', 'bytes', 'sha256']);
    if (
      ![
        'database.noxh',
        'identity.json',
        'deployment.json',
        'secret-references.json',
        'checkpoint.json',
      ].includes(f.path) &&
      !/^objects\/[0-9]{8}\.bin$/.test(f.path)
    )
      fail('Unsafe archive path');
    if (paths.has(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > MAX_TOTAL)
      fail('Invalid file descriptor');
    paths.add(f.path);
    digest(f.sha256);
    total += f.bytes;
    if (f.kind === 'object') {
      safeObjectKey(f.objectKey);
      if (!f.path.startsWith('objects/') || objectKeys.has(f.objectKey))
        fail('Duplicate or mismatched object inventory');
      objectKeys.add(f.objectKey);
    } else if (
      f.objectKey !== null ||
      f.kind !== (f.path === 'database.noxh' ? 'database' : 'configuration') ||
      f.path.startsWith('objects/')
    )
      fail('Invalid file kind');
  }
  if (
    ![
      'database.noxh',
      'identity.json',
      'deployment.json',
      'secret-references.json',
      'checkpoint.json',
    ].every((n) => paths.has(n)) ||
    JSON.stringify([...objectKeys].sort()) !==
      JSON.stringify(v.snapshot.objects.map((o) => o.key).sort()) ||
    total !== v.totalBytes ||
    total > MAX_TOTAL
  )
    fail('Incomplete recovery inventory');
  return v;
}
async function readExact(handle, size, position) {
  const b = Buffer.alloc(size);
  let n = 0;
  while (n < size) {
    const r = await handle.read(b, n, size - n, position + n);
    if (!r.bytesRead) fail('Truncated recovery package');
    n += r.bytesRead;
  }
  return b;
}
async function unpack(input, key, stage) {
  const plain = resolve(stage, 'authenticated.bundle');
  const metadata = await decryptToFile(input, plain, key, {
    maxEncryptedBytes: MAX_ENCRYPTED_BYTES,
  });
  if (metadata.bundleFormat !== FORMAT) fail('Not a recovery bundle');
  const handle = await open(plain, 'r');
  try {
    const prefix = await readExact(handle, 4, 0),
      n = prefix.readUInt32BE();
    if (!n || n > MAX_MANIFEST) fail('Invalid recovery manifest length');
    const bytes = await readExact(handle, n, 4),
      manifest = parseManifest(JSON.parse(bytes.toString()));
    if ((await handle.stat()).size !== 4 + n + manifest.totalBytes)
      fail('Truncated or trailing recovery bytes');
    const extracted = resolve(stage, 'extracted');
    await mkdir(extracted, { mode: 0o700 });
    await mkdir(resolve(extracted, 'objects'), { mode: 0o700 });
    let offset = 4 + n;
    for (const f of manifest.files) {
      const out = await open(resolve(extracted, f.path), 'wx', 0o600);
      const h = createHash('sha256');
      try {
        let remaining = f.bytes;
        while (remaining) {
          const part = await readExact(handle, Math.min(1024 * 1024, remaining), offset);
          await out.writeFile(part);
          h.update(part);
          remaining -= part.length;
          offset += part.length;
        }
        await out.sync();
      } finally {
        await out.close();
      }
      if (h.digest('hex') !== f.sha256) fail('Recovery checksum mismatch');
    }
    if (
      hash(JSON.stringify(await boundedJson(resolve(extracted, 'checkpoint.json'), 65_536))) !==
      manifest.checkpointArtifactHash
    )
      fail('Checkpoint artifact mismatch');
    return { manifest, manifestHash: hash(bytes), extracted };
  } finally {
    await handle.close();
    await rm(plain, { force: true });
  }
}
function destination(path) {
  if (!isAbsolute(path) || !/^noxh_recovery_[a-f0-9]{24}$/.test(path.split(sep).at(-1)))
    fail('Explicit isolated noxh_recovery_<24 hex> directory required');
  return resolve(path);
}
export function validateDrillTarget(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('Explicit isolated drill database is required');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/noxh_recovery_admin' ||
    url.hash ||
    [...url.searchParams.keys()].some((k) => k !== 'sslmode')
  )
    fail('Only a loopback dedicated noxh_recovery_admin database is allowed');
}
async function verifyMigrations(client, directory, snapshot) {
  const expected = snapshot.migrations;
  const files = (await readdir(directory))
    .filter((n) => /^\d+_[A-Za-z0-9_-]+\.sql$/.test(n))
    .sort();
  if (files.length !== expected.length)
    fail('Recovery source version differs from migration inventory');
  const applied = (
    await client.query('SELECT version,sha256 FROM schema_migrations ORDER BY version')
  ).rows;
  for (const name of files) {
    const version = name.split('_')[0],
      checksum = hash(await readFile(await safeFile(await realpath(directory), name)));
    if (
      !expected.some((m) => m.version === version && m.sha256 === checksum) ||
      !applied.some((m) => m.version === version && m.sha256 === checksum)
    )
      fail('Migration replay checksum mismatch');
  }
  // Idempotent migration runner path: every bundled version is already applied;
  // mismatches/missing versions stop rather than silently upgrade during a drill.
  return true;
}
export async function restoreRecoveryBundle(
  {
    input,
    key,
    targetDirectory,
    secretAcknowledgements,
    checkpointTrustFile,
    expectedCheckpointHash,
    adminUrl,
    migrationsDirectory,
    execute = false,
  },
  adapters = {},
) {
  const target = destination(targetDirectory);
  const parent = await privateDirectory(dirname(target));
  if (parent !== dirname(target)) fail('Destination parent must be canonical and not symlinked');
  await absent(target);
  const stage = await mkdtemp(resolve(parent, '.noxh-recovery-'));
  await chmod(stage, 0o700);
  let created = false;
  try {
    const { manifest, manifestHash, extracted } = await unpack(input, key, stage);
    if (manifest.checkpointHash !== expectedCheckpointHash)
      fail('Independent checkpoint hash mismatch');
    const signedCheckpoint = await verifyPinnedCheckpoint(
      await boundedJson(resolve(extracted, 'checkpoint.json'), 65_536),
      checkpointTrustFile,
      expectedCheckpointHash,
    );
    if (adminUrl && manifest.sourceFingerprint === hash(databaseIdentity(adminUrl)))
      fail('Source database cannot be a drill target');
    const refs = parseReferences(
      await boundedJson(resolve(extracted, 'secret-references.json'), 65_536),
    );
    requireReferences(refs, await boundedJson(secretAcknowledgements, 65_536));
    if (!execute)
      return {
        plan: true,
        authenticated: true,
        bundleId: manifest.id,
        manifestHash,
        objects: manifest.snapshot.objects.length,
        destinationNew: true,
        database: 'temporary-isolated-drill-only',
        activationAllowed: false,
        checkpointTrust: manifest.checkpointTrust,
        keyAvailability: 'reference-acknowledgements-only',
      };
    if (!adminUrl || !migrationsDirectory)
      fail('Explicit drill database URL and migration directory are required');
    validateDrillTarget(adminUrl);
    // The database adapter creates and deletes only its own randomly named empty DB.
    const database = await (adapters.restoreDrill ?? restoreDrill)({
      input: resolve(extracted, 'database.noxh'),
      adminUrl,
      key,
      drill: true,
      verifyRestored: async (client) => {
        await verifyMigrations(client, migrationsDirectory, manifest.snapshot);
        await verifySnapshotCheckpoint(client, signedCheckpoint);
        const restored = await inspectSnapshot(client);
        if (JSON.stringify(restored) !== JSON.stringify(manifest.snapshot))
          fail('Restored DB/object reference inventory mismatch');
        return { migrationsRechecked: true, objectReferencesMatch: true };
      },
    });
    if (
      database.verified !== true ||
      database.manifestHash !== manifest.databaseManifestHash ||
      database.additionalVerification?.objectReferencesMatch !== true ||
      database.additionalVerification?.migrationsRechecked !== true
    )
      fail('Database restore verification incomplete');
    await mkdir(target, { mode: 0o700 });
    created = true;
    await mkdir(resolve(target, 'objects'), { mode: 0o700 });
    for (const f of manifest.files.filter((f) => f.kind !== 'database')) {
      await copyFile(resolve(extracted, f.path), resolve(target, f.path), constants.COPYFILE_EXCL);
      await chmod(resolve(target, f.path), 0o600);
    }
    const report = {
      format: 'noxh-dr-report-v1',
      bundleId: manifest.id,
      manifestHash,
      completedAt: new Date().toISOString(),
      encryptedBundleAuthenticated: true,
      fileChecksumsVerified: true,
      objects: manifest.snapshot.objects.length,
      databaseVerifiedAndRemoved: true,
      migrationsRechecked: true,
      objectReferencesMatch: true,
      checkpointArtifactIncluded: true,
      checkpointTrust: 'signature-pinned-latest-not-attested',
      keyAvailability: 'reference-acknowledgements-only',
      offHostCustody: 'not-attested',
      activationAllowed: false,
      noServicesStarted: true,
      notice:
        'Quarantined staging only. Apply independently current retention/tombstone/legal-hold state and verify pinned checkpoint before any service restoration; no activation is provided.',
    };
    await writeFile(
      resolve(target, 'object-inventory.json'),
      JSON.stringify(manifest.snapshot.objects),
      { flag: 'wx', mode: 0o600 },
    );
    await writeFile(resolve(target, 'DR-REPORT.json'), JSON.stringify(report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    return report;
  } catch (e) {
    if (created) await rm(target, { recursive: true, force: true });
    throw e;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
async function main() {
  const [mode, ...args] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1] || Object.hasOwn(options, args[i].slice(2)))
      fail('Invalid command arguments');
    options[args[i].slice(2)] = args[i + 1];
  }
  const key = backupKey();
  if (mode === 'capture') {
    exact(options, [
      'objects',
      'identity-config',
      'deployment-config',
      'secret-references',
      'checkpoint',
      'checkpoint-trust',
      'checkpoint-hash',
      'attestation',
      'out',
    ]);
    if (!process.env.SOURCE_DATABASE_URL) fail('SOURCE_DATABASE_URL is required');
    console.log(
      JSON.stringify(
        await createRecoveryBundle({
          sourceUrl: process.env.SOURCE_DATABASE_URL,
          objectDirectory: options.objects,
          identityConfig: options['identity-config'],
          deploymentConfig: options['deployment-config'],
          secretReferences: options['secret-references'],
          checkpoint: options.checkpoint,
          checkpointTrustFile: options['checkpoint-trust'],
          expectedCheckpointHash: options['checkpoint-hash'],
          captureAttestation: await boundedJson(options.attestation),
          out: options.out,
          key,
        }),
      ),
    );
  } else if (['plan', 'restore-drill'].includes(mode)) {
    exact(options, [
      'input',
      'destination',
      'secret-acknowledgements',
      'checkpoint-trust',
      'checkpoint-hash',
      ...(mode === 'restore-drill' ? ['migrations'] : []),
    ]);
    console.log(
      JSON.stringify(
        await restoreRecoveryBundle({
          input: options.input,
          key,
          targetDirectory: options.destination,
          secretAcknowledgements: options['secret-acknowledgements'],
          checkpointTrustFile: options['checkpoint-trust'],
          expectedCheckpointHash: options['checkpoint-hash'],
          adminUrl: mode === 'restore-drill' ? process.env.DRILL_ADMIN_DATABASE_URL : undefined,
          migrationsDirectory: options.migrations,
          execute: mode === 'restore-drill',
        }),
      ),
    );
  } else fail('Choose capture, plan or restore-drill');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(
      e instanceof RecoveryError
        ? e.message
        : 'Recovery operation failed; no secret, path or document details are printed',
    );
    process.exitCode = 1;
  });
