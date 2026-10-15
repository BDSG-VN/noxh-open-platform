import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import { Card, CardHeader, CardTitle, CardContent } from '@noxh/ui';
import { Logout, StartDossier } from './actions';
import { loadProjects } from '../projects-data';
export const dynamic = 'force-dynamic';
export default async function Dashboard() {
  const token = (await cookies()).get('noxh_citizen')?.value;
  if (!token) redirect('/login');
  let response: Response;
  try {
    response = await api('/api/v1/citizen/dashboard', token);
  } catch {
    return (
      <main className="container section">
        <h1>Không kết nối được tài khoản</h1>
        <p>Hãy tải lại sau. Không có dữ liệu mẫu thay cho hồ sơ của bạn.</p>
      </main>
    );
  }
  if (response.status === 401) redirect('/login');
  if (!response.ok)
    return (
      <main className="container section">
        <p>Chưa tải được dữ liệu tài khoản.</p>
      </main>
    );
  const value = (await response.json()) as {
    phoneMasked: string;
    dossiers: { id: string; project_name: string; status: string }[];
  };
  const { items } = await loadProjects();
  return (
    <main className="container section">
      <div className="section-head">
        <a className="brand" href="/">
          NOXH Open Platform<small>Bảng điều khiển khách hàng</small>
        </a>
        <Logout />
      </div>
      <h1 className="text-4xl!">Hành trình của bạn.</h1>
      <p>Số điện thoại đã xác thực: {value.phoneMasked}. Hồ sơ pháp lý chưa được xác minh.</p>
      <div className="grid-two">
        <Card>
          <CardHeader>
            <CardTitle>Hồ sơ chuẩn bị của tôi</CardTitle>
          </CardHeader>
          <CardContent>
            {value.dossiers.length === 0 ? (
              <p>Bạn chưa có hồ sơ chuẩn bị.</p>
            ) : (
              value.dossiers.map((d) => (
                <div className="step" key={d.id}>
                  <div>
                    <strong>{d.project_name}</strong>
                    <p>Bản nháp chuẩn bị · Chưa nộp chính thức</p>
                    <small>Mã hồ sơ: {d.id}</small>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <StartDossier projects={items} />
      </div>
      <p className="text-sm mt-6">
        Chỉ hồ sơ thuộc tài khoản này được hiển thị. Chưa có chức năng xét duyệt hoặc bốc thăm.
      </p>
    </main>
  );
}
