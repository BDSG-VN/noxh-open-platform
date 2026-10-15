import { Brand, Button, Icon } from '@noxh/ui';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="kicker" style={{ color: '#71d5b4' }}>
            KHÔNG GIAN CHỦ ĐẦU TƯ
          </span>
          <h1>
            Quản lý tập trung.
            <br />
            Đồng hành rõ ràng.
          </h1>
          <p>
            Dự án, lịch tiếp nhận, cấu hình xác thực và yêu cầu hỗ trợ khách hàng trên một nền dữ
            liệu.
          </p>
          <div
            className="help-note"
            style={{ background: '#204555', borderColor: '#335766', color: '#b1d4d0' }}
          >
            <Icon name="shield" />
            <p>Xác thực đa yếu tố. Phân quyền máy chủ. Nhật ký có kiểm tra toàn vẹn.</p>
          </div>
        </div>
        <small style={{ color: '#769aad' }}>BDSG Foundation · Giải pháp mã nguồn mở MIT</small>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-inner">
          <Brand />
          <h1 style={{ marginTop: 38 }}>Đăng nhập quản trị</h1>
          <p>Sử dụng tài khoản nhân sự do chủ đầu tư cấp và mã xác thực hai bước.</p>
          {error && (
            <div role="alert" className="feedback error">
              Chưa hoàn tất đăng nhập. Kiểm tra tài khoản, quyền quản trị và cấu hình xác thực hai
              bước.
            </div>
          )}
          <Button asChild className="w-full mt-6">
            <a href="/auth/start">
              Đăng nhập qua Keycloak <Icon name="arrow" size={17} />
            </a>
          </Button>
          <p style={{ fontSize: 11, marginTop: 24 }}>
            Tài khoản khách hàng bằng số điện thoại có cổng đăng nhập riêng. Liên hệ người quản trị
            tổ chức nếu bạn chưa được cấp tài khoản nhân sự.
          </p>
        </div>
      </section>
    </main>
  );
}
