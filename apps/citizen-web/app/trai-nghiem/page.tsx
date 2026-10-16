import { Brand } from '@noxh/ui';
import DemoTotp from './demo-totp';
export const dynamic = 'force-dynamic';
/** Public demo credentials page. Renders only when the deployment runs in open demo mode. */
export default function OpenDemoPage() {
  if (process.env.DEMO_OPEN_ACCESS !== 'true')
    return (
      <main className="container section">
        <Brand />
        <h1>Bản trải nghiệm mở chưa bật</h1>
        <p>Triển khai này không ở chế độ trải nghiệm; không có tài khoản công khai.</p>
      </main>
    );
  const otp = process.env.DEMO_OPEN_OTP ?? '123456';
  const admin = process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001';
  const partner = process.env.PARTNER_PUBLIC_ORIGIN ?? 'http://localhost:3004';
  return (
    <main className="container section">
      <Brand />
      <h1>Bản trải nghiệm mở · dữ liệu giả lập</h1>
      <p>
        Dự án <strong>Khu nhà ở xã hội Mây Trắng</strong> là dự án hư cấu. Mọi tài khoản dưới đây
        công khai, không cần xin mã; dữ liệu có thể bị xóa khi làm mới. Không nộp giấy tờ thật.
      </p>
      <section className="card">
        <h2>Khách hàng và đối tác (cổng này)</h2>
        <p>
          Nhập một số bất kỳ dạng <code>0900000xxx</code> ở <a href="/login">trang đăng nhập</a>, ví
          dụ <code>0900000000</code>. Mã xác thực luôn là <strong>{otp}</strong> và được điền sẵn.
          Mỗi số là một tài khoản riêng.
        </p>
        <p>
          Đối tác/chuyên viên: <a href={partner + '/login'}>{partner}/login</a> dùng cùng cách.
        </p>
      </section>
      <section className="card">
        <h2>Quản trị chủ đầu tư</h2>
        <p>
          <a href={admin + '/login'}>{admin}/login</a> · tài khoản <code>demo.admin</code> · mật
          khẩu <code>MayTrang-Demo-2026</code>
        </p>
        <DemoTotp secret="NOXHDEMOMAYTRANGOPENACCESSAB2345" />
      </section>
      <p style={{ fontSize: 12 }}>
        Chế độ này tắt mặc định (<code>DEMO_OPEN_ACCESS</code>) và bị từ chối ở môi trường
        production có dữ liệu thật.
      </p>
    </main>
  );
}
