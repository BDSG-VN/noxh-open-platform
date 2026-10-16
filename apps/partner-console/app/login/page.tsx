import { Brand, Icon } from '@noxh/ui';
import LoginForm from './login-form';
export default function Login() {
  return (
    <main id="noi-dung" tabIndex={-1} className="auth-page">
      <section className="auth-story">
        <Brand />
        <div>
          <span className="kicker" style={{ color: '#72cdb1' }}>
            KHÔNG GIAN ĐỐI TÁC
          </span>
          <p className="auth-story-title">
            Kết nối đúng người.
            <br />
            Tư vấn đúng phạm vi.
          </p>
          <p>
            Đơn vị truyền thông, quản lý chiến dịch và chuyên viên tư vấn cùng làm việc theo dự án
            được chủ đầu tư giao.
          </p>
          <div className="auth-features">
            <p>
              <Icon name="building" />
              Dự án và chiến dịch được chủ đầu tư duyệt
            </p>
            <p>
              <Icon name="user" />
              Tài khoản nhân viên và quyền riêng theo vai trò
            </p>
            <p>
              <Icon name="shield" />
              Chỉ tiếp cận liên hệ khách đã đồng ý chia sẻ
            </p>
          </div>
        </div>
        <small style={{ color: '#a9c3d1' }}>BDSG Foundation · Mã nguồn mở MIT</small>
      </section>
      <section className="auth-form-wrap">
        <div className="auth-inner">
          <span className="kicker">ĐỐI TÁC / CHUYÊN VIÊN TƯ VẤN</span>
          <h1>Đăng nhập tài khoản được cấp</h1>
          <p>
            Dùng số điện thoại đã được chủ đầu tư hoặc quản lý đơn vị thêm vào danh sách nhân viên.
          </p>
          <LoginForm />
          <p className="section-subtitle">
            Mã Zalo chỉ xác thực quyền sử dụng số điện thoại. Hệ thống kiểm tra vai trò và trạng
            thái nhân viên sau đăng nhập.
          </p>
        </div>
      </section>
    </main>
  );
}
