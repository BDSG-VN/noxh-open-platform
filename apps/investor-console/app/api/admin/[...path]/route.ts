import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const segments = (await context.params).path;
    const path = segments.join('/');
    const allowed =
      /^(dashboard|me|projects|rounds|settings\/zalo|logout|(?:projects|rounds)\/[a-f0-9-]{36})$/.test(
        path,
      );
    if (!allowed) throw new BffError(404, 'Đường dẫn không được hỗ trợ');
    const token = (await cookies()).get('noxh_staff')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập quản trị');
    let body: unknown;
    if (request.method !== 'GET') {
      assertOrigin(request, process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001');
      body = await jsonBody(request);
    }
    const response = await api(
      '/api/v1/admin/' + path,
      token,
      request.method,
      body,
      request.headers.get('if-match') ?? undefined,
    );
    const result = NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
    if (path === 'logout' && response.ok) result.cookies.delete('noxh_staff');
    return result;
  } catch (e) {
    const p = bffProblem(e);
    return NextResponse.json(p, { status: p.status });
  }
}
export const GET = handler,
  POST = handler,
  PUT = handler,
  DELETE = handler;
