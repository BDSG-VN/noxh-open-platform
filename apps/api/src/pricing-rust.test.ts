import 'reflect-metadata';
import { afterAll, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { calculateInventoryPrices, type InventoryUnit } from '@noxh/contracts';
import { runRustKernel } from './native-kernel';

// Intentionally mandatory: run `pnpm native:build` before tests. Never replace this with a mock or skip.
const previous = process.env.PRICING_ENGINE_BIN;
process.env.PRICING_ENGINE_BIN ||= resolve('../..', 'target/release/pricing-engine');
afterAll(() => {
  if (previous === undefined) delete process.env.PRICING_ENGINE_BIN;
  else process.env.PRICING_ENGINE_BIN = previous;
});
const unit = (code: string, position: number, areaCm2 = 10000, weight = 1): InventoryUnit => ({
  code,
  building: 'A',
  floor: 1,
  position,
  areaCm2,
  weight,
  type: '2 phòng ngủ',
  orientation: 'Đông Nam',
});
const price = (units: InventoryUnit[], baseVndPerM2: string) =>
  runRustKernel('pricing', { units, baseVndPerM2 });

it('uses the actual Rust executable for half-up ties, unreduced fractions and canonical ASCII order', async () => {
  const units = [unit('A2', 3, 10000, 3), unit('A10', 2), unit('A-1', 1)];
  expect(await price(units, '101')).toEqual(calculateInventoryPrices(units, '101'));
  const ties = await price([unit('A1', 1), unit('A2', 2, 10000, 3)], '101');
  expect(ties).toMatchObject([{ totalVnd: '51' }, { totalVnd: '152' }]);
});

it('matches the exact TS reference across reproducible mixed building and unequal-area vectors', async () => {
  let state = 0x1678;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  for (let vector = 0; vector < 40; vector++) {
    const units = Array.from({ length: 1 + (next() % 80) }, (_, i) => ({
      ...unit(`U-${i}`, i + 1, 10000 + (next() % 99990001), 1 + (next() % 1000000)),
      building: `B${next() % 4}`,
      floor: -5 + (next() % 206),
    })).reverse();
    const base = String(1 + next() * 19);
    expect(await price(units, base)).toEqual(calculateInventoryPrices(units, base));
  }
});

it('keeps large integer prices exact at the maximum supported input bounds', async () => {
  const units = Array.from({ length: 500 }, (_, i) =>
    unit(`A${String(i).padStart(3, '0')}`, i + 1, 100000000, i === 0 ? 1000000 : 1),
  );
  const actual = await price(units, '99999999999');
  expect(actual).toEqual(calculateInventoryPrices(units, '99999999999'));
  expect(BigInt((actual as { totalVnd: string }[])[0]!.totalVnd)).toBeGreaterThan(
    BigInt(Number.MAX_SAFE_INTEGER),
  );
});

it('normalizes whitespace exactly as JS while ignoring descriptive fields in price arithmetic', async () => {
  const units = [
    unit('\uFEFFA1\uFEFF', 1),
    { ...unit('A2', 2, 30000, 3), type: ' 🏠 ', orientation: '\u00A0Đông\u00A0' },
  ];
  expect(await price(units, '101')).toEqual(calculateInventoryPrices(units, '101'));
  const a = [unit('A1', 1), unit('A2', 2, 30000, 3)];
  const q = await price(a, '100');
  expect(
    await price(
      a.map((u) => ({ ...u, type: '3 phòng', orientation: 'Tây', floor: 2 })),
      '100',
    ),
  ).toEqual(q);
  expect(await price([a[0]!, { ...a[1]!, areaCm2: 10000 }], '100')).not.toEqual(q);
  expect(
    (
      (await price(
        [...a, { ...unit('B1', 1, 100000000, 1000000), building: 'B' }],
        '100',
      )) as unknown[]
    ).slice(0, 2),
  ).toEqual(q);
});

it('rejects unsupported bounds and duplicate positions through the real bridge', async () => {
  for (const [units, base] of [
    [[unit('A', 1)], '100000000000'],
    [[unit('A', 1)], '1e9'],
    [[unit('A', 1, 100000001)], '1'],
    [[unit('A', 1, 10000, 1000001)], '1'],
    [[unit('A', 1), unit('B', 1)], '1'],
    [Array.from({ length: 501 }, (_, i) => unit(`A${i}`, i + 1)), '1'],
  ] as [InventoryUnit[], string][]) {
    await expect(price(units, base)).rejects.toMatchObject({ status: 503 });
  }
});
