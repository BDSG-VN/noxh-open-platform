import type { ChannelAuthProvider } from '@noxh/contracts';
// This detection only selects presentation. It is never authentication proof.
export const isZaloEnvironment = (userAgent: string) => /Zalo/i.test(userAgent);
export class ZaloChannel implements ChannelAuthProvider {
  readonly provider = 'zalo' as const;
  async exchange(_accessToken: string): Promise<{ sessionEstablished: boolean }> {
    throw new Error('ZALO_SERVER_VERIFICATION_NOT_IMPLEMENTED');
  }
}
export async function requestZaloToken() {
  const { getAccessToken } = await import('zmp-sdk');
  return getAccessToken();
}
