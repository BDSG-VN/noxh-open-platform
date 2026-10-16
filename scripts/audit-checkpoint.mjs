#!/usr/bin/env node
/** Offline operator tool. Never reads DB credentials or calls the network. */
import { createPrivateKey } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, readFile, readdir, open, link, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
let protocol;
const fail = (code) => {
  throw new Error(code);
};
async function regular(file, max, privateFile = false) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) fail('INVALID_FILE');
  if (
    privateFile &&
    ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
  )
    fail('PRIVATE_KEY_PERMISSIONS');
  return readFile(file);
}
async function json(file, max = 2_000_000) {
  return JSON.parse((await regular(file, max)).toString('utf8'));
}
async function publish(output, value) {
  const temporary = resolve(dirname(output), '.audit-checkpoint-' + randomUUID());
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
    await file.close();
    // Hard-link publication refuses to overwrite an existing evidence file.
    await link(temporary, output);
  } finally {
    await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}
function args() {
  const [mode, ...rest] = process.argv.slice(2),
    out = {};
  if (!['sign', 'verify'].includes(mode) || rest.length % 2) fail('INVALID_ARGUMENTS');
  const allowed =
    mode === 'sign'
      ? ['proposal', 'private-key-file', 'output']
      : ['checkpoint-file', 'checkpoint-hash', 'trust-file', 'pages-directory'];
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.replace(/^--/, '');
    if (
      !rest[i]?.startsWith('--') ||
      !allowed.includes(key) ||
      Object.hasOwn(out, key) ||
      !rest[i + 1]
    )
      fail('INVALID_ARGUMENTS');
    out[key] = rest[i + 1];
  }
  if (allowed.some((k) => !out[k])) fail('INVALID_ARGUMENTS');
  return { mode, ...out };
}
function kernel(payload) {
  const binary = process.env.AUDIT_VERIFIER_BIN;
  if (!binary || !isAbsolute(binary)) fail('AUDIT_BINARY_NOT_CONFIGURED');
  const input = JSON.stringify(payload);
  if (Buffer.byteLength(input) > 2_000_000) fail('PAGE_TOO_LARGE');
  const result = spawnSync(binary, [], {
    input,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 2_000_000,
    shell: false,
    env: { LANG: 'C.UTF-8', RUST_BACKTRACE: '0' },
  });
  if (result.error || result.signal || result.status !== 0) fail('AUDIT_VERIFICATION_FAILED');
  const output = JSON.parse(result.stdout);
  if (output.valid !== true) fail('AUDIT_VERIFICATION_FAILED');
  return output;
}
try {
  protocol = require('../apps/api/dist/audit-checkpoint-protocol.js');
  const input = args();
  if (input.mode === 'sign') {
    if (!isAbsolute(input['private-key-file'])) fail('PRIVATE_KEY_ABSOLUTE_PATH_REQUIRED');
    const proposal = protocol.parseAuditProposal(await json(input.proposal));
    const privateKey = createPrivateKey(await regular(input['private-key-file'], 8192, true));
    const signed = protocol.signAuditCheckpoint(proposal, privateKey);
    await publish(resolve(input.output), signed);
    process.stdout.write(
      JSON.stringify({
        signed: true,
        checkpointHash: protocol.checkpointHash(signed),
        outputCreated: true,
        custody: 'not-attested',
      }) + '\n',
    );
  } else {
    const checkpoint = protocol.parseSignedCheckpoint(await json(input['checkpoint-file']));
    if (
      !/^[a-f0-9]{64}$/.test(input['checkpoint-hash']) ||
      protocol.checkpointHash(checkpoint) !== input['checkpoint-hash']
    )
      fail('EXPECTED_CHECKPOINT_MISMATCH');
    const trusted = protocol.parseAuditTrustedKeys(await json(input['trust-file'], 65_536));
    protocol.verifyCheckpointSignature(checkpoint, trusted, checkpoint.proposal.organizationId);
    await access(process.env.AUDIT_VERIFIER_BIN ?? '', constants.X_OK);
    const directory = resolve(input['pages-directory']),
      info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('INVALID_PAGES_DIRECTORY');
    const pages = (await readdir(directory))
      .filter((name) => /^page-[0-9]{6}\.json$/.test(name))
      .sort();
    if (pages.length > 2000) fail('TOO_MANY_PAGES');
    let cursor = protocol.genesisCursor();
    for (let i = 0; i < pages.length; i++) {
      if (pages[i] !== 'page-' + String(i + 1).padStart(6, '0') + '.json') fail('MISSING_PAGE');
      const page = protocol.exactObject(await json(resolve(directory, pages[i])), [
        'proposal',
        'events',
        'nextAfterSequence',
        'segmentOnly',
        'notice',
      ]);
      if (
        !protocol
          .checkpointBytes(page.proposal)
          .equals(protocol.checkpointBytes(checkpoint.proposal)) ||
        page.segmentOnly !== true ||
        !Array.isArray(page.events) ||
        !page.events.length ||
        page.events.length > 500
      )
        fail('INVALID_PAGE');
      if (BigInt(cursor.eventCount) + BigInt(page.events.length) > 1_000_000n)
        fail('TOO_MANY_EVENTS');
      const result = kernel({
        expectedOrganizationId: checkpoint.proposal.organizationId,
        events: page.events,
        anchor: cursor,
      });
      const next = protocol.parseAuditCursor(result.cursor);
      if (
        result.checked !== page.events.length ||
        BigInt(next.eventCount) !== BigInt(cursor.eventCount) + BigInt(page.events.length) ||
        BigInt(next.sequence) <= BigInt(cursor.sequence)
      )
        fail('INVALID_KERNEL_RESULT');
      cursor = next;
      const last = i === pages.length - 1;
      if (last ? page.nextAfterSequence !== null : page.nextAfterSequence !== cursor.sequence)
        fail('INVALID_PAGE_CURSOR');
    }
    const final = kernel({
      expectedOrganizationId: checkpoint.proposal.organizationId,
      events: [],
      anchor: cursor,
      expectedEnd: checkpoint.proposal.cursor,
    });
    if (
      final.completeToExpected !== true ||
      final.checked !== 0 ||
      JSON.stringify(protocol.parseAuditCursor(final.cursor)) !==
        JSON.stringify(checkpoint.proposal.cursor)
    )
      fail('INCOMPLETE_EVIDENCE');
    process.stdout.write(
      JSON.stringify({
        valid: true,
        signatureValid: true,
        checkpointHash: protocol.checkpointHash(checkpoint),
        completeToCheckpoint: true,
        verified: cursor,
        currentness:
          'Only as current as the independently pinned checkpoint; no off-host custody is attested.',
      }) + '\n',
    );
  }
} catch {
  // Do not reflect keys, paths, event metadata or provider/process diagnostics.
  process.stderr.write(
    'Audit checkpoint operation failed; inspect configuration and private evidence.\n',
  );
  process.exitCode = 1;
}
