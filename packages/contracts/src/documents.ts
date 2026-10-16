import { z } from 'zod';
export const DocumentUploadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((v) => !/[\\/]/.test(v) && !Array.from(v).some((c) => c.charCodeAt(0) < 32)),
    type: z.enum(['identity', 'housing', 'income', 'subject', 'attested-form', 'other']),
    mime: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    base64: z
      .string()
      .min(4)
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export const ExtractionFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,59}$/),
    label: z.string().min(1).max(160),
    value: z.string().max(1000),
    page: z.number().int().min(1).max(100),
    confidence: z.number().min(0).max(1),
    evidence: z.string().max(500),
  })
  .strict();
export const ExtractionSchema = z
  .object({
    fields: z.array(ExtractionFieldSchema).max(80),
    warnings: z.array(z.string().max(400)).max(20),
  })
  .strict();
export const AcceptedFieldsSchema = z
  .object({ accepted: z.literal(true), fields: z.array(ExtractionFieldSchema).max(80) })
  .strict();
export const MappingFieldSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,59}$/),
    label: z.string().trim().min(1).max(160),
    page: z.number().int().min(1).max(100),
    x: z.number().min(0).max(2000),
    y: z.number().min(0).max(2000),
    width: z.number().min(10).max(2000),
    height: z.number().min(8).max(1000),
    fontSize: z.number().min(6).max(16),
    required: z.boolean(),
    externalConfirmation: z.boolean(),
  })
  .strict();
export const FormMappingSchema = z
  .object({
    releaseId: z.uuid(),
    title: z.string().trim().min(3).max(200),
    fields: z.array(MappingFieldSchema).min(1).max(100),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    reviewedCoordinates: z.literal(true),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom)
  .refine((v) => new Set(v.fields.map((f) => f.key)).size === v.fields.length);
export const GenerateFormSchema = z
  .object({
    mappingId: z.uuid(),
    inputVersion: z.number().int().positive(),
    values: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_]{0,59}$/), z.string().max(1000)),
    evidenceIds: z.array(z.uuid()).max(30),
  })
  .strict();
export type MappingField = z.infer<typeof MappingFieldSchema>;
export type ExtractionField = z.infer<typeof ExtractionFieldSchema>;
export const InternalFileUploadSchema = DocumentUploadSchema.omit({ type: true })
  .extend({
    department: z.enum(['project_office', 'accounting', 'administration', 'legal', 'business']),
    classification: z.literal('restricted'),
  })
  .strict();
/** Purpose-specific consent for self-hosted OCR of one clean-scanned document (ADR 020). */
export const OcrConsentSchema = z
  .object({ accepted: z.literal(true), noticeVersion: z.literal('document-ocr-v1') })
  .strict();
export const OcrAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
/** Worker reply contract: text blocks with boxes and confidence; validated before storage. */
export const OcrBlockSchema = z
  .object({
    page: z.number().int().min(1).max(100),
    text: z.string().max(1000),
    confidence: z.number().min(0).max(1),
    bbox: z
      .object({
        x: z.number().int().min(0).max(100000),
        y: z.number().int().min(0).max(100000),
        width: z.number().int().min(0).max(100000),
        height: z.number().int().min(0).max(100000),
      })
      .strict(),
  })
  .strict();
export const OcrResultSchema = z
  .object({
    engine: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
    engine_version: z.string().min(1).max(80),
    languages: z.array(z.string().regex(/^[a-z_]{3,12}$/)).max(10),
    pages: z.number().int().min(1).max(100),
    quality: z.number().min(0).max(1),
    processing_ms: z.number().int().min(0).max(3_600_000),
    blocks: z.array(OcrBlockSchema).max(400),
    warnings: z.array(z.string().max(200)).max(20),
  })
  .strict();
export type OcrBlock = z.infer<typeof OcrBlockSchema>;
export type OcrResult = z.infer<typeof OcrResultSchema>;
export type OcrJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type OcrJobReason =
  | 'worker_unavailable'
  | 'worker_timeout'
  | 'worker_rejected'
  | 'invalid_result'
  | 'document_unavailable'
  | 'consent_unavailable'
  | 'attempts_exhausted'
  | 'processing_failed'
  | 'cancelled_by_owner'
  | 'requeued';
export interface OcrJobView {
  id: string;
  documentId: string;
  status: OcrJobStatus;
  reason: OcrJobReason | null;
  attemptCount: number;
  attemptBudget: number;
  requeueCount: number;
  nextAttemptAt: string | null;
  qualityScore: number | null;
  lowQuality: boolean | null;
  engine: string | null;
  extractionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface OcrJobDetail extends OcrJobView {
  result: OcrResult | null;
  qualityThreshold: number;
}
export interface OcrWorkspace {
  enabled: boolean;
  items: OcrJobView[];
  qualityThreshold: number;
  notice: string;
}
export interface OcrQueueHealth {
  enabled: boolean;
  workerConfigured: boolean;
  counts: Record<OcrJobStatus, number>;
  oldestPendingSeconds: number | null;
  staleLeases: number;
  recentFailures: { id: string; reason: OcrJobReason | null; updatedAt: string; version: number }[];
  notice: string;
}
