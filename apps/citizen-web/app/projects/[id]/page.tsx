import { notFound } from 'next/navigation';
import { loadProjects } from '../../projects-data';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@noxh/ui';
export const dynamic = 'force-dynamic';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items, error } = await loadProjects();
  if (error)
    return (
      <main className="container section">
        <a href="/">← Danh mục mẫu</a>
        <div className="error">{error}</div>
      </main>
    );
  const p = items.find((x) => x.id === id);
  if (!p) notFound();
  return (
    <main className="container section">
      <a href="/">← Danh mục mẫu</a>
      <p className="eyebrow">Dữ liệu giả lập · Không phải dự án đang chào bán</p>
      <h1>{p.name}</h1>
      <p>{p.locality}</p>
      <Card>
        <CardHeader>
          <CardTitle>Hồ sơ chuẩn bị</CardTitle>
        </CardHeader>
        <CardContent>
          <p>
            Luồng khai báo, giấy tờ và tiếp nhận sẽ được phát triển sau nền phân quyền và đồng ý xử
            lý dữ liệu.
          </p>
          <Button disabled>Chưa mở tiếp nhận hồ sơ</Button>
        </CardContent>
      </Card>
    </main>
  );
}
