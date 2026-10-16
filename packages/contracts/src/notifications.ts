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
/** Provider credentials are entered by an organization administrator and stored encrypted server-side. */
const hostname =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const email =
  /^[^\s@<>,;"'\\()[\]]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const parameter = /^[a-z_][a-z0-9_]{0,40}$/;
export const NotificationEmailProviderSchema = z
  .object({
    channel: z.literal('email'),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/),
    host: z.string().regex(hostname),
    port: z.number().int().min(1).max(65535),
    security: z.enum(['starttls', 'tls']),
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(500),
    from: z.string().regex(email),
    /** Synthetic drill mailbox: this release has no verified customer e-mail address source. */
    sinkAddress: z.string().regex(email),
    ratePerMinute: z.number().int().min(1).max(600),
    accepted: z.literal(true),
  })
  .strict();
export const NotificationZaloProviderSchema = z
  .object({
    channel: z.literal('zalo'),
    adapterId: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/),
    accessToken: z.string().min(1).max(2000),
    appSecret: z.string().min(1).max(500),
    templateId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    titleParameter: z.string().regex(parameter),
    bodyParameter: z.string().regex(parameter),
    /** Optional synthetic drill number; otherwise the customer's OTP-verified phone is used. */
    sinkPhone: z
      .string()
      .regex(/^84[35789][0-9]{8}$/)
      .optional(),
    ratePerMinute: z.number().int().min(1).max(600),
    accepted: z.literal(true),
  })
  .strict();
export const NotificationProviderSchema = z.discriminatedUnion('channel', [
  NotificationEmailProviderSchema,
  NotificationZaloProviderSchema,
]);
export type NotificationEmailProvider = z.infer<typeof NotificationEmailProviderSchema>;
export type NotificationZaloProvider = z.infer<typeof NotificationZaloProviderSchema>;
export type NotificationDeliveryStatus =
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'dead_letter'
  | 'outcome_unknown'
  | 'cancelled';
export type NotificationDeliveryReason =
  | 'provider_rejected'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'circuit_open'
  | 'timeout'
  | 'attempts_exhausted'
  | 'consent_unavailable'
  | 'transport_disabled'
  | 'recipient_unavailable'
  | 'processing_failed'
  | 'requeued';
/** Never carries addresses, message content, receipts or provider secrets. */
export interface NotificationProviderView {
  channel: 'email' | 'zalo';
  adapterId: string;
  ratePerMinute: number;
  configuredBy: string;
  hasSecret: true;
  version: number;
  summary: { host?: string; port?: number; security?: string; templateId?: string };
}
export interface NotificationDeliveryView {
  messageId: string;
  projectId: string;
  channel: 'email' | 'zalo';
  status: NotificationDeliveryStatus;
  reason: NotificationDeliveryReason | null;
  attemptCount: number;
  attemptBudget: number;
  requeueCount: number;
  nextAttemptAt: string | null;
  messageStatus: NotificationMessageView['status'];
  messageVersion: number;
  version: number;
  updatedAt: string;
}
export interface NotificationDeliveryWorkspace {
  items: NotificationDeliveryView[];
  deadLetters: number;
  channels: {
    channel: 'email' | 'zalo';
    failureStreak: number;
    circuitOpenUntil: string | null;
    tokens: number;
  }[];
  notice: string;
}
