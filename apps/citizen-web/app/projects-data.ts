import { ProjectSchema, type Project } from '@noxh/contracts';
export async function loadProjects(): Promise<{ items: Project[]; error?: string }> {
  try {
    const res = await fetch(
      `${process.env.INTERNAL_API_URL ?? 'http://127.0.0.1:4000'}/api/v1/projects`,
      { cache: 'no-store', signal: AbortSignal.timeout(3000) },
    );
    if (!res.ok) throw new Error('API unavailable');
    const body = (await res.json()) as { items: unknown[] };
    return { items: body.items.map((p) => ProjectSchema.parse(p)) };
  } catch {
    return {
      items: [],
      error: 'Chưa kết nối được danh mục mẫu. Kiểm tra API và cấu hình dữ liệu giả lập.',
    };
  }
}
