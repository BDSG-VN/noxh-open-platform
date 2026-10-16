import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  api,
  assertOrigin,
  jsonBody,
  cookieOptions,
  bffProblem,
  BffError,
} from '@noxh/contracts/server';
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    assertOrigin(request, process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000');
    const { action } = await params;
    const jar = await cookies();
    const b = await jsonBody(request);
    if (action === 'request') {
      const response = await api('/api/v1/auth/phone/request', undefined, 'POST', {
        phone: b.phone,
        accepted: b.accepted,
      });
      const value = await response.json();
      if (!response.ok) return NextResponse.json(value, { status: response.status });
      const result = NextResponse.json({
        challengeId: value.challengeId,
        expiresIn: value.expiresIn,
        retryAfter: value.retryAfter,
        ...(value.demoCode ? { demoCode: value.demoCode } : {}),
      });
      result.cookies.set('noxh_challenge', value.challengeId + '.' + value.challengeProof, {
        ...cookieOptions,
        maxAge: 300,
      });
      return result;
    }
    if (action === 'verify') {
      const [id, proof] = (jar.get('noxh_challenge')?.value ?? '').split('.');
      if (!id || !proof) throw new BffError(401, 'Yêu cầu mã lại trên trình duyệt này');
      const response = await api('/api/v1/auth/phone/verify', undefined, 'POST', {
        challengeId: id,
        challengeProof: proof,
        code: b.code,
      });
      const value = await response.json();
      if (!response.ok) return NextResponse.json(value, { status: response.status });
      const result = NextResponse.json({ authenticated: true });
      result.cookies.set('noxh_citizen', value.sessionToken, {
        ...cookieOptions,
        maxAge: value.expiresIn,
      });
      result.cookies.delete('noxh_challenge');
      return result;
    }
    if (action === 'logout') {
      const response = await api('/api/v1/auth/logout', jar.get('noxh_citizen')?.value, 'POST', {});
      if (!response.ok && response.status !== 401)
        return NextResponse.json(
          { detail: 'Chưa thu hồi được phiên, hãy thử lại' },
          { status: 503 },
        );
      const result = NextResponse.json({ loggedOut: true });
      result.cookies.delete('noxh_citizen');
      result.cookies.delete('noxh_challenge');
      return result;
    }
    throw new BffError(404, 'Không có thao tác này');
  } catch (e) {
    const p = bffProblem(e);
    return NextResponse.json(p, { status: p.status });
  }
}
