import { z } from 'zod';
export * from './dossier';
export * from './assistance';
export * from './partner';
export * from './privacy';
export * from './lottery';
export * from './government';
export * from './applications';
export * from './operations';
export * from './inventory';
export * from './documents';
export * from './tenancy';
export * from './knowledge';
export * from './notifications';
export * from './channel-identity';
export const ProjectSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  name: z.string(),
  locality: z.string(),
  phase: z.enum(['preparation', 'intake']),
  synthetic: z.boolean(),
});
export type Project = z.infer<typeof ProjectSchema>;
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}
export interface ChannelAuthProvider {
  readonly provider: 'web' | 'zalo';
  exchange(accessToken: string): Promise<{ sessionEstablished: boolean }>;
}
export interface ChannelNotificationProvider {
  send(templateId: string, recipientRef: string): Promise<{ deliveryRef: string }>;
}
export interface ChannelDeepLinkProvider {
  projectLink(projectId: string): string;
}
export interface ChannelFilePicker {
  pick(): Promise<{ name: string; mime: string; bytes: Uint8Array }>;
}
export const demoProjects: Project[] = [
  {
    id: '20000000-0000-4000-8000-000000000001',
    organizationId: '10000000-0000-4000-8000-000000000001',
    name: 'Khu nhà ở mẫu An Bình',
    locality: 'Địa bàn giả lập A',
    phase: 'preparation',
    synthetic: true,
  },
  {
    id: '20000000-0000-4000-8000-000000000002',
    organizationId: '10000000-0000-4000-8000-000000000001',
    name: 'Khu nhà ở mẫu Hòa Phú',
    locality: 'Địa bàn giả lập B',
    phase: 'intake',
    synthetic: true,
  },
];

export type { paths, operations } from './generated';
export * from './documents';
