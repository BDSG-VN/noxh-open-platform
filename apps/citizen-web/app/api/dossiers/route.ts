import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { api, assertOrigin, jsonBody, bffProblem, BffError } from '@noxh/contracts/server';
export async function POST(request: NextRequest) {
  try {
    assertOrigin(request, process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000');
    const token = (await cookies()).get('noxh_citizen')?.value;
    if (!token) throw new BffError(401, 'Cần đăng nhập');
    const b = await jsonBody(request);
    const result = await api('/api/v1/citizen/dossiers', token, 'POST', { projectId: b.projectId });
    return NextResponse.json(await result.json(), { status: result.status });
  } catch (e) {
    const p = bffProblem(e);
    return NextResponse.json(p, { status: p.status });
  }
}
