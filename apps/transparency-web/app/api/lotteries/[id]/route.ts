import { NextResponse } from 'next/server';
import { api } from '@noxh/contracts/server';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id))
    return NextResponse.json({ detail: 'Không có phiên' }, { status: 404 });
  try {
    const r = await api('/api/v1/lotteries/' + id);
    return NextResponse.json(await r.json(), {
      status: r.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ detail: 'Chưa kết nối được máy chủ' }, { status: 503 });
  }
}
