export interface TemplateMetadata {
  id: string;
  version: string;
  status: 'sample' | 'draft' | 'approved' | 'revoked';
  sha256: string;
  effectiveFrom: string;
  effectiveTo?: string;
  approvedBy?: string;
}
export function assertRenderingAvailable(): never {
  throw new Error('FORM_RENDERING_NOT_IMPLEMENTED: Sprint 7 requires approved official templates');
}
