import { z } from 'zod';
const paragraph = z.string().trim().min(10).max(2000);
export const PrivacyNoticeSchema = z
  .object({
    controller: z.string().trim().min(3).max(300),
    contact: z.string().trim().min(5).max(300),
    purposes: paragraph,
    categories: paragraph,
    legalBasis: paragraph,
    recipients: paragraph,
    retention: paragraph,
    transfers: paragraph,
    safeguards: paragraph,
    rights: paragraph,
    consequences: paragraph,
    governance: paragraph,
    reviewed: z.literal(true),
  })
  .strict();
export type PrivacyNoticeInput = z.infer<typeof PrivacyNoticeSchema>;
export interface PrivacyNotice extends PrivacyNoticeInput {
  id: string;
  version: number;
  content_hash: string;
  status: 'draft' | 'approved' | 'revoked';
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
}
export const PrivacyChoiceSchema = z
  .object({
    noticeId: z.uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    accepted: z.literal(true),
  })
  .strict();
export const PrivacyRequestSchema = z
  .object({
    kind: z.enum(['access', 'rectify', 'erase', 'restrict', 'object', 'complaint']),
    message: z.string().trim().min(5).max(2000),
  })
  .strict();
export interface PrivacyRequest {
  id: string;
  kind: string;
  message: string;
  reply: string | null;
  status: 'new' | 'processing' | 'responded';
  version: number;
  created_at: string;
}
export interface PrivacyWorkspace {
  notice: PrivacyNotice | null;
  accepted: boolean;
  restricted: boolean;
  requests: PrivacyRequest[];
}
