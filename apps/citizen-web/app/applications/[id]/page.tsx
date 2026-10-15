import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import type { ApplicationDetail } from '@noxh/contracts';
import CustomerShell from '../../customer-shell';
import ApplicationClient from './application-client';
export const dynamic = 'force-dynamic';
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const token = (await cookies()).get('noxh_citizen')?.value;
  if (!token) redirect('/login');
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) notFound();
  let response: Response;
  try {
    response = await api('/api/v1/citizen/applications/' + id, token);
  } catch {
    return (
      <CustomerShell>
        <p role="alert">Chưa kết nối biên nhận. Hãy tải lại; hồ sơ đã gửi vẫn được lưu.</p>
      </CustomerShell>
    );
  }
  if (response.status === 401) redirect('/login');
  if (response.status === 404) notFound();
  if (!response.ok)
    return (
      <CustomerShell>
        <p role="alert">Chưa tải được hồ sơ tiếp nhận. Hãy thử lại sau.</p>
      </CustomerShell>
    );
  return (
    <CustomerShell>
      <ApplicationClient initial={(await response.json()) as ApplicationDetail} />
    </CustomerShell>
  );
}
