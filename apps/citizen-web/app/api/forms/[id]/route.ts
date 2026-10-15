import { NextResponse } from 'next/server';
import { api } from '@noxh/contracts/server';
export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-z0-9-]{1,100}$/.test(id)) return new NextResponse('Không có mẫu', { status: 404 });
  try {
    const r = await api('/api/v1/legal/forms/' + id);
    if (!r.ok)
      return NextResponse.json({ detail: 'Không tải được mẫu nguồn' }, { status: r.status });
    return new NextResponse(await r.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + id + '.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return NextResponse.json({ detail: 'Không kết nối được kho mẫu' }, { status: 503 });
  }
}
