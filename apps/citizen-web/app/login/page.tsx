import { Brand, Icon } from '@noxh/ui';
import LoginForm from './login-form';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = (await searchParams).next;
  const returnTo = next && /^\/tu-van\/[a-f0-9-]{36}$/.test(next) ? next : '/dashboard';
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="kicker" style={{ color: '#72cdb1' }}>
            MỘT TÀI KHOẢN · MỘT HÀNH TRÌNH
          </span>
          <h1>
            Mái nhà tương lai,
            <br />
            bắt đầu từ hôm nay.
          </h1>
          <p>
            Chuẩn bị thông tin gia đình, theo dõi từng bước và kết nối với chủ đầu tư trong một
            không gian riêng.
          </p>
          <div
            className="help-note"
            style={{ background: '#204555', borderColor: '#335766', color: '#b1d4d0' }}
          >
            <Icon name="shield" />
            <p>Không cần nhớ mật khẩu. Thông tin của bạn được lưu riêng tư.</p>
          </div>
        </div>
        <small style={{ color: '#769aad' }}>BDSG Foundation · Giải pháp mã nguồn mở MIT</small>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-inner">
          <a className="auth-back" href="/">
            ← Khám phá dự án
          </a>
          <h1>Đăng nhập tài khoản</h1>
          <p>Nhận mã xác thực qua Zalo bằng số điện thoại của bạn.</p>
          <LoginForm returnTo={returnTo} />
          <p style={{ fontSize: 11, marginTop: 25 }}>
            Xác thực số điện thoại chưa thay thế xác minh danh tính pháp lý. Bản phát triển chỉ dùng
            thông tin giả lập.
          </p>
        </div>
      </section>
    </main>
  );
}
