import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import AdminWorkbench, {
  type ProjectRow,
  type RoundRow,
  type SettingsRow,
} from './admin-workbench';
import StaffWorkspace from './staff-workspace';
import type { OperationsStaff } from './operations-admin';
export const dynamic = 'force-dynamic';
export default async function Admin({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
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
    const staff = (await me.json()) as OperationsStaff;
    if (staff.role !== 'org_admin') return <StaffWorkspace staff={staff} />;
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
      <AdminWorkbench
        staff={staff}
        projects={projects}
        rounds={rounds}
        settings={settings}
        counts={counts}
        initialTab={tab}
        citizenOrigin={process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000'}
        transparencyOrigin={process.env.TRANSPARENCY_PUBLIC_ORIGIN ?? 'http://localhost:3002'}
      />
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
