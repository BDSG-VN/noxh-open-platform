import { Button, Brand, Icon } from '@noxh/ui';
import ProjectExplorer from './project-explorer';
import ArchitectureArt from './architecture-art';
import { loadProjects } from './projects-data';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const { items, error } = await loadProjects();
  return (
    <div className="public-shell">
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand />
          <nav className="navigation" aria-label="Điều hướng chính">
            <a href="#du-an">Khám phá dự án</a>
            <a href="#hanh-trinh">Hướng dẫn chuẩn bị</a>
            <Button asChild size="sm">
              <a href="/dashboard">
                Tài khoản của tôi <Icon name="arrow" size={14} />
              </a>
            </Button>
          </nav>
        </div>
        <div className="notice">
          <div className="container">
            Bản phát triển · Chỉ dùng dữ liệu giả lập · Chưa tiếp nhận hồ sơ thật
          </div>
        </div>
      </header>
      <main id="noi-dung" tabIndex={-1}>
        <div className="container">
          <section className="public-hero">
            <div>
              <span className="eyebrow">NỀN TẢNG MỞ CHO NHÀ Ở XÃ HỘI</span>
              <h1>
                An tâm chuẩn bị.
                <br />
                Vững bước an cư.
              </h1>
              <p>
                Khám phá dự án, chuẩn bị thông tin gia đình và biết rõ việc cần làm tiếp theo. Một
                không gian riêng cho hành trình tìm mái nhà của bạn.
              </p>
              <div className="hero-cta">
                <Button asChild>
                  <a href="#du-an">
                    Tìm hiểu dự án <Icon name="arrow" size={17} />
                  </a>
                </Button>
                <a className="text-link" href="/dashboard">
                  Tiếp tục hồ sơ của tôi
                </a>
              </div>
              <div
                className="help-note"
                style={{ background: 'transparent', border: 0, padding: '12px 0' }}
              >
                <Icon name="shield" size={17} />
                <p>Thông tin riêng tư. Quy trình rõ ràng. Mã nguồn mở.</p>
              </div>
            </div>
            <div
              className="architectural-art"
              role="img"
              aria-label="Minh họa kiến trúc nhà ở, không phải ảnh dự án thực tế"
            >
              <ArchitectureArt />
              <small>Minh họa kiến trúc · Không phải dự án thực tế</small>
            </div>
          </section>
        </div>
        <div className="public-strip">
          <div className="container">
            <span>
              <Icon name="building" />
              Một tài khoản, nhiều dự án
            </span>
            <span>
              <Icon name="folder" />
              Lưu hồ sơ theo từng bước
            </span>
            <span>
              <Icon name="chat" />
              Nhận hướng dẫn từ chủ đầu tư
            </span>
            <span>
              <Icon name="shield" />
              Tự chủ dữ liệu trên hạ tầng riêng
            </span>
          </div>
        </div>
        <section id="du-an" className="container public-projects">
          <div className="section-head">
            <div>
              <span className="eyebrow">BẮT ĐẦU TỪ DỰ ÁN PHÙ HỢP</span>
              <h2>Khám phá dự án</h2>
            </div>
            <span className="status-badge green">{items.length} dự án công bố</span>
          </div>
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : (
            <ProjectExplorer projects={items} />
          )}
        </section>
        <section id="hanh-trinh" className="container section">
          <span className="eyebrow">CHUẨN BỊ THEO TỪNG BƯỚC</span>
          <h2 style={{ color: '#234256', marginBottom: 25 }}>Luôn biết bước tiếp theo.</h2>
          <div className="grid-three">
            {[
              [
                '01 / KHÁM PHÁ',
                'Chọn dự án của bạn',
                'Tìm dự án được chủ đầu tư công bố và xem thời gian tiếp nhận.',
              ],
              [
                '02 / CHUẨN BỊ',
                'Khai báo, lưu và tiếp tục',
                'Thông tin người khai, thành viên hộ gia đình và các phiên bản được lưu riêng tư.',
              ],
              [
                '03 / KIỂM TRA',
                'Biết rõ phần còn thiếu',
                'Xem checklist chuẩn bị và gửi câu hỏi trực tiếp đến chủ đầu tư.',
              ],
            ].map(([n, t, d]) => (
              <div className="public-step" key={n}>
                <span>{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
          <div className="help-note amber">
            <Icon name="file" />
            <p>
              Hồ sơ chuẩn bị chưa phải đơn đăng ký đã nộp. Mở mục Nộp & theo dõi hồ sơ để kiểm tra
              đợt tiếp nhận, giấy tờ và biên nhận. Bản phát triển hiện chỉ tiếp nhận diễn tập.
            </p>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="container section-head">
          <Brand />
          <span>
            BDSG Foundation · MIT ·{' '}
            <a href="https://github.com/BDSG-VN/noxh-open-platform">Mã nguồn trên GitHub ↗</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
