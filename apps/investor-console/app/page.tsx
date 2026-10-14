import { Card, CardHeader, CardTitle, CardContent, Button } from '@noxh/ui';
export default function Console() {
  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <a className="brand" href="/">
            NOXH Open Platform<small>BDSG Foundation · Chủ đầu tư</small>
          </a>
          <span className="pill">KHUNG GIAO DIỆN SPRINT 0</span>
        </div>
      </header>
      <main className="container side-layout">
        <aside className="sidebar">
          <strong>Không gian vận hành</strong>
          {[
            'Tổng quan',
            'Dự án & đợt tiếp nhận',
            'Hồ sơ công dân',
            'Biểu mẫu',
            'Xét duyệt',
            'Minh bạch',
          ].map((x) => (
            <p key={x}>{x}</p>
          ))}
        </aside>
        <div>
          <span className="eyebrow">Một tổ chức · nhiều dự án</span>
          <h1 className="text-4xl!">Nền vận hành có kiểm soát.</h1>
          <p>
            Khung quản trị cho chủ đầu tư. Chưa có phiên đăng nhập nhân sự hoặc quyền thao tác dữ
            liệu.
          </p>
          <div className="grid-two">
            {[
              ['Phạm vi dự án', 'Mỗi quyền gắn với tổ chức và dự án cụ thể.'],
              ['Tách người làm và người duyệt', 'Người lập đề xuất không tự phê duyệt.'],
              ['Biểu mẫu có phiên bản', 'Mẫu chính thức cần nguồn và phê duyệt pháp lý.'],
              ['Nhật ký kiểm tra', 'Các chuyển trạng thái nhạy cảm phải có dấu vết.'],
            ].map(([title, desc]) => (
              <Card key={title}>
                <CardHeader>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{desc}</p>
                  <span className="pill">LỘ TRÌNH PHÁT TRIỂN</span>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="status-panel mt-6">
            <strong>Đăng nhập nhân sự</strong>
            <p>
              Keycloak được chuẩn bị trong Docker. Kết nối đăng nhập và cấp quyền theo dự án ở
              Sprint 1.
            </p>
            <Button disabled>Chưa tích hợp đăng nhập</Button>
          </div>
        </div>
      </main>
      <footer className="footer">
        <div className="container">
          BDSG Foundation · MIT · Không dùng bản phát triển để xử lý hồ sơ thật.
        </div>
      </footer>
    </>
  );
}
