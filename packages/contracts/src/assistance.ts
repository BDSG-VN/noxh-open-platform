import { z } from 'zod';
export const OnlineCaseSchema = z
  .object({
    procedureId: z.enum(['1.014632', '1.012896']),
    reference: z.string().trim().min(1).max(120),
    authority: z.string().trim().min(1).max(200),
    status: z.enum(['submitted', 'processing', 'additional', 'completed', 'rejected']),
    note: z.string().trim().max(1000).default(''),
  })
  .strict();
export type OnlineCaseInput = z.infer<typeof OnlineCaseSchema>;
export interface OnlineCase extends OnlineCaseInput {
  id: string;
  version: number;
  updated_at: string;
  source: 'citizen-reported';
}
export const AiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    model: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9._-]{1,100}$/),
    dailyLimit: z.number().int().min(1).max(1000),
    apiKey: z.string().min(20).max(512).optional(),
  })
  .strict();
export interface AiSettings {
  enabled: boolean;
  model: string;
  dailyLimit: number;
  hasKey: boolean;
  version: number;
}
export const AiMessageSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    accepted: z.literal(true),
    shareDeclaration: z.boolean(),
  })
  .strict();
export const AiPatchSchema = z
  .object({
    fullName: z.string().trim().max(200).nullable(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    address: z.string().trim().max(500).nullable(),
    occupation: z.string().trim().max(200).nullable(),
  })
  .strict();
export type AiPatch = z.infer<typeof AiPatchSchema>;
export interface AiProposal {
  id: string;
  kind: 'declaration' | 'support';
  payload: AiPatch | { message: string };
  inputVersion: number;
  expiresAt: string;
}
export const FormReleaseSchema = z
  .object({
    formId: z.string().regex(/^[a-z0-9-]{1,100}$/),
    recipient: z.string().trim().min(1).max(500),
    instructions: z.string().trim().min(1).max(4000),
    mode: z.enum(['buy', 'rent-buy', 'rent']),
    group: z.number().int().min(1).max(13),
    reviewed: z.literal(true),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
  })
  .strict();
export interface LegalForm {
  id: string;
  title: string;
  legalBasis: string;
  category: string;
  modes: string[];
  groups: number[];
  sourceUrl: string;
  sourceSha256: string;
  sourcePages: number[];
  sha256: string;
  file: string;
  externalConfirmation: string | null;
  reviewStatus: string;
}
export interface FormRelease {
  status: 'draft' | 'approved' | 'revoked';
  effective_from: string;
  effective_to: string | null;
  id: string;
  form_id: string;
  title: string;
  recipient: string;
  instructions: string;
  mode: string;
  subject_group: number;
  source_hash: string;
  created_at: string;
  created_by: string;
  version: number;
}
export interface OnlineProcedure {
  id: string;
  title: string;
  url: string;
  purpose: string;
  appliesTo: string;
}
export const onlineProcedures: OnlineProcedure[] = [
  {
    id: '1.014632',
    title: 'Xác nhận điều kiện, đối tượng và thu nhập về nhà ở xã hội',
    url: 'https://dichvucong.gov.vn/p/home/dvc-chi-tiet-thu-tuc-hanh-chinh.html?ma_thu_tuc=1.014632',
    purpose: 'Chọn trường hợp xác nhận, địa phương và cơ quan tiếp nhận trên Cổng Dịch vụ công.',
    appliesTo:
      'Các giấy xác nhận trong hồ sơ NOXH; kiểm tra trường hợp và mẫu đang áp dụng tại nơi tiếp nhận.',
  },
  {
    id: '1.012896',
    title: 'Thuê, thuê mua NOXH đầu tư bằng vốn đầu tư công',
    url: 'https://dichvucong.gov.vn/p/home/dvc-chi-tiet-thu-tuc-hanh-chinh.html?ma_thu_tuc=1.012896',
    purpose: 'Thủ tục tiếp nhận tại đơn vị quản lý nhà ở hoặc Sở Xây dựng.',
    appliesTo:
      'Dự án do Nhà nước đầu tư bằng vốn đầu tư công. Không áp dụng chung cho mọi dự án tư nhân.',
  },
];
