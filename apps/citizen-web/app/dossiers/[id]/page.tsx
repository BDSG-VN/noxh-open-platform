import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import type { DossierDetail } from '@noxh/contracts';
import { PageHeading } from '@noxh/ui';
import CustomerShell from '../../customer-shell';
import DossierWorkbench from './workbench';
export const dynamic = 'force-dynamic';
export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const token = (await cookies()).get('noxh_citizen')?.value;
  if (!token) redirect('/login');
  const { id } = await params;
  // Deep link to a workbench step (e.g. ?tab=documents); unknown values fall back to the first step.
  const { tab } = await searchParams;
  if (!/^[a-f0-9-]{36}$/.test(id)) notFound();
  let response: Response;
  try {
    response = await api('/api/v1/dossiers/' + id, token);
  } catch {
    return (
      <CustomerShell dossier>
        <p role="alert">Chưa kết nối hồ sơ. Hãy thử tải lại.</p>
      </CustomerShell>
    );
  }
  if (response.status === 401) redirect('/login');
  if (response.status === 404) notFound();
  if (!response.ok)
    return (
      <CustomerShell dossier>
        <p role="alert">Chưa tải được hồ sơ. Không có thay đổi nào được lưu.</p>
      </CustomerShell>
    );
  const d = (await response.json()) as DossierDetail;
  return (
    <CustomerShell dossier>
      <a className="auth-back" href="/dashboard">
        ← Hồ sơ của tôi
      </a>
      <PageHeading
        eyebrow={'HS-' + d.id.slice(-8).toUpperCase()}
        title={d.project_name}
        description={d.locality + ' · Hồ sơ chuẩn bị riêng tư'}
        action={<span className="status-badge amber">Chưa nộp chính thức</span>}
      />
      <DossierWorkbench initial={d} initialTab={typeof tab === 'string' ? tab : undefined} />
    </CustomerShell>
  );
}
