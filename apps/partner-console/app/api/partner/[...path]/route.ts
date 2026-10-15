import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join('/');
    if (
      !/^(workspace|members(?:\/[a-f0-9-]{36})?|campaigns(?:\/[a-f0-9-]{36}(?:\/submit)?)?|leads(?:\/[a-f0-9-]{36}(?:\/assign)?)?)$/.test(
        path,
      )
    )
      throw new BffError(404, 'Không có thao tác này');
    const token = (await cookies()).get('noxh_partner')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập đối tác');
    let body: unknown;
    if (request.method !== 'GET') {
      assertOrigin(request, process.env.PARTNER_PUBLIC_ORIGIN ?? 'http://localhost:3004');
      body = await jsonBody(request);
    }
    const r = await api(
      '/api/v1/partner/' + path,
      token,
      request.method,
      body,
      request.headers.get('if-match') ?? undefined,
    );
    return NextResponse.json(await r.json(), {
      status: r.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const p = bffProblem(e);
    return NextResponse.json(p, { status: p.status });
  }
}
export const GET = handler,
  POST = handler,
  PUT = handler;
