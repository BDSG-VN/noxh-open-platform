import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const path = (await context.params).path.join('/');
    const routes = [
      /^dossiers\/[a-f0-9-]{36}(?:\/(?:declarations|checklist|readiness|support|services|submission|applications|online-cases(?:\/[a-f0-9-]{36})?|assistant(?:\/[a-f0-9-]{36}\/confirm)?|documents(?:\/[a-f0-9-]{36}(?:\/(?:scan|extract|download))?)?|extractions\/[a-f0-9-]{36}\/accept|form-workspace|form-packet|generated-forms(?:\/[a-f0-9-]{36}(?:\/(?:confirm|download))?)?))?$/,
      /^citizen\/privacy(?:\/(?:consent|withdraw|restriction|requests))?$/,
      /^citizen\/(?:consultations(?:\/[a-f0-9-]{36})?|requests\/[a-f0-9-]{36}\/close|inventory\/[a-f0-9-]{36}(?:\/allocate)?|applications(?:\/[a-f0-9-]{36}(?:\/(?:supplements|appeals))?)?)$/,
    ];
    if (!routes.some((r) => r.test(path))) throw new BffError(404, 'Đường dẫn không được hỗ trợ');
    const token = (await cookies()).get('noxh_citizen')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập');
    let body: unknown;
    if (request.method !== 'GET') {
      assertOrigin(request, process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000');
      if (request.body)
        body = await jsonBody(
          request,
          /^dossiers\/[a-f0-9-]{36}\/documents$/.test(path) ? 8 * 1024 * 1024 : 32768,
        );
    }
    const response = await api(
      '/api/v1/' + path,
      token,
      request.method,
      body,
      request.headers.get('if-match') ?? undefined,
      /\/(?:assistant|extract)$/.test(path) ? 85000 : 45000,
      request.headers.get('idempotency-key') ?? undefined,
    );
    if (response.ok && (path.endsWith('/download') || path.endsWith('/form-packet'))) {
      const mime = response.headers.get('content-type') ?? '';
      if (!/^(application\/(?:pdf|zip)|image\/png|image\/jpeg)(?:;|$)/.test(mime))
        throw new BffError(502, 'Kiểu tệp không hợp lệ');
      const disposition = response.headers.get('content-disposition') ?? '';
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': mime,
          'Content-Disposition': /^attachment; filename="[a-zA-Z0-9._-]+"$/.test(disposition)
            ? disposition
            : 'attachment; filename="document.pdf"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
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
