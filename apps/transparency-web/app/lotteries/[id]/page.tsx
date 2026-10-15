import { notFound } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import LotteryRoom from './room';
export const dynamic = 'force-dynamic';
export default async function Room({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) notFound();
  const r = await api('/api/v1/lotteries/' + id);
  if (r.status === 404) notFound();
  if (!r.ok)
    return (
      <main className="container section">
        <p role="alert">Chưa tải được phòng bốc thăm.</p>
      </main>
    );
  return <LotteryRoom initial={await r.json()} />;
}
