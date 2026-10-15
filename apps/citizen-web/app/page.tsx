import { Button } from '@noxh/ui';
import ProjectExplorer from './project-explorer';
import { loadProjects } from './projects-data';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const { items, error } = await loadProjects();
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a className="brand" href="/">
            NOXH Open Platform<small>BDSG Foundation · Mã nguồn mở</small>
          </a>
          <nav className="navigation" aria-label="Điều hướng chính">
            <a href="#du-an">Dự án mẫu</a>
            <a href="/dashboard">Tài khoản của tôi</a>
            <a href="#hanh-trinh">Hành trình hồ sơ</a>
            <a href="https://github.com/BDSG-VN/noxh-open-platform">GitHub ↗</a>
          </nav>
        </div>
      </header>
      <div className="notice">
        <div className="container">
          Bản phát triển Sprint 0 · Chỉ dùng dữ liệu giả lập · Chưa tiếp nhận hồ sơ thật
        </div>
      </div>
      <main className="container">
        <section className="hero">
          <div>
            <span className="eyebrow">Nền tảng mở cho nhà ở xã hội</span>
            <h1>
              Một hành trình rõ ràng.
              <br />
              Một mái nhà tương lai.
            </h1>
            <p>
              Tìm hiểu dự án, chuẩn bị thông tin và theo dõi từng bước. Công dân và chủ đầu tư cùng
              làm việc trên một nền dữ liệu.
            </p>
            <Button asChild className="rounded-full px-7">
              <a href="#du-an">Khám phá cấu trúc dự án ↓</a>
            </Button>
            <p className="text-sm!">
              AI hỗ trợ giải thích. Quyết định hồ sơ thuộc người có thẩm quyền.
            </p>
          </div>
          <div
            className="hero-art"
            role="img"
            aria-label="Minh họa các khối nhà, không phải dự án thực tế"
          >
            <div className="building" />
            <div className="building" />
            <div className="building" />
            <span className="art-caption">Hình khối minh họa · Không phải ảnh dự án thực tế</span>
          </div>
        </section>
        <section id="du-an" className="section">
          <div className="section-head">
            <div>
              <span className="eyebrow">Danh mục dùng thử</span>
              <h2>Khám phá dự án mẫu</h2>
            </div>
            <span className="pill">{items.length} dự án công bố</span>
          </div>
          {error ? (
            <div className="error" role="alert">
              {error}
            </div>
          ) : (
            <ProjectExplorer projects={items} />
          )}
        </section>
        <section id="hanh-trinh" className="section">
          <span className="eyebrow">Lộ trình theo blueprint</span>
          <h2>Chuẩn bị trước, xác nhận sau</h2>
          <div className="grid-two">
            <div className="steps">
              {[
                ['Khám phá dự án', 'Tìm hiểu đợt tiếp nhận và tài liệu đã được phê duyệt.'],
                ['Chuẩn bị hồ sơ', 'Thông tin khai báo và giấy tờ được lưu riêng tư.'],
                [
                  'Kiểm tra mức độ đầy đủ',
                  'Danh sách việc còn thiếu, không phải kết luận đủ điều kiện.',
                ],
              ].map(([title, desc]) => (
                <div className="step" key={title}>
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="steps steps-continued">
              {[
                [
                  'Xác nhận biểu mẫu',
                  'Chỉ dùng phiên bản được duyệt; người dân kiểm tra nội dung.',
                ],
                ['Nộp hồ sơ chính thức', 'Thao tác riêng, có xác nhận và biên nhận.'],
                ['Theo dõi kết quả', 'Người có thẩm quyền xét duyệt, có dấu vết kiểm tra.'],
              ].map(([title, desc]) => (
                <div className="step" key={title}>
                  <div>
                    <strong>{title}</strong>
                    <p>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <p className="text-sm">
            Các bước hồ sơ, biểu mẫu và xét duyệt đang ở lộ trình phát triển, chưa hoạt động trong
            Sprint 0.
          </p>
        </section>
      </main>
      <footer className="footer">
        <div className="container">
          © BDSG Foundation · MIT · Tự triển khai trên hạ tầng của bạn. Không nhập dữ liệu cá nhân
          vào bản phát triển.
        </div>
      </footer>
    </>
  );
}
