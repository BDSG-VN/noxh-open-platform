import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import {
  encryptPayload,
  decryptToFile,
  backupKey,
  assertDifferentDatabase,
  assertDrillName,
  drillName,
  restoreDrill,
} from '../scripts/backup-restore.mjs';
import { validateLoadTarget, loadBounds } from '../scripts/load-synthetic.mjs';
test('authenticated encrypted backup roundtrip, private permissions, wrong key/tamper rejection and cleanup', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'noxh-backup-test-')),
    key = randomBytes(32),
    source = Buffer.from('SYNTHETIC ARCHIVE ONLY — NO PERSONAL DATA');
  try {
    const archive = resolve(dir, 'backup.noxh'),
      plain = resolve(dir, 'plain.dump');
    await encryptPayload(Readable.from([source]), archive, key, {
      sourceFingerprint: 'a'.repeat(64),
    });
    assert.equal((await stat(archive)).mode & 0o777, 0o600);
    assert.equal((await readFile(archive)).includes(source), false);
    const meta = await decryptToFile(archive, plain, key);
    assert.equal(meta.sourceFingerprint, 'a'.repeat(64));
    assert.deepEqual(await readFile(plain), source);
    await assert.rejects(decryptToFile(archive, plain, key), /refusing to overwrite/);
    assert.deepEqual(await readFile(plain), source);
    const wrong = resolve(dir, 'wrong.dump');
    await assert.rejects(decryptToFile(archive, wrong, randomBytes(32)), /authentication failed/);
    await assert.rejects(stat(wrong), { code: 'ENOENT' });
    const tampered = Buffer.from(await readFile(archive));
    tampered[tampered.length - 1] ^= 1;
    const corrupt = resolve(dir, 'corrupt.noxh');
    await writeFile(corrupt, tampered);
    await assert.rejects(decryptToFile(corrupt, wrong, key), /authentication failed/);
    await assert.rejects(stat(wrong), { code: 'ENOENT' });
    const changedHeader = Buffer.from(await readFile(archive)),
      fingerprintAt = changedHeader.indexOf(Buffer.from('a'.repeat(64)));
    assert.ok(fingerprintAt > 12);
    changedHeader[fingerprintAt] = 98;
    await writeFile(corrupt, changedHeader);
    await assert.rejects(decryptToFile(corrupt, wrong, key), /authentication failed/);
    await assert.rejects(stat(wrong), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('concurrent backup writers never overwrite an existing artifact or leave unfinished encrypted files', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'noxh-backup-race-')),
    key = randomBytes(32),
    out = resolve(dir, 'one.noxh');
  try {
    const results = await Promise.allSettled([
      encryptPayload(Readable.from(['FIRST']), out, key),
      encryptPayload(Readable.from(['SECOND']), out, key),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
    assert.deepEqual(await readdir(dir), ['one.noxh']);
    const plain = resolve(dir, 'result');
    await decryptToFile(out, plain, key);
    assert.ok(['FIRST', 'SECOND'].includes(await readFile(plain, 'utf8')));
    await assert.rejects(
      encryptPayload(Readable.from(['THIRD']), out, key),
      /refusing to overwrite/,
    );
    const broken = resolve(dir, 'unfinished.noxh');
    await assert.rejects(
      encryptPayload(
        Readable.from(
          (async function* () {
            yield Buffer.from('PARTIAL SYNTHETIC DUMP');
            throw new Error('SOURCE STREAM FAILED');
          })(),
        ),
        broken,
        key,
      ),
      /SOURCE STREAM FAILED/,
    );
    await assert.rejects(stat(broken), { code: 'ENOENT' });
    assert.ok(!(await readdir(dir)).some((name) => name.startsWith('.noxh-encrypted-')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('restore requires explicit drill authorization, independent key and an isolated database identity', async () => {
  assert.throws(() => backupKey({}), /required|must contain/);
  assert.throws(
    () => backupKey({ BACKUP_ENCRYPTION_KEY: 'a'.repeat(64), AUTH_ENCRYPTION_KEY: 'a'.repeat(64) }),
    /separate/,
  );
  assert.equal(
    backupKey({ BACKUP_ENCRYPTION_KEY: 'a'.repeat(64), AUTH_ENCRYPTION_KEY: 'b'.repeat(64) })
      .byteLength,
    32,
  );
  assert.throws(
    () =>
      assertDifferentDatabase(
        'postgres://owner:secret@localhost:55432/noxh_demo',
        'postgresql://other:other@127.0.0.1:55432/noxh_demo',
      ),
    /source database/,
  );
  assert.throws(
    () =>
      assertDifferentDatabase(
        'postgres://owner@localhost/demo',
        'postgres://other@[::1]:5432/demo',
      ),
    /source database/,
  );
  assert.doesNotThrow(() =>
    assertDifferentDatabase(
      'postgres://owner@localhost/demo',
      'postgres://owner@localhost/isolated',
    ),
  );
  assert.throws(() => assertDrillName('noxh_demo'), /isolated/);
  assert.throws(() => assertDrillName('noxh_restore_drill_;DROP DATABASE noxh_demo'), /isolated/);
  assert.doesNotThrow(() => assertDrillName(drillName()));
  await assert.rejects(
    restoreDrill({
      input: '/nonexistent',
      adminUrl: 'postgres://owner@localhost/demo',
      key: randomBytes(32),
    }),
    /--drill/,
  );
});
test('synthetic load boundaries reject non-local targets, real-data flags and unbounded concurrency', () => {
  for (const value of [
    'https://example.com:4000',
    'http://localhost.example.com:4000',
    'http://localhost:3000',
    'http://localhost:4000/private',
    'http://user:secret@localhost:4000',
    'http://localhost:4000?redirect=1',
  ])
    assert.throws(() => validateLoadTarget(value, { ALLOW_SYNTHETIC_FIXTURES: 'true' }));
  assert.throws(() => validateLoadTarget('http://localhost:4000', {}), /ALLOW_SYNTHETIC_FIXTURES/);
  assert.equal(
    validateLoadTarget('http://127.0.0.1:4000', { ALLOW_SYNTHETIC_FIXTURES: 'true' }),
    'http://127.0.0.1:4000',
  );
  assert.deepEqual(loadBounds(120, 4), { requests: 120, concurrency: 4 });
  for (const args of [
    [501, 4],
    [10, 9],
    [0, 1],
    [5, 0],
    [3.5, 1],
  ])
    assert.throws(() => loadBounds(...args), /Bounded/);
});
