import { z } from 'zod';
const token = z
  .string()
  .min(20)
  .max(4096)
  .refine(
    (value) =>
      !/\s/u.test(value) &&
      Array.from(value).every((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127),
  );
const proof = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const ZaloIdentitySettingsSchema = z
  .object({
    enabled: z.boolean(),
    appId: z.string().regex(/^[0-9]{1,30}$/),
    appSecret: z.string().min(20).max(512).optional(),
  })
  .strict();
export const ZaloExchangeSchema = z
  .object({
    challengeId: z.uuid(),
    challengeProof: proof,
    accessToken: token,
    accepted: z.literal(true),
  })
  .strict();
export const ZaloLinkStartSchema = z
  .object({ accessToken: token, accepted: z.literal(true) })
  .strict();
export type ZaloChallenge = { challengeId: string; challengeProof: string; expiresIn: number };
export type ZaloExchangeResult =
  | {
      sessionEstablished: true;
      sessionToken: string;
      expiresIn: number;
      legalIdentityVerified: false;
    }
  | { sessionEstablished: false; needsLink: true; legalIdentityVerified: false };
export interface ZaloIdentitySettings {
  enabled: boolean;
  appId: string;
  hasSecret: boolean;
  version: number;
  deploymentEnabled: boolean;
}
