import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from '@noxh/contracts/server';
import { Icon, PageHeading, EmptyState, Button } from '@noxh/ui';
import CustomerShell from '../customer-shell';
import Applications from './applications';
import { StartDossier } from './actions';
import Consultations from './consultations';
import { loadProjects } from '../projects-data';
import TenancyCustomer from '../tenancy-customer';
import NotificationsCustomer from '../notifications-customer';
export const dynamic = 'force-dynamic';
export default async function Dashboard() {
  const token = (await cookies()).get('noxh_citizen')?.value;
  if (!token) redirect('/login');
  let response: Response;
  try {
    response = await api('/api/v1/citizen/dashboard', token);
  } catch {
    return (
      <CustomerShell>
        <EmptyState
          title="Chưa kết nối tài khoản"
          description="Hãy tải lại sau để xem hồ sơ của bạn."
        />
      </CustomerShell>
    );
  }
  if (response.status === 401) redirect('/login');
  if (!response.ok)
    return (
      <CustomerShell>
        <p role="alert">Chưa tải được dữ liệu tài khoản.</p>
      </CustomerShell>
    );
  const value = (await response.json()) as {
    phoneMasked: string;
    dossiers: { id: string; project_name: string; version: number }[];
  };
  const { items } = await loadProjects();
  return (
    <CustomerShell>
      <PageHeading
        eyebrow="Hành trình an cư"
        title="Chào mừng bạn trở lại"
        description={`Tài khoản ${value.phoneMasked} · Tiếp tục chuẩn bị thông tin cho mái nhà tương lai.`}
      />
      <div className="welcome-banner">
        <div>
          <span className="kicker" style={{ color: '#77d9bb' }}>
            TỪNG BƯỚC RÕ RÀNG
          </span>
          <h2>Bắt đầu từ một hồ sơ đầy đủ.</h2>
          <p>
            Khai báo thông tin, bổ sung thành viên và xem việc cần làm tiếp theo. Bạn có thể lưu bản
            nháp và quay lại bất cứ lúc nào.
          </p>
        </div>
        <span className="banner-icon">
          <Icon name="home" size={38} />
        </span>
      </div>
      <div className="metric-grid">
        {[
          ['Hồ sơ đang chuẩn bị', value.dossiers.length, 'folder'],
          ['Thông tin đã xác thực', 'Điện thoại', 'shield'],
          ['Dự án đã công bố', items.length, 'building'],
          ['Giai đoạn hiện tại', 'Chuẩn bị', 'clock'],
        ].map(([label, count, icon]) => (
          <div className="metric" key={label}>
            <Icon name={String(icon)} />
            <span>{label}</span>
            <strong style={typeof count === 'string' ? { fontSize: 22 } : undefined}>
              {count}
            </strong>
            <small>
              {label === 'Thông tin đã xác thực'
                ? 'Chưa xác minh danh tính pháp lý'
                : 'Theo dữ liệu tài khoản của bạn'}
            </small>
          </div>
        ))}
      </div>
      <Consultations />
      <TenancyCustomer />
      <NotificationsCustomer />
      <div className="content-columns">
        <div className="stack">
          <section id="ho-so" className="surface">
            <div className="surface-head">
              <div>
                <h2 className="section-title">Hồ sơ của tôi</h2>
                <p className="section-subtitle">Lưu riêng tư theo từng tài khoản và dự án</p>
              </div>
              <span className="status-badge blue">{value.dossiers.length} hồ sơ</span>
            </div>
            {!value.dossiers.length ? (
              <EmptyState
                title="Bắt đầu hành trình của bạn"
                description="Chọn một dự án để mở hồ sơ chuẩn bị. Bạn có thể khai báo theo từng bước."
              />
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Dự án / hồ sơ</th>
                      <th>Giai đoạn</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.dossiers.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div className="table-project">
                            <span className="table-icon">
                              <Icon name="folder" />
                            </span>
                            <div>
                              <strong>{d.project_name}</strong>
                              <small>
                                HS-{d.id.slice(-8).toUpperCase()} · Phiên bản {d.version}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="status-badge amber">Đang chuẩn bị</span>
                        </td>
                        <td>
                          <a className="text-link" href={'/dossiers/' + d.id}>
                            Tiếp tục <Icon name="arrow" size={15} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div className="help-note">
            <Icon name="shield" />
            <p>
              Hồ sơ chuẩn bị là bản nháp riêng tư. Nộp đơn chính thức và xét duyệt là các bước riêng
              sau khi quy trình và biểu mẫu được phê duyệt.
            </p>
          </div>
        </div>
        <div className="stack">
          <section className="surface">
            <div className="surface-head">
              <h2 className="section-title">Tạo hồ sơ mới</h2>
              <Icon name="plus" />
            </div>
            <StartDossier projects={items} />
            <Applications />
          </section>
          <section className="surface">
            <div className="surface-body">
              <span className="kicker">3 BƯỚC BẮT ĐẦU</span>
              {[
                ['01', 'Chọn dự án', 'Mỗi dự án có một hồ sơ chuẩn bị.'],
                ['02', 'Khai báo thông tin', 'Lưu thông tin cá nhân và hộ gia đình.'],
                ['03', 'Kiểm tra việc cần làm', 'Xem checklist và yêu cầu hỗ trợ.'],
              ].map(([n, t, s]) => (
                <div className="timeline-row" key={n}>
                  <span className="step-circle">{n}</span>
                  <div>
                    <strong>{t}</strong>
                    <small>{s}</small>
                  </div>
                </div>
              ))}
              <Button variant="outline" asChild className="mt-5 w-full">
                <a href="/#du-an">Khám phá dự án</a>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </CustomerShell>
  );
}
