export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="container section max-w-2xl!">
      <a className="brand" href="/">
        NOXH Open Platform<small>Chủ đầu tư · BDSG Foundation</small>
      </a>
      <h1 className="text-4xl!">Đăng nhập quản trị.</h1>
      <p>
        Nhân sự sử dụng tài khoản Keycloak được chủ đầu tư cấp quyền. Cần xác thực hai bước; đăng
        nhập khách hàng bằng số điện thoại không cấp quyền quản trị.
      </p>
      {error && (
        <p className="error" role="alert">
          Chưa hoàn tất xác thực. Kiểm tra tài khoản, vai trò org_admin/project_manager và cấu hình
          OTP của Keycloak.
        </p>
      )}
      <a href="/auth/start" className="inline-flex bg-primary text-white rounded-lg px-6 py-3">
        Đăng nhập qua Keycloak →
      </a>
      <p className="text-sm">
        Chủ đầu tư tự tạo tài khoản nhân sự và cấp quyền trong Keycloak. Hệ thống không tạo sẵn tài
        khoản người thật hoặc mật khẩu công khai.
      </p>
    </main>
  );
}
