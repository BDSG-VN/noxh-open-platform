import { z } from 'zod';

export const KnowledgeDraftSchema = z
  .object({
    recordId: z.uuid().optional(),
    title: z.string().trim().min(3).max(200),
    content: z.string().trim().min(30).max(24000),
    sourceUrl: z
      .url()
      .max(2048)
      .refine((s) => {
        const u = new URL(s);
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.password &&
          !u.port &&
          (u.hostname.endsWith('.gov.vn') ||
            u.hostname === 'gov.vn' ||
            u.hostname === 'chinhphu.vn' ||
            u.hostname.endsWith('.chinhphu.vn') ||
            u.hostname === 'vbpl.vn' ||
            u.hostname.endsWith('.vbpl.vn'))
        );
      }, 'Cần đường dẫn HTTPS đến nguồn cơ quan nhà nước'),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    legalBasis: z.string().trim().min(3).max(500),
    mode: z.enum(['all', 'buy', 'rent-buy', 'rent']),
    group: z.number().int().min(1).max(13).nullable(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().nullable(),
    reviewedSource: z.literal(true),
  })
  .strict()
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom);
export type KnowledgeDraft = z.infer<typeof KnowledgeDraftSchema>;
export const KnowledgeSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    mode: z.enum(['buy', 'rent-buy', 'rent']).nullable().default(null),
    group: z.number().int().min(1).max(13).nullable().default(null),
  })
  .strict();
export interface KnowledgeCitation {
  id: string;
  recordId: string;
  revisionId: string;
  revision: number;
  title: string;
  sourceUrl: string;
  sourceHash: string;
  contentHash: string;
  legalBasis: string;
  excerpt: string;
  chunk: number;
  mode: string;
  group: number | null;
}
