import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join('/');
    if (
      !/^(dossiers\/[a-f0-9-]{36}(?:\/(?:declarations|checklist|readiness|support|services|online-cases(?:\/[a-f0-9-]{36})?|assistant(?:\/[a-f0-9-]{36}\/confirm)?))?|citizen\/consultations(?:\/[a-f0-9-]{36})?|citizen\/requests\/[a-f0-9-]{36}\/close)$/.test(
        path,
      )
    )
      throw new BffError(404, 'Đường dẫn không được hỗ trợ');
    const token = (await cookies()).get('noxh_citizen')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập');
    let body: unknown;
    if (request.method !== 'GET') {
      assertOrigin(request, process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000');
      body = await jsonBody(request);
    }
    const response = await api(
      '/api/v1/' + path,
      token,
      request.method,
      body,
      request.headers.get('if-match') ?? undefined,
      path.endsWith('/assistant') ? 85000 : 12000,
    );
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const p = bffProblem(e);
    return NextResponse.json(p, { status: p.status });
  }
}
export const GET = handler,
  POST = handler,
  PATCH = handler,
  PUT = handler,
  DELETE = handler;
