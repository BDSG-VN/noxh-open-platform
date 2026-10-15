import { afterEach, beforeAll, afterAll, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRustKernel } from './native-kernel';
const prior = { ...process.env };
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'noxh-kernel-safety-'));
});
afterEach(() => {
  process.env = { ...prior };
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
async function program(name: string, body: string) {
  const file = join(dir, name);
  await writeFile(file, '#!' + process.execPath + '\n' + body, { mode: 0o700 });
  await chmod(file, 0o700);
  return file;
}
it('sends private input through stdin only and removes parent credentials from the process environment', async () => {
  process.env.AUTH_ENCRYPTION_KEY = 'synthetic-parent-key-only';
  process.env.LOTTERY_ENGINE_BIN = await program(
    'stdin-only',
    `let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>console.log(JSON.stringify({received:JSON.parse(text),argv:process.argv.slice(2),inherited:!!process.env.AUTH_ENCRYPTION_KEY})));`,
  );
  const input = { secret: 'SYNTHETIC DATA', untrusted: '$(never executed); `never executed`' };
  expect(await runRustKernel('lottery', input)).toEqual({
    received: input,
    argv: [],
    inherited: false,
  });
});
it('fails closed for missing or relative binaries, oversized input and malformed or excessive output', async () => {
  process.env.LOTTERY_ENGINE_BIN = 'relative-binary';
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 503 });
  process.env.LOTTERY_ENGINE_BIN = join(dir, 'missing');
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 503 });
  await expect(runRustKernel('lottery', { value: 'x'.repeat(2_000_001) })).rejects.toMatchObject({
    status: 503,
  });
  process.env.LOTTERY_ENGINE_BIN = await program(
    'invalid-output',
    `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('not JSON'));`,
  );
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 503 });
  process.env.LOTTERY_ENGINE_BIN = await program(
    'excess-output',
    `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('x'.repeat(2_000_001)));`,
  );
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 503 });
});
it('bounds simultaneous calls and terminates stalled native processing', async () => {
  process.env.RUST_KERNEL_TIMEOUT_MS = '100';
  process.env.LOTTERY_ENGINE_BIN = await program(
    'stalled',
    `process.stdin.resume();setInterval(()=>{},1000);`,
  );
  const first = runRustKernel('lottery', {}),
    second = runRustKernel('lottery', {});
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 429 });
  const results = await Promise.allSettled([first, second]);
  expect(results.every((r) => r.status === 'rejected' && r.reason.status === 503)).toBe(true);
});
it('returns bounded audit failure evidence and accepts quote arrays only for the pricing protocol', async () => {
  process.env.AUDIT_VERIFIER_BIN = await program(
    'audit-invalid',
    `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({valid:false,code:'CHAIN_MISMATCH',checked:0}));process.exitCode=1;});`,
  );
  expect(await runRustKernel('audit', {})).toEqual({
    valid: false,
    code: 'CHAIN_MISMATCH',
    checked: 0,
  });
  const array = await program(
    'array',
    `process.stdin.resume();process.stdin.on('end',()=>console.log('[]'));`,
  );
  process.env.PRICING_ENGINE_BIN = array;
  expect(await runRustKernel('pricing', {})).toEqual([]);
  process.env.LOTTERY_ENGINE_BIN = array;
  await expect(runRustKernel('lottery', {})).rejects.toMatchObject({ status: 503 });
});
