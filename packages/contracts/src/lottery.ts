import { z } from 'zod';
export const priorityReferencePolicy = {
  id: 'article-38-five-group-reference-2026-05-18',
  label: 'Phép tính tham khảo 5 nhóm trong nguồn hợp nhất ngày 18/5/2026',
  sourceUrl: 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/24-vbhn-bxd.pdf',
  sourceCutoff: '2026-05-18',
  legalChangeReviewFrom: '2026-07-01',
  groupCount: 5,
  scope:
    'Tham khảo Điều 38; không áp chung cho vốn đầu tư công, tài chính công đoàn hoặc nhà ở chuyên ngành.',
} as const;
export const priorityGroups = [
  'Người có công với cách mạng',
  'Thân nhân liệt sĩ',
  'Người khuyết tật',
  'Tái định cư theo hình thức mua NOXH',
  'Nữ giới thuộc trường hợp ưu tiên được xác minh',
] as const;
export const PriorityInputSchema = z
  .object({
    totalEligible: z.number().int().min(1).max(1000000),
    homes: z.number().int().min(1).max(1000000),
    counts: z.array(z.number().int().min(0).max(1000000)).length(5),
    rounding: z.enum(['floor', 'ceil', 'nearest']).nullable(),
    roundingBasis: z.string().trim().max(1000),
    uniqueVerified: z.literal(true),
  })
  .strict();
export type PriorityInput = z.infer<typeof PriorityInputSchema>;
export function calculatePriority(b: PriorityInput) {
  const n = PriorityInputSchema.parse(b),
    priority = n.counts.reduce((s, v) => s + v, 0);
  if (priority > n.totalEligible)
    throw new Error(
      'Tổng nhóm ưu tiên không được vượt số hồ sơ đủ điều kiện; mỗi hồ sơ chỉ tính một lần.',
    );
  const numerator = priority * n.homes,
    denominator = n.totalEligible,
    whole = numerator % denominator === 0;
  if (!whole && n.rounding && !n.roundingBasis.trim())
    throw new Error('Cần căn cứ được rà soát cho quy tắc làm tròn.');
  const quota = whole
    ? numerator / denominator
    : n.rounding
      ? Math[n.rounding === 'floor' ? 'floor' : n.rounding === 'ceil' ? 'ceil' : 'round'](
          numerator / denominator,
        )
      : null;
  const seats = quota === null ? null : Math.min(quota, priority, n.homes);
  let remaining = seats;
  const groups = n.counts.map((count, i) => {
    const available = remaining,
      allocate = remaining === null ? null : Math.min(count, remaining);
    if (remaining !== null) remaining -= allocate!;
    return {
      name: priorityGroups[i],
      count,
      available,
      allocate,
      requiresDraw: allocate !== null && count > allocate && allocate > 0,
    };
  });
  return {
    referencePolicy: priorityReferencePolicy,
    policyReviewRequired: true as const,
    currentLawConformityVerified: false as const,
    formula: `${priority} × ${n.homes} / ${n.totalEligible}`,
    priorityEligible: priority,
    numerator,
    denominator,
    exact: numerator / denominator,
    integer: whole,
    quota: seats,
    requiresRoundingReview: !whole && !n.rounding,
    groups,
    generalSeats: seats === null ? null : n.homes - seats,
    requiresSelection: n.totalEligible > n.homes,
    notice:
      'Chỉ mô phỏng số học 5 nhóm từ nguồn hợp nhất ngày 18/5/2026. Luật Dân số sửa nhóm và thứ tự ưu tiên từ 1/7/2026; phải rà soát quy định hiện hành và nguồn vốn trước áp dụng. Chưa xác minh phù hợp pháp luật hiện hành; việc chọn làm tròn không thay thế rà soát này và phép tính không xác định quyền được mua.',
  };
}
const code = z.string().regex(/^DEMO-[A-Z0-9-]{4,32}$/);
export const LotteryCohortSchema = z
  .object({
    roundId: z.uuid(),
    mode: z.enum(['buy', 'rent-buy', 'rent']),
    kind: z.enum(['selection', 'allocation', 'priority-overflow']),
    seats: z.number().int().min(1).max(500),
    description: z.string().trim().min(30).max(2000),
    legalBasis: z.string().trim().min(10).max(2000),
    exclusions: z
      .array(
        z
          .object({
            code,
            category: z.enum(['priority-exempt', 'separate-group']),
            reason: z.string().trim().min(20).max(1000),
            evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(500),
    supersedesId: z.uuid().nullable(),
    replacementReason: z.string().trim().max(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.exclusions.map((e) => e.code)).size !== v.exclusions.length)
      ctx.addIssue({ code: 'custom', message: 'Không được loại trùng mã' });
    if (v.supersedesId && v.replacementReason.length < 20)
      ctx.addIssue({ code: 'custom', message: 'Cần căn cứ thay thế và bảo toàn phiên cũ' });
  });
export type LotteryCohortInput = z.infer<typeof LotteryCohortSchema>;
export interface LotteryCohort {
  id: string;
  projectId: string;
  roundId: string;
  roundName: string;
  mode: 'buy' | 'rent-buy' | 'rent';
  kind: 'selection' | 'allocation' | 'priority-overflow';
  seats: number;
  entries: string[];
  sourceSnapshot: [string, number, string][];
  sourceHash: string;
  hash: string;
  status: 'draft' | 'reviewed' | 'voided' | 'superseded';
  version: number;
  description: string;
  legalBasis: string;
  exclusions: LotteryCohortInput['exclusions'];
  supersedesId: string | null;
  replacementReason: string;
  createdBy: string;
  reviewedBy: string | null;
  attemptId: string | null;
  attemptStatus: string | null;
}
export interface LotteryCohortSource {
  projectId: string;
  roundId: string;
  roundName: string;
  mode: string;
  hash: string;
  entries: { code: string; version: number; snapshotHash: string }[];
}
export const LotteryConfigSchema = z
  .object({
    cohortId: z.uuid(),
    projectId: z.uuid(),
    title: z.string().trim().min(5).max(150),
    kind: z.enum(['selection', 'allocation', 'priority-overflow']),
    seats: z.number().int().min(1).max(500),
    entries: z.array(code).min(1).max(500),
    units: z.array(z.string().regex(/^[A-Z0-9-]{1,24}$/)).max(500),
    rules: z.string().trim().min(30).max(4000),
    legalBasis: z.string().trim().min(10).max(1000),
    priorityResolution: z.string().trim().min(20).max(2000),
    eligibilityEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    scheduledAt: z.iso.datetime(),
    entropySource: z.string().trim().min(10).max(500),
    synthetic: z.literal(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.entries).size !== v.entries.length || new Set(v.units).size !== v.units.length)
      ctx.addIssue({ code: 'custom', message: 'Mã hồ sơ và căn hộ phải duy nhất' });
    if (
      v.kind === 'allocation'
        ? v.units.length !== v.entries.length || v.seats !== v.entries.length
        : v.entries.length <= v.seats || v.units.length !== 0
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Chọn suất chỉ dùng khi hồ sơ vượt suất; gán căn cần số căn bằng số người đã được chọn',
      });
  });
export type LotteryConfig = z.infer<typeof LotteryConfigSchema>;
export interface LotteryRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
  version: number;
  config: LotteryConfig;
  created_by: string;
  reviewed_by: string | null;
  commitment: string | null;
  snapshot_hash: string | null;
  frozen_at: string | null;
  result: LotteryResult | null;
}
export interface LotteryResult {
  ranking: { code: string; rank: number; selected: boolean; unit: string | null }[];
  algorithm: string;
  snapshotHash: string;
  commitment: string;
  secret: string;
  entropy: string;
}
