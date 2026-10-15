import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
async function handler(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const segments = (await context.params).path;
    const path = segments.join('/');
    const allowed = [
      /^(lotteries(?:\/(?:priority-calculation|eligibility-evidence|[a-f0-9-]{36}\/(?:review|freeze|entropy|execute|certify|publish|void)))?|privacy\/(?:notices(?:\/[a-f0-9-]{36}\/review)?|requests(?:\/[a-f0-9-]{36})?)|dashboard|me|projects|rounds|partners(?:\/[a-f0-9-]{36}(?:\/members(?:\/[a-f0-9-]{36})?)?)?|partner-campaigns(?:\/[a-f0-9-]{36}\/review)?|requests|audit(?:\/export)?|requests\/[a-f0-9-]{36}\/reply|settings\/(?:zalo|openai)|legal\/catalog|projects\/[a-f0-9-]{36}\/forms(?:\/[a-f0-9-]{36}\/review)?|logout|(?:projects|rounds)\/[a-f0-9-]{36})$/,
      /^projects\/[a-f0-9-]{36}\/form-mappings(?:\/[a-f0-9-]{36}\/(?:review|preview))?$/,
      /^operations\/(?:projects|employees(?:\/[a-f0-9-]{36})?|projects\/[a-f0-9-]{36}\/(?:workflow(?:\/(?:activate|tasks\/[a-z0-9-]+(?:\/review)?))?|records(?:\/[a-f0-9-]{36}\/review)?|journals(?:\/[a-f0-9-]{36}\/post)?))$/,
      /^inventory\/projects\/[a-f0-9-]{36}(?:\/(?:units|price-plans(?:\/[a-f0-9-]{36}\/review)?|sales(?:\/(?:review|activate|pause))?|queue(?:\/[a-f0-9-]{36}\/revoke)?))?$/,
      /^operations\/projects\/[a-f0-9-]{36}\/files(?:\/[a-f0-9-]{36}\/(?:scan|download))?$/,
      /^lotteries\/cohorts(?:\/[a-f0-9-]{36}\/(?:review|void))?$/,
      /^lotteries\/cohort-source\/[a-f0-9-]{36}\/(?:buy|rent-buy|rent)$/,
      /^applications(?:\/[a-f0-9-]{36}(?:\/(?:assign|supplement-request|recommend|decide|reopen|appeals\/[a-f0-9-]{36}\/respond|(?:documents|forms)\/[a-f0-9-]{36}\/download))?)?$/,
    ].some((r) => r.test(path));
    if (!allowed) throw new BffError(404, 'Đường dẫn không được hỗ trợ');
    const token = (await cookies()).get('noxh_staff')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập quản trị');
    let body: unknown;
    if (request.method !== 'GET') {
      assertOrigin(request, process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001');
      if (request.body)
        body = await jsonBody(
          request,
          /^operations\/projects\/[a-f0-9-]{36}\/files$/.test(path) ? 8 * 1024 * 1024 : 128 * 1024,
        );
    }
    const response = await api(
      '/api/v1/admin/' + path,
      token,
      request.method,
      body,
      request.headers.get('if-match') ?? undefined,
    );
    if (response.ok && (path === 'audit/export' || /\/(?:download|preview)$/.test(path))) {
      const mime = response.headers.get('content-type') ?? '';
      if (!/^(application\/(?:pdf|json)|image\/png|image\/jpeg)(?:;|$)/.test(mime))
        throw new BffError(502, 'Kiểu tệp không hợp lệ');
      const disposition = response.headers.get('content-disposition') ?? '';
      return new NextResponse(response.body, {
        status: response.status,
        headers: {
          'Content-Type': mime,
          'Content-Disposition': /^attachment; filename="[a-zA-Z0-9._-]+"$/.test(disposition)
            ? disposition
            : 'attachment; filename="evidence.pdf"',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
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
