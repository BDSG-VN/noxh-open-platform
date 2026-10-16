import { z } from 'zod';
const amount = z.string().regex(/^(0|[1-9]\d{0,17})$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const TenancyInstallmentSchema = z
  .object({
    dueOn: z.iso.date(),
    label: z.string().trim().min(2).max(160),
    amountVnd: amount,
  })
  .strict()
  .refine((v) => BigInt(v.amountVnd) > 0n, 'Khoản phải thu phải dương');
export const TenancyDraftSchema = z
  .object({
    applicationId: z.uuid(),
    unitId: z.uuid(),
    mode: z.enum(['buy', 'rent', 'rent-buy']),
    title: z.string().trim().min(5).max(180),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    terms: z.string().trim().min(30).max(12000),
    basis: z.string().trim().min(20).max(3000),
    evidenceHash: hash,
    handoverRequiredVnd: amount,
    schedule: z.array(TenancyInstallmentSchema).min(1).max(240),
    synthetic: z.literal(true),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.endsOn < v.startsOn)
      c.addIssue({ code: 'custom', message: 'Ngày kết thúc trước ngày bắt đầu' });
    if (v.schedule.some((i) => i.dueOn < v.startsOn || i.dueOn > v.endsOn))
      c.addIssue({ code: 'custom', message: 'Kỳ thu ngoài thời hạn' });
    if (BigInt(v.handoverRequiredVnd) > v.schedule.reduce((s, i) => s + BigInt(i.amountVnd), 0n))
      c.addIssue({ code: 'custom', message: 'Ngưỡng bàn giao vượt tổng lịch thu' });
  });
export const TenancyReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    accepted: z.literal(true),
    note: z.string().trim().min(20).max(2000),
  })
  .strict();
export const TenancyPaymentSchema = z
  .object({
    dueId: z.uuid(),
    amountVnd: amount,
    reference: z.string().trim().min(5).max(200),
    evidenceHash: hash,
    idempotencyKey: z.uuid(),
    synthetic: z.literal(true),
  })
  .strict()
  .refine((v) => BigInt(v.amountVnd) > 0n, 'Số tiền phải dương');
export const TenancyActionSchema = z
  .object({
    kind: z.enum(['handover', 'extend', 'terminate', 'return']),
    reason: z.string().trim().min(20).max(3000),
    evidenceHash: hash,
    newEndsOn: z.iso.date().optional(),
    schedule: z.array(TenancyInstallmentSchema).max(240).default([]),
    idempotencyKey: z.uuid(),
    synthetic: z.literal(true),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.kind === 'extend' && (!v.newEndsOn || !v.schedule.length))
      c.addIssue({ code: 'custom', message: 'Gia hạn cần ngày và lịch thu mới' });
    if (v.kind !== 'extend' && (v.newEndsOn || v.schedule.length))
      c.addIssue({ code: 'custom', message: 'Chỉ gia hạn được thêm kỳ thu' });
  });
export const TenancyConfirmationSchema = z.object({ accepted: z.literal(true) }).strict();
export type TenancyDraft = z.infer<typeof TenancyDraftSchema>;
export interface TenancyDue {
  id: string;
  dueOn: string;
  label: string;
  amountVnd: string;
  reconciledVnd: string;
  pendingVnd: string;
}
export interface TenancyView {
  id: string;
  projectId: string;
  applicationCode: string;
  unitCode: string;
  mode: 'buy' | 'rent' | 'rent-buy';
  title: string;
  startsOn: string;
  endsOn: string;
  terms: string;
  basis: string;
  evidenceHash: string;
  snapshotHash: string;
  totalVnd: string;
  handoverRequiredVnd: string;
  status: string;
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  synthetic: true;
  notice: string;
  dues: TenancyDue[];
  payments: {
    id: string;
    dueId: string;
    amountVnd: string;
    status: string;
    version: number;
    createdBy: string;
    reference: string;
    evidenceHash: string;
  }[];
  actions: {
    id: string;
    kind: string;
    reason: string;
    evidenceHash: string;
    newEndsOn?: string;
    status: string;
    version: number;
    createdBy: string;
    ownerConfirmed: boolean;
    schedule: z.infer<typeof TenancyInstallmentSchema>[];
  }[];
}
