import { z } from 'zod';
export const PartnerRoleSchema = z.enum(['partner_admin', 'campaign_manager', 'consultant']);
export type PartnerRole = z.infer<typeof PartnerRoleSchema>;
export const PartnerCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    ownerName: z.string().trim().min(1).max(200),
    ownerPhone: z.string().min(8).max(24),
    projectIds: z.array(z.uuid()).min(1).max(100),
  })
  .strict();
export const PartnerUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(200),
    status: z.enum(['active', 'suspended']),
    projectIds: z.array(z.uuid()).max(100),
  })
  .strict();
export const PartnerMemberSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().min(8).max(24),
    role: PartnerRoleSchema,
  })
  .strict();
export const PartnerMemberUpdateSchema = z
  .object({ role: PartnerRoleSchema, status: z.enum(['active', 'suspended']) })
  .strict();
export const CampaignSchema = z
  .object({
    projectId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    channel: z.enum(['facebook', 'zalo', 'web', 'other']),
    headline: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(4000),
  })
  .strict();
export const CampaignReviewSchema = z
  .object({ status: z.enum(['approved', 'rejected', 'paused']), note: z.string().trim().max(1000) })
  .strict();
export const ConsultationSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    message: z.string().trim().min(1).max(2000),
    accepted: z.literal(true),
  })
  .strict();
export const LeadUpdateSchema = z
  .object({
    status: z.enum(['contacting', 'waiting', 'closed']),
    note: z.string().trim().max(2000),
  })
  .strict();
export interface PartnerActor {
  organizationId: string;
  userId: string;
  partnerId: string;
  memberId: string;
  role: PartnerRole;
  partnerName: string;
  name: string;
}
export interface PartnerRow {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  version: number;
  project_ids: string[];
  members: number;
  campaigns: number;
  leads: number;
}
export interface PartnerMember {
  id: string;
  name: string;
  phoneMasked: string;
  role: PartnerRole;
  status: 'active' | 'suspended';
  version: number;
}
export interface CampaignRow {
  id: string;
  partner_id: string;
  partner_name: string;
  project_id: string;
  project_name: string;
  name: string;
  channel: string;
  headline: string;
  description: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'paused';
  review_note: string;
  version: number;
  leads: number;
  created_at: string;
}
export interface ConsultationLead {
  id: string;
  campaign_id: string;
  campaign_name: string;
  project_name: string;
  assignee_id: string | null;
  status: 'new' | 'contacting' | 'waiting' | 'closed' | 'withdrawn';
  version: number;
  created_at: string;
  fullName: string;
  phone: string;
  message: string;
  note: string;
}
