import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import { Brand, Icon } from '@noxh/ui';
import ConsultationForm from './request';
export const dynamic = 'force-dynamic';
export default async function Consultation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) notFound();
  let response: Response;
  try {
    response = await api('/api/v1/campaigns/' + id);
  } catch {
    return (
      <main className="page-container">
        <h1>Chưa tải được thông tin tư vấn</h1>
        <p>Vui lòng tải lại sau.</p>
      </main>
    );
  }
  if (response.status === 404) notFound();
  if (!response.ok)
    return (
      <main className="page-container">
        <p>Chiến dịch hiện chưa sẵn sàng.</p>
      </main>
    );
  const campaign = await response.json();
  const token = (await cookies()).get('noxh_citizen')?.value;
  const account = token ? await api('/api/v1/citizen/dashboard', token).catch(() => null) : null;
  const loggedIn = account?.ok === true;
  return (
    <div className="public-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <nav className="navigation" aria-label="Điều hướng">
            <a href="/dashboard">Bảng điều khiển khách hàng →</a>
          </nav>
        </div>
      </header>
      <main className="container consultation-page">
        <div className="consultation-layout">
          <section className="stack">
            <span className="kicker">TƯ VẤN DỰ ÁN / ĐỐI TÁC ĐƯỢC CHỦ ĐẦU TƯ DUYỆT</span>
            <h1>{campaign.headline}</h1>
            <p className="request-message">{campaign.description}</p>
            <div className="surface surface-body">
              <p>
                <strong>Dự án:</strong> {campaign.project_name}
              </p>
              <p>
                <strong>Đơn vị tiếp nhận tư vấn:</strong> {campaign.partner_name}
              </p>
              <a className="text-button" href={'/projects/' + campaign.project_id}>
                Xem thông tin dự án →
              </a>
            </div>
            <div className="help-note">
              <Icon name="shield" />
              <p>
                Đây là yêu cầu tư vấn, chưa phải nộp hồ sơ đăng ký NOXH. Đối tác không được mở hồ sơ
                riêng hoặc giấy tờ của bạn qua yêu cầu này. Việc xét điều kiện và kết quả thuộc cơ
                quan, người có thẩm quyền.
              </p>
            </div>
          </section>
          <section className="surface surface-body consultation-form">
            <ConsultationForm
              campaignId={id}
              partnerName={campaign.partner_name}
              loggedIn={loggedIn}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
