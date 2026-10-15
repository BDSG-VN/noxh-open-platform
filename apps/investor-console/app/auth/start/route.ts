import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'node:crypto';
import { cookieOptions } from '@noxh/contracts/server';
export async function GET() {
  const issuer = process.env.WORKFORCE_PUBLIC_ISSUER;
  if (!issuer)
    return NextResponse.json({ detail: 'Chưa cấu hình Keycloak cho chủ đầu tư' }, { status: 503 });
  const state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(32).toString('base64url');
  const url = new URL(issuer + '/protocol/openid-connect/auth');
  url.search = new URLSearchParams({
    client_id: process.env.WORKFORCE_CLIENT_ID ?? 'noxh-investor',
    response_type: 'code',
    scope: 'openid',
    redirect_uri:
      (process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001') + '/auth/callback',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'login',
  }).toString();
  const result = NextResponse.redirect(url);
  result.cookies.set('noxh_oidc', JSON.stringify({ state, verifier }), {
    ...cookieOptions,
    sameSite: 'lax',
    maxAge: 300,
  });
  return result;
}
