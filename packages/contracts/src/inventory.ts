import { z } from 'zod';
const code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9-]{1,24}$/);
export const InventoryUnitSchema = z
  .object({
    code,
    building: code,
    floor: z.number().int().min(-5).max(200),
    position: z.number().int().min(1).max(500),
    areaCm2: z.number().int().min(10000).max(100000000),
    type: z.string().trim().min(1).max(60),
    orientation: z.string().trim().min(1).max(60),
    weight: z.number().int().min(1).max(1000000),
  })
  .strict();
export const InventoryImportSchema = z
  .object({ units: z.array(InventoryUnitSchema).min(1).max(500), synthetic: z.literal(true) })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.units.map((x) => x.code)).size !== v.units.length ||
      new Set(v.units.map((x) => `${x.building}:${x.floor}:${x.position}`)).size !== v.units.length
    )
      c.addIssue({ code: 'custom', message: 'Mã căn và vị trí phải duy nhất' });
  });
export type InventoryUnit = z.infer<typeof InventoryUnitSchema>;
export const PricePlanSchema = z
  .object({
    title: z.string().trim().min(5).max(150),
    baseVndPerM2: z.string().regex(/^[1-9]\d{0,10}$/),
    basis: z.string().trim().min(20).max(2000),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    effectiveFrom: z.iso.datetime(),
    rounding: z.literal('half-up-vnd'),
    taxIncluded: z.literal(true),
    maintenanceExcluded: z.literal(true),
    synthetic: z.literal(true),
  })
  .strict();
export type PricePlanInput = z.infer<typeof PricePlanSchema>;
export const SalesRulesSchema = z
  .object({
    mode: z.enum(['disabled', 'queue-choice', 'published-random']),
    lotteryId: z.uuid().nullable(),
    rules: z.string().trim().min(30).max(4000),
    basis: z.string().trim().min(20).max(2000),
    rulesHash: z.string().regex(/^[a-f0-9]{64}$/),
    synthetic: z.literal(true),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.mode !== 'disabled' && !v.lotteryId)
      c.addIssue({ code: 'custom', message: 'Cần kết quả diễn tập đã công bố' });
  });
export const QueueBindingSchema = z
  .object({
    code: z.string().regex(/^DEMO-[A-Z0-9-]{4,32}$/),
    dossierId: z.uuid(),
    applicationId: z.uuid(),
    synthetic: z.literal(true),
  })
  .strict();
export const AllocateUnitSchema = z
  .object({ unitCode: code.optional(), accepted: z.literal(true), idempotencyKey: z.uuid() })
  .strict();
export const QueueRevocationSchema = z
  .object({ accepted: z.literal(true), reason: z.string().trim().min(20).max(2000) })
  .strict();
export interface PriceQuote {
  code: string;
  building: string;
  areaCm2: number;
  coefficientNumerator: string;
  coefficientDenominator: string;
  totalVnd: string;
  unitPriceNumerator: string;
  unitPriceDenominator: string;
}
/** Exact reference only. Canonical ASCII code order; no locale-dependent ordering or floats. */
export function calculateInventoryPrices(
  units: InventoryUnit[],
  baseVndPerM2: string,
): PriceQuote[] {
  const parsed = InventoryImportSchema.parse({ units, synthetic: true });
  if (!/^[1-9]\d{0,10}$/.test(baseVndPerM2)) throw new Error('Đơn giá phải là số nguyên đồng');
  const base = BigInt(baseVndPerM2),
    totals = new Map<string, { area: bigint; weighted: bigint }>();
  for (const u of parsed.units) {
    const t = totals.get(u.building) ?? { area: 0n, weighted: 0n };
    t.area += BigInt(u.areaCm2);
    t.weighted += BigInt(u.areaCm2) * BigInt(u.weight);
    totals.set(u.building, t);
  }
  return [...parsed.units]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((u) => {
      const t = totals.get(u.building)!,
        numerator = BigInt(u.weight) * t.area,
        denominator = t.weighted;
      const raw = base * BigInt(u.areaCm2) * numerator,
        divisor = 10000n * denominator;
      return {
        code: u.code,
        building: u.building,
        areaCm2: u.areaCm2,
        coefficientNumerator: String(numerator),
        coefficientDenominator: String(denominator),
        unitPriceNumerator: String(base * numerator),
        unitPriceDenominator: String(denominator),
        totalVnd: String((raw * 2n + divisor) / (2n * divisor)),
      };
    });
}
