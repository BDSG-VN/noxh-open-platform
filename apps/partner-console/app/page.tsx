import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import PartnerWorkbench from './workbench';
export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const token = (await cookies()).get('noxh_partner')?.value;
  if (!token) redirect('/login');
  const r = await api('/api/v1/partner/workspace', token).catch(() => null);
  if (r?.status === 401 || r?.status === 403) redirect('/login');
  if (!r?.ok)
    return (
      <main id="noi-dung" tabIndex={-1} className="page-container">
        <h1>Chưa tải được không gian đối tác</h1>
        <p>Máy chủ chưa phản hồi. Thử tải lại sau.</p>
      </main>
    );
  return (
    <PartnerWorkbench
      initial={await r.json()}
      initialTab={(await searchParams).tab ?? 'overview'}
      citizenUrl={process.env.CITIZEN_PUBLIC_ORIGIN ?? 'http://localhost:3000'}
    />
  );
}
