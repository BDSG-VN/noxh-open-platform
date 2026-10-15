import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';
import { api, cookieOptions } from '@noxh/contracts/server';
export async function GET(request: NextRequest) {
  const origin = process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001';
  let result: NextResponse;
  try {
    const stored = (await cookies()).get('noxh_oidc')?.value;
    if (!stored) throw new Error();
    const { state, verifier } = JSON.parse(stored) as { state: string; verifier: string };
    const incoming = request.nextUrl.searchParams.get('state') ?? '';
    const code = request.nextUrl.searchParams.get('code');
    if (
      !code ||
      state.length !== incoming.length ||
      !timingSafeEqual(Buffer.from(state), Buffer.from(incoming))
    )
      throw new Error();
    const issuer = process.env.WORKFORCE_TOKEN_ISSUER ?? process.env.WORKFORCE_PUBLIC_ISSUER;
    if (!issuer) throw new Error();
    const response = await fetch(issuer + '/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.WORKFORCE_CLIENT_ID ?? 'noxh-investor',
        redirect_uri: origin + '/auth/callback',
        code,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error();
    const token = (await response.json()) as { access_token: string; expires_in: number };
    const allowed = await api('/api/v1/admin/me', token.access_token);
    if (!allowed.ok) throw new Error();
    result = NextResponse.redirect(origin);
    result.cookies.set('noxh_staff', token.access_token, {
      ...cookieOptions,
      maxAge: Math.min(token.expires_in, 1800),
    });
  } catch {
    result = NextResponse.redirect(origin + '/login?error=authentication');
  }
  result.cookies.delete('noxh_oidc');
  return result;
}
