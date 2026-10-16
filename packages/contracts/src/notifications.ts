import { z } from 'zod';
export const NotificationChannelSchema = z.enum(['in_app', 'email', 'zalo']);
export const NotificationPurposeSchema = z.enum(['transactional', 'marketing']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;
export type NotificationPurpose = z.infer<typeof NotificationPurposeSchema>;
export const NotificationTemplateSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    channel: NotificationChannelSchema,
    purpose: NotificationPurposeSchema,
    title: z.string().trim().min(3).max(200),
    body: z.string().trim().min(10).max(3000),
    basis: z.string().trim().min(20).max(2000),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const NotificationReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'revoke']),
    accepted: z.literal(true),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();
export const NotificationQueueSchema = z
  .object({
    templateId: z.uuid(),
    applicationId: z.uuid(),
    reference: z.string().trim().max(300),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const NotificationPreferenceSchema = z
  .object({
    channel: NotificationChannelSchema,
    purpose: NotificationPurposeSchema,
    enabled: z.boolean(),
    accepted: z.literal(true),
  })
  .strict();
export const NotificationTransportSchema = z
  .object({
    channel: z.enum(['email', 'zalo']),
    enabled: z.boolean(),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/),
    maxAttempts: z.number().int().min(1).max(3),
    accepted: z.literal(true),
  })
  .strict();
export const NotificationAcceptedSchema = z.object({ accepted: z.literal(true) }).strict();
export interface NotificationTemplateView {
  id: string;
  projectId: string;
  name: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  title: string;
  body: string;
  basis: string;
  status: 'draft' | 'approved' | 'rejected' | 'revoked';
  createdBy: string;
  reviewedBy: string | null;
  version: number;
}
export interface NotificationMessageView {
  id: string;
  projectId: string;
  applicationCode: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  title: string;
  body: string;
  status: 'queued' | 'delivered' | 'failed' | 'cancelled' | 'outcome_unknown';
  version: number;
  attemptCount: number;
  createdAt: string;
  readAt: string | null;
  attempts: { number: number; outcome: string; at: string }[];
}
export interface NotificationPreferenceView {
  projectId: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  enabled: boolean;
  version: number;
}
export interface NotificationAdminWorkspace {
  templates: NotificationTemplateView[];
  messages: NotificationMessageView[];
  applications: { id: string; code: string }[];
  transports: {
    channel: 'email' | 'zalo';
    enabled: boolean;
    adapterId: string;
    maxAttempts: number;
    version: number;
  }[];
  externalEnabled: boolean;
  registeredAdapters: string[];
  notice: string;
}
export interface NotificationCitizenWorkspace {
  items: NotificationMessageView[];
  preferences: NotificationPreferenceView[];
  projects: { id: string; name: string }[];
  notice: string;
}
