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
