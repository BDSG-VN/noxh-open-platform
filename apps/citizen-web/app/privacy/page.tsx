import { cookies } from 'next/headers';
import { api } from '@noxh/contracts/server';
import { Brand } from '@noxh/ui';
import PrivacyCenter from './privacy-center';
export const dynamic = 'force-dynamic';
export default async function PrivacyPage() {
  const token = (await cookies()).get('noxh_citizen')?.value;
  try {
    const r = await api(token ? '/api/v1/citizen/privacy' : '/api/v1/privacy/notice', token);
    if (!r.ok) throw new Error();
    const data = await r.json();
    return (
      <main id="noi-dung" tabIndex={-1} className="container section">
        <Brand />
        <p>
          <a href={token ? '/dashboard' : '/login'}>← {token ? 'Bảng điều khiển' : 'Đăng nhập'}</a>
        </p>
        <PrivacyCenter
          initial={{ accepted: false, restricted: false, requests: [], ...data }}
          authenticated={Boolean(token)}
        />
      </main>
    );
  } catch {
    return (
      <main id="noi-dung" tabIndex={-1} className="container section">
        <h1>Quyền riêng tư</h1>
        <p role="alert">
          Chưa tải được thông báo. Hãy thử tải lại; không gửi thêm giấy tờ khi chưa đọc được điều
          khoản.
        </p>
        <a href="/dashboard">Về tài khoản</a>
      </main>
    );
  }
}
