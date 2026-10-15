import { notFound } from 'next/navigation';
import { loadProjects } from '../../projects-data';
import { api } from '@noxh/contracts/server';
import { Brand, PageHeading, Icon, Button } from '@noxh/ui';
import ArchitectureArt from '../../architecture-art';
export const dynamic = 'force-dynamic';
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items, error } = await loadProjects();
  if (error)
    return (
      <main className="container section">
        <a href="/">← Danh mục dự án</a>
        <div className="error">{error}</div>
      </main>
    );
  const p = items.find((x) => x.id === id);
  if (!p) notFound();
  let rounds:
    | { id: string; name: string; status: string; opens_at: string; closes_at: string }[]
    | undefined;
  try {
    const r = await api('/api/v1/projects/' + id + '/rounds');
    if (r.ok) rounds = (await r.json()).items;
  } catch {
    /* show availability explicitly */
  }
  const format = (s: string) =>
    new Date(s).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  return (
    <div className="public-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <Button asChild variant="outline">
            <a href="/dashboard">Tài khoản của tôi</a>
          </Button>
        </div>
      </header>
      <main className="container section">
        <a className="auth-back" href="/#du-an">
          ← Tất cả dự án
        </a>
        <PageHeading
          eyebrow="THÔNG TIN ĐÃ CÔNG BỐ"
          title={p.name}
          description={p.locality}
          action={
            p.synthetic ? <span className="status-badge amber">Dữ liệu giả lập</span> : undefined
          }
        />
        <div className="content-columns">
          <div className="stack">
            <div className="architectural-art">
              <ArchitectureArt />
              <small>Minh họa kiến trúc · Không phải ảnh dự án</small>
            </div>
            <section className="surface">
              <div className="surface-head">
                <h2 className="section-title">Lịch tiếp nhận đã công bố</h2>
                <Icon name="calendar" />
              </div>
              <div className="surface-body">
                {rounds === undefined ? (
                  <p>Chưa kết nối được lịch tiếp nhận. Hãy tải lại sau.</p>
                ) : rounds.length ? (
                  rounds.map((r) => (
                    <div className="timeline-row" key={r.id}>
                      <Icon name="calendar" />
                      <div>
                        <strong>{r.name}</strong>
                        <small>
                          {format(r.opens_at)} — {format(r.closes_at)} ·{' '}
                          {r.status === 'closed' ? 'Đã đóng lịch' : 'Lịch công bố'}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <p>Chủ đầu tư chưa công bố lịch tiếp nhận cho dự án này.</p>
                )}
                <div className="help-note amber">
                  <Icon name="clock" />
                  <p>
                    Đợt tiếp nhận phải đang mở và thuộc dự án của hồ sơ. Bản phát triển hiện chỉ
                    tiếp nhận diễn tập; hồ sơ thật cần được chủ đầu tư mở sau nghiệm thu.
                  </p>
                </div>
              </div>
            </section>
          </div>
          <div className="stack">
            <section className="surface">
              <div className="surface-body">
                <span className="kicker">BẮT ĐẦU CHUẨN BỊ</span>
                <h2 style={{ marginTop: 14 }}>
                  Hồ sơ của bạn,
                  <br />
                  từng bước rõ ràng.
                </h2>
                <p>
                  Khai báo người đăng ký, thành viên hộ gia đình và lưu các phiên bản. Xem phần còn
                  thiếu và hỏi chủ đầu tư khi cần hỗ trợ.
                </p>
                <Button asChild className="mt-5 w-full">
                  <a href="/dashboard">
                    Chuẩn bị hồ sơ <Icon name="arrow" size={16} />
                  </a>
                </Button>
                <div className="help-note">
                  <Icon name="shield" />
                  <p>
                    Thông tin khai báo chỉ hiển thị cho tài khoản của bạn. Yêu cầu hỗ trợ chỉ chia
                    sẻ nội dung bạn đồng ý gửi.
                  </p>
                </div>
              </div>
            </section>
            {p.synthetic && (
              <div className="help-note amber">
                <p>
                  Dự án giả lập phục vụ kiểm tra hệ thống, không phải dự án đang chào bán hoặc nhận
                  đăng ký thật.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
