import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { appendFile, chmod, link, mkdtemp, open, stat, unlink, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
const MAGIC = Buffer.from('NOXHBK01'),
  MAX_MANIFEST = 4 * 1024 * 1024;
class SafeError extends Error {}
const sha = (v) =>
  createHash('sha256')
    .update(typeof v === 'string' ? v : JSON.stringify(v))
    .digest('hex');
export function backupKey(env = process.env) {
  const k = env.BACKUP_ENCRYPTION_KEY;
  if (!/^[a-f0-9]{64}$/i.test(k ?? ''))
    throw new SafeError(
      'BACKUP_ENCRYPTION_KEY must contain 32 independent random bytes as 64 hex characters',
    );
  if (k.toLowerCase() === env.AUTH_ENCRYPTION_KEY?.toLowerCase())
    throw new SafeError('Backup key must be separate from the application encryption key');
  return Buffer.from(k, 'hex');
}
function database(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new SafeError('A valid PostgreSQL URL is required through the environment');
  }
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.hostname || !u.pathname.slice(1))
    throw new SafeError('A PostgreSQL database URL is required');
  return u;
}
export function databaseIdentity(url) {
  const u = database(url),
    host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return JSON.stringify([
    ['localhost', '127.0.0.1', '::1'].includes(host) ? 'loopback' : host,
    u.port || '5432',
    decodeURIComponent(u.pathname.slice(1)),
  ]);
}
export function assertDifferentDatabase(source, target) {
  if (databaseIdentity(source) === databaseIdentity(target))
    throw new SafeError('Refusing to restore into the source database');
}
function childEnvironment(url) {
  const u = database(url),
    ssl =
      u.searchParams.get('sslmode') ??
      (['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ? 'disable' : 'verify-full');
  if (!['disable', 'require', 'verify-ca', 'verify-full'].includes(ssl))
    throw new SafeError('Unsupported PostgreSQL TLS mode');
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    PGHOST: u.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: u.port || '5432',
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGSSLMODE: ssl,
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'noxh-backup-restore',
  };
}
function processTool(binary, args, url) {
  const child = spawn(binary, args, {
    env: childEnvironment(url),
    stdio: ['pipe', 'pipe', 'ignore'],
    timeout: 900000,
  });
  const done = new Promise((yes, no) => {
    child.once('error', () =>
      no(new SafeError('PostgreSQL utility could not start; check the configured binary')),
    );
    child.once('close', (code) =>
      code === 0
        ? yes()
        : no(
            new SafeError(
              'PostgreSQL utility failed; source credentials and stderr are not printed',
            ),
          ),
    );
  });
  done.catch(() => {});
  return { child, done };
}
export async function encryptPayload(input, out, key, metadata = {}) {
  const destination = resolve(out),
    temporary = resolve(dirname(destination), '.noxh-encrypted-' + randomUUID()),
    iv = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({ format: 'noxh-pg-aesgcm-v1', ...metadata, iv: iv.toString('hex') }),
  );
  if (header.length > 4096) throw new SafeError('Backup metadata is too large');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const aad = Buffer.concat([MAGIC, length, header]),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  try {
    try {
      await stat(destination);
      throw new SafeError('Backup destination exists; refusing to overwrite');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const output = createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    output.write(aad);
    await pipeline(input, cipher, output);
    await appendFile(temporary, cipher.getAuthTag());
    const h = await open(temporary, 'r+');
    try {
      await h.sync();
    } finally {
      await h.close();
    }
    await link(temporary, destination);
    await chmod(destination, 0o600);
    return { path: destination, bytes: (await stat(destination)).size };
  } catch (e) {
    if (e.code === 'EEXIST')
      throw new SafeError('Backup destination exists; refusing to overwrite');
    throw e;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export async function decryptToFile(
  input,
  out,
  key,
  { maxEncryptedBytes = Number.MAX_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(maxEncryptedBytes) || maxEncryptedBytes < 38)
    throw new SafeError('Invalid encrypted input size limit');
  // Keep this exact descriptor open for both metadata and ciphertext. NOFOLLOW
  // prevents symlink substitution; NONBLOCK also makes a raced FIFO harmless.
  const h = await open(input, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let made = false;
  try {
    const info = await h.stat(),
      size = info.size;
    if (!info.isFile() || !Number.isSafeInteger(size))
      throw new SafeError('Encrypted input must be a regular file');
    if (size > maxEncryptedBytes)
      throw new SafeError('Encrypted input exceeds size limit; no plaintext was created');
    const prefix = Buffer.alloc(12);
    await h.read(prefix, 0, 12, 0);
    if (!prefix.subarray(0, 8).equals(MAGIC)) throw new SafeError('Unsupported backup format');
    const n = prefix.readUInt32BE(8);
    if (n < 10 || n > 4096 || size < 12 + n + 16) throw new SafeError('Invalid backup length');
    const body = Buffer.alloc(n);
    await h.read(body, 0, n, 12);
    let metadata;
    try {
      metadata = JSON.parse(body.toString('utf8'));
    } catch {
      throw new SafeError('Invalid backup metadata');
    }
    if (metadata.format !== 'noxh-pg-aesgcm-v1' || !/^[a-f0-9]{24}$/.test(metadata.iv))
      throw new SafeError('Invalid backup metadata');
    const aad = Buffer.concat([prefix, body]),
      tag = Buffer.alloc(16);
    await h.read(tag, 0, 16, size - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'hex'));
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const handle = await open(out, 'wx', 0o600);
    made = true;
    const output = createWriteStream(out, { fd: handle.fd, autoClose: false });
    try {
      await pipeline(
        h.createReadStream({ start: aad.length, end: size - 17, autoClose: false }),
        decipher,
        output,
      );
    } finally {
      await handle.close();
    }
    return metadata;
  } catch (e) {
    if (made) await unlink(out).catch(() => {});
    if (e instanceof SafeError) throw e;
    if (e.code === 'EEXIST')
      throw new SafeError('Plaintext destination exists; refusing to overwrite');
    throw new SafeError('Backup authentication failed; no restore was executed');
  } finally {
    await h.close();
  }
}

function identifier(v) {
  return '"' + v.replaceAll('"', '""') + '"';
}
async function manifest(client) {
  const tables = (
    await client.query(
      "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN('public','identity_private') ORDER BY schemaname,tablename",
    )
  ).rows;
  const counts = [];
  for (const t of tables)
    counts.push([
      t.schemaname,
      t.tablename,
      (
        await client.query(
          'SELECT count(*)::text AS n FROM ' +
            identifier(t.schemaname) +
            '.' +
            identifier(t.tablename),
        )
      ).rows[0].n,
    ]);
  const columns = (
    await client.query(
      "SELECT table_schema,table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema IN('public','identity_private') ORDER BY table_schema,table_name,ordinal_position",
    )
  ).rows;
  const constraints = (
    await client.query(
      "SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN('public','identity_private') ORDER BY n.nspname,c.relname,k.conname",
    )
  ).rows;
  const indexes = (
    await client.query(
      "SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN('public','identity_private') ORDER BY schemaname,tablename,indexname",
    )
  ).rows;
  const policies = (
    await client.query(
      "SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname IN('public','identity_private') ORDER BY schemaname,tablename,policyname",
    )
  ).rows;
  const functions = (
    await client.query(
      "SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','identity_private') ORDER BY n.nspname,p.proname,arguments",
    )
  ).rows;
  const migrations = (
    await client.query('SELECT version,sha256 FROM schema_migrations ORDER BY version')
  ).rows;
  const heads = new Map();
  let cursor = '0',
    total = 0;
  while (true) {
    const rows = (
      await client.query(
        'SELECT * FROM identity_private.audit_chain WHERE sequence>$1 ORDER BY sequence LIMIT 1000',
        [cursor],
      )
    ).rows;
    if (!rows.length) break;
    for (const r of rows) {
      const previous = heads.get(r.organization_id) ?? '0'.repeat(64),
        expected = sha([
          'audit-v1',
          r.id,
          r.organization_id,
          r.actor_ref,
          r.action,
          r.resource_ref,
          r.occurred_at,
          r.prev_hash,
        ]);
      if (r.prev_hash !== previous || r.event_hash !== expected)
        throw new SafeError('Audit chain verification failed; backup/drill is not certified');
      heads.set(r.organization_id, r.event_hash);
      cursor = String(r.sequence);
      total++;
    }
  }
  return {
    format: 'noxh-db-manifest-v1',
    counts,
    migrations,
    schemaHash: sha([columns, constraints, indexes, policies, functions]),
    audit: { total, heads: [...heads].sort((a, b) => a[0].localeCompare(b[0])) },
  };
}
export async function backup({
  url,
  out,
  key,
  pgDump = process.env.PG_DUMP_BIN ?? 'pg_dump',
  snapshotInspect,
}) {
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  let proc;
  try {
    await c.connect();
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await c.query('SELECT pg_export_snapshot() AS id')).rows[0].id,
      data = await manifest(c),
      snapshotData = snapshotInspect ? await snapshotInspect(c) : undefined,
      json = Buffer.from(JSON.stringify(data));
    if (json.length > MAX_MANIFEST)
      throw new SafeError('Backup manifest exceeds the configured bound');
    const n = Buffer.alloc(4);
    n.writeUInt32BE(json.length);
    proc = processTool(pgDump, ['--format=custom', '--no-owner', '--snapshot=' + snapshot], url);
    proc.child.stdin.end();
    const input = Readable.from(
      (async function* () {
        yield n;
        yield json;
        for await (const chunk of proc.child.stdout) yield chunk;
        await proc.done;
      })(),
    );
    const result = await encryptPayload(input, out, key, {
      createdAt: new Date().toISOString(),
      sourceFingerprint: sha(databaseIdentity(url)),
    });
    await proc.done;
    await c.query('COMMIT');
    return {
      ...result,
      tables: data.counts.length,
      migrations: data.migrations.length,
      auditEvents: data.audit.total,
      manifestHash: sha(data),
      ...(snapshotInspect ? { snapshotData } : {}),
    };
  } catch (e) {
    proc?.child.kill();
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end().catch(() => {});
  }
}
async function container(file) {
  const h = await open(file, 'r');
  try {
    const n = Buffer.alloc(4);
    await h.read(n, 0, 4, 0);
    const length = n.readUInt32BE(0);
    if (length < 10 || length > MAX_MANIFEST)
      throw new SafeError('Invalid authenticated manifest length');
    const bytes = Buffer.alloc(length);
    await h.read(bytes, 0, length, 4);
    let data;
    try {
      data = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new SafeError('Invalid authenticated manifest');
    }
    if (
      data.format !== 'noxh-db-manifest-v1' ||
      !Array.isArray(data.counts) ||
      !Array.isArray(data.migrations)
    )
      throw new SafeError('Unsupported authenticated manifest');
    return { data, offset: 4 + length };
  } finally {
    await h.close();
  }
}
export function drillName() {
  return 'noxh_restore_drill_' + randomUUID().replaceAll('-', '').slice(0, 24);
}
export function assertDrillName(name) {
  if (!/^noxh_restore_drill_[a-f0-9]{24}$/.test(name))
    throw new SafeError(
      'Only a uniquely generated isolated drill database may be created or removed',
    );
}
export async function restoreDrill({
  input,
  adminUrl,
  key,
  drill = false,
  pgRestore = process.env.PG_RESTORE_BIN ?? 'pg_restore',
  verifyRestored,
}) {
  if (drill !== true)
    throw new SafeError(
      'Pass --drill to authorize creating and removing one isolated temporary database',
    );
  const target = database(adminUrl);
  const dir = await mkdtemp(resolve(tmpdir(), 'noxh-restore-')),
    plain = resolve(dir, 'authenticated.dump'),
    name = drillName();
  await chmod(dir, 0o700);
  assertDrillName(name);
  target.pathname = '/' + name;
  let created = false,
    c,
    verify,
    proc,
    result,
    failure;
  try {
    const metadata = await decryptToFile(input, plain, key);
    if (metadata.sourceFingerprint === sha(databaseIdentity(target.href)))
      throw new SafeError('Refusing to restore into the source database');
    assertDifferentDatabase(adminUrl, target.href);
    const { data, offset } = await container(plain);
    c = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5000 });
    await c.connect();
    await c.query('CREATE DATABASE ' + identifier(name) + " TEMPLATE template0 ENCODING 'UTF8'");
    created = true;
    proc = processTool(
      pgRestore,
      ['--dbname=' + name, '--no-owner', '--exit-on-error', '--single-transaction'],
      target.href,
    );
    const piping = pipeline(createReadStream(plain, { start: offset }), proc.child.stdin);
    await Promise.all([piping, proc.done]);
    verify = new Client({ connectionString: target.href, connectionTimeoutMillis: 5000 });
    await verify.connect();
    const restored = await manifest(verify);
    if (sha(restored) !== sha(data))
      throw new SafeError(
        'Restored schema, migration checksums, counts or audit chain do not match the authenticated backup',
      );
    const additionalVerification = verifyRestored ? await verifyRestored(verify) : undefined;
    result = {
      ...(verifyRestored ? { additionalVerification } : {}),
      verified: true,
      isolated: true,
      tables: restored.counts.length,
      migrations: restored.migrations.length,
      auditEvents: restored.audit.total,
      manifestHash: sha(restored),
    };
  } catch (error) {
    failure = error;
  } finally {
    proc?.child.kill();
    await verify?.end().catch(() => {});
    try {
      if (created) {
        assertDrillName(name);
        assertDifferentDatabase(adminUrl, target.href);
        await c.query('DROP DATABASE ' + identifier(name));
      }
    } catch {
      failure = new SafeError(
        'Cleanup failed for isolated drill database ' + name + '; source database was not modified',
      );
    } finally {
      await c?.end().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (failure) throw failure;
  return result;
}
async function main() {
  const [command, ...args] = process.argv.slice(2),
    get = (flag) => args[args.indexOf(flag) + 1];
  const key = backupKey();
  if (command === 'backup') {
    if (args.length !== 2 || args[0] !== '--out' || !get('--out'))
      throw new SafeError('Usage: backup --out /private/path/backup.noxh');
    if (!process.env.SOURCE_DATABASE_URL) throw new SafeError('SOURCE_DATABASE_URL is required');
    console.log(
      JSON.stringify(
        await backup({ url: process.env.SOURCE_DATABASE_URL, out: get('--out'), key }),
      ),
    );
  } else if (command === 'restore') {
    if (
      args.length !== 3 ||
      !args.includes('--drill') ||
      args.filter((x) => x === '--input').length !== 1 ||
      !get('--input') ||
      get('--input').startsWith('--')
    )
      throw new SafeError('Usage: restore --input /private/path/backup.noxh --drill');
    if (!process.env.DRILL_ADMIN_DATABASE_URL)
      throw new SafeError('DRILL_ADMIN_DATABASE_URL is required');
    console.log(
      JSON.stringify(
        await restoreDrill({
          input: get('--input'),
          adminUrl: process.env.DRILL_ADMIN_DATABASE_URL,
          key,
          drill: true,
        }),
      ),
    );
  } else
    throw new SafeError(
      'Choose backup or restore --drill; no direct overwrite restore is provided',
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(
      e instanceof SafeError
        ? e.message
        : 'Backup/restore failed; sensitive database errors are not printed',
    );
    process.exitCode = 1;
  });
