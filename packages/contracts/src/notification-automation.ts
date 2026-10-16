import { z } from 'zod';
export const ApplicationNotificationEventSchema = z.enum([
  'application.supplement-requested',
  'application.approved',
  'application.rejected',
]);
export type ApplicationNotificationEvent = z.infer<typeof ApplicationNotificationEventSchema>;
export type NotificationAutomationEventType = ApplicationNotificationEvent;
export const NotificationAutomationPolicySchema = z
  .object({
    eventType: ApplicationNotificationEventSchema,
    templateId: z.uuid(),
    idempotencyKey: z.uuid(),
  })
  .strict();
export const NotificationAutomationReviewSchema = z
  .object({
    decision: z.enum(['approve', 'reject', 'revoke']),
    accepted: z.literal(true),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();
export type NotificationAutomationReason =
  | 'no_policy'
  | 'consent_unavailable'
  | 'preference_unavailable'
  | 'rule_unavailable'
  | 'template_unavailable'
  | 'application_stale'
  | 'recipient_unavailable'
  | 'processing_restricted'
  | 'attempts_exhausted'
  | 'idempotency_conflict'
  | 'processing_failed';
export interface NotificationAutomationPolicyView {
  id: string;
  eventType: ApplicationNotificationEvent;
  templateId: string;
  templateName: string;
  status: 'draft' | 'approved' | 'rejected' | 'revoked';
  version: number;
  createdBy: string;
  reviewedBy: string | null;
  note: string | null;
}
export interface NotificationAutomationEventView {
  id: string;
  eventType: ApplicationNotificationEvent;
  applicationCode: string;
  applicationVersion: number;
  status: 'pending' | 'processing' | 'delivered' | 'skipped' | 'failed';
  reason: NotificationAutomationReason | null;
  attemptCount: number;
  createdAt: string;
  processedAt: string | null;
  messageId: string | null;
}
export interface NotificationAutomationWorkspace {
  policies: NotificationAutomationPolicyView[];
  events: NotificationAutomationEventView[];
  stats: {
    pending: number;
    processing: number;
    delivered: number;
    skipped: number;
    failed: number;
  };
  enabled: boolean;
  notice: string;
}
