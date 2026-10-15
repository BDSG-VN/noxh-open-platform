import LoginForm from './login-form';
export default function Login() {
  return (
    <main className="container section max-w-2xl!">
      <a href="/">← Về danh mục dự án</a>
      <span className="eyebrow block mt-8">NOXH Open Platform · Khách hàng</span>
      <h1 className="text-4xl!">Đăng nhập, không cần mật khẩu.</h1>
      <p>
        Mã được gửi qua Zalo của chủ đầu tư. Xác thực số điện thoại không thay thế xác minh danh
        tính pháp lý.
      </p>
      <LoginForm />
    </main>
  );
}
