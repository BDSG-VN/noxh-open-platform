import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import AdminWorkbench, {
  StaffLogout,
  type ProjectRow,
  type RoundRow,
  type SettingsRow,
} from './admin-workbench';
export const dynamic = 'force-dynamic';
export default async function Admin() {
  const token = (await cookies()).get('noxh_staff')?.value;
  if (!token) redirect('/login');
  try {
    const me = await api('/api/v1/admin/me', token);
    if (me.status === 401 || me.status === 403) redirect('/login');
    if (!me.ok)
      return (
        <main className="container section">
          <h1>Chưa kết nối quản trị</h1>
          <p>Kiểm tra Keycloak, cơ sở dữ liệu và cấu hình tổ chức.</p>
        </main>
      );
    const staff = (await me.json()) as { role: string; organizationId: string };
    const [d, p, r, s] = await Promise.all([
      api('/api/v1/admin/dashboard', token),
      api('/api/v1/admin/projects', token),
      api('/api/v1/admin/rounds', token),
      staff.role === 'org_admin'
        ? api('/api/v1/admin/settings/zalo', token)
        : Promise.resolve(undefined),
    ]);
    if (!d.ok || !p.ok || !r.ok || (s && !s.ok))
      return (
        <main className="container section">
          <h1>Chưa tải được dữ liệu</h1>
          <p>Hãy kiểm tra các migration và tải lại.</p>
        </main>
      );
    const counts = await d.json();
    const projects = (await p.json()).items as ProjectRow[];
    const rounds = (await r.json()).items as RoundRow[];
    const settings = s ? ((await s.json()) as SettingsRow) : undefined;
    return (
      <main className="container section">
        <header className="section-head">
          <a className="brand" href="/">
            NOXH Open Platform<small>BDSG Foundation · Quản trị chủ đầu tư</small>
          </a>
          <StaffLogout />
        </header>
        <h1 className="text-4xl!">Bảng điều khiển chủ đầu tư.</h1>
        <p>
          Phạm vi tổ chức: {staff.organizationId} · Vai trò: {staff.role}. Các tác vụ đều kiểm tra
          quyền tại backend.
        </p>
        <AdminWorkbench projects={projects} rounds={rounds} settings={settings} counts={counts} />
        <p className="text-sm mt-8">
          Đã có quản lý dự án, lịch tiếp nhận và cấu hình xác thực. Biểu mẫu pháp lý, nộp đơn chính
          thức, xét duyệt và bốc thăm chưa được bật.
        </p>
      </main>
    );
  } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
    return (
      <main className="container section">
        <h1>Máy chủ chưa sẵn sàng</h1>
        <p>Hãy kiểm tra cấu hình và thử lại.</p>
      </main>
    );
  }
}
