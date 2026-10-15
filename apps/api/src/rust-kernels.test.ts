import { afterAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runRustKernel } from './native-kernel';
const prior = { lottery: process.env.LOTTERY_ENGINE_BIN, audit: process.env.AUDIT_VERIFIER_BIN };
process.env.LOTTERY_ENGINE_BIN ||= resolve('../..', 'target/release/lottery-runner');
process.env.AUDIT_VERIFIER_BIN ||= resolve('../..', 'target/release/audit-verifier');
afterAll(() => {
  for (const [key, value] of [
    ['LOTTERY_ENGINE_BIN', prior.lottery],
    ['AUDIT_VERIFIER_BIN', prior.audit],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
it('runs the actual Rust lottery engine through the bounded stdin bridge and reproduces the golden result', async () => {
  const v = JSON.parse(
    await readFile(resolve('../..', 'tests/fixtures/lottery-vector.json'), 'utf8'),
  );
  expect(
    await runRustKernel('lottery', {
      id: v.id,
      config: v.config,
      secret: v.result.secret,
      entropy: v.result.entropy,
    }),
  ).toEqual(v.result);
  await expect(
    runRustKernel('lottery', {
      id: v.id,
      config: { ...v.config, synthetic: false },
      secret: v.result.secret,
      entropy: v.result.entropy,
    }),
  ).rejects.toMatchObject({ status: 503 });
});
it('runs the actual Rust audit verifier on Node-generated Unicode evidence and returns failure for modified events', async () => {
  const v = JSON.parse(
    await readFile(
      resolve('../..', 'crates/audit-verifier/tests/fixtures/node-golden.json'),
      'utf8',
    ),
  );
  const expected = JSON.parse(
    await readFile(
      resolve('../..', 'crates/audit-verifier/tests/fixtures/node-golden-result.json'),
      'utf8',
    ),
  );
  expect(await runRustKernel('audit', v)).toEqual(expected);
  v.events[0].action += ' changed';
  expect(await runRustKernel('audit', v)).toMatchObject({ valid: false });
});
