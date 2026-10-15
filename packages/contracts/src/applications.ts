import { z } from 'zod';
const files = z
  .array(z.uuid())
  .min(1)
  .max(50)
  .refine((v) => new Set(v).size === v.length);
const forms = z
  .array(z.uuid())
  .max(30)
  .refine((v) => new Set(v).size === v.length);
export const ApplicationSubmissionSchema = z
  .object({
    roundId: z.uuid(),
    inputVersion: z.number().int().min(1),
    documentIds: files,
    generatedFormIds: forms,
    mode: z.enum(['buy', 'rent-buy', 'rent']),
    subjectGroup: z.number().int().min(1).max(13),
    accepted: z.literal(true),
    noConcurrentHouseholdApplication: z.literal(true),
    noticeId: z.uuid(),
  })
  .strict();
export const SupplementSchema = z
  .object({
    documentIds: files,
    generatedFormIds: forms,
    message: z.string().trim().min(5).max(2000),
    accepted: z.literal(true),
  })
  .strict();
export const RecommendationSchema = z
  .object({
    eligible: z.boolean(),
    reasonCode: z.string().regex(/^[A-Z0-9_-]{3,60}$/),
    reason: z.string().trim().min(10).max(4000),
    evidenceRefs: z.array(z.string().trim().min(3).max(200)).min(1).max(30),
    accepted: z.literal(true),
  })
  .strict();
export const ApplicationDecisionSchema = z
  .object({
    recommendationId: z.uuid(),
    accepted: z.literal(true),
    decisionReference: z.string().trim().min(5).max(300),
    publicReason: z.string().trim().min(10).max(3000),
  })
  .strict();
export interface ApplicationRead {
  id: string;
  project_id: string;
  round_id: string;
  dossier_id: string;
  receipt_code: string;
  public_code: string;
  status: string;
  version: number;
  synthetic: boolean;
  submitted_at: string;
  project_name: string;
  round_name: string;
  assigned_reviewer: string | null;
  recommendation_id: string | null;
  decision_reason: string | null;
  snapshot_hash: string;
}
export interface ApplicationDetail extends ApplicationRead {
  snapshot: {
    declaration: Record<string, unknown>;
    mode: string;
    subjectGroup: number;
    inputVersion: number;
    documents: { id: string; sha256: string; type: string }[];
    forms: { id: string; sha256: string; mappingId: string }[];
  };
  supplements: {
    id: string;
    message: string;
    created_at: string;
    documentIds: string[];
    formIds: string[];
  }[];
  reviews: {
    id: string;
    reviewer: string;
    eligible: boolean;
    reasonCode: string;
    reason: string;
    evidenceRefs: string[];
    created_at: string;
  }[];
  appeals: {
    id: string;
    message: string;
    reply: string | null;
    status: string;
    version: number;
    created_at: string;
  }[];
}
