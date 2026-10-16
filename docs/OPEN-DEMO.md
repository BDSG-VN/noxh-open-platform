# Bản trải nghiệm mở (dự án hư cấu, tài khoản công khai)

Chế độ này cho phép bất kỳ ai dùng thử nền tảng mà không cần xin mã hay mật khẩu. Toàn bộ nội dung là giả lập: dự án **Khu nhà ở xã hội Mây Trắng** (phường Sương Mai, tỉnh Giả Lập) không tồn tại và không đại diện chủ đầu tư nào. Không đưa dữ liệu, ảnh hoặc giấy tờ thật vào môi trường này.

## Bật

```sh
node scripts/init-dev-env.mjs
node scripts/prepare-open-demo.mjs          # tạo deploy/keycloak/noxh-realm.open-demo.json
printf 'DEMO_OPEN_ACCESS=true\nKEYCLOAK_REALM_FILE=noxh-realm.open-demo.json\n' >> .env
docker compose up --build --wait --wait-timeout 600
```

Seed tự thêm dự án Mây Trắng, một đợt trải nghiệm kỹ thuật và thông báo bảo vệ dữ liệu giả lập đã duyệt (`db/fixtures/demo-open.sql`). Trang tổng hợp tài khoản: http://localhost:3000/trai-nghiem.

## Tài khoản công khai

| Cổng                                               | Cách vào                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Khách hàng (3000), đối tác (3004), Mini App (3003) | Số bất kỳ dạng `0900000xxx`; mã xác thực cố định `DEMO_OPEN_OTP` (mặc định `123456`), được trả về và điền sẵn. Không gọi Zalo. Số ngoài dải này vẫn cần cấu hình Zalo thật. |
| Quản trị chủ đầu tư (3001)                         | `demo.admin` / `MayTrang-Demo-2026`; mã hai bước tính từ bí mật TOTP công khai, hiển thị trực tiếp trên trang `/trai-nghiem`.                                               |

## Giới hạn an toàn

- Mặc định tắt. API từ chối khởi động luồng này khi `NODE_ENV=production` mà không có `ALLOW_SYNTHETIC_FIXTURES=true`; chỉ dải số giả lập mới dùng mã cố định.
- Realm `noxh-realm.open-demo.json` chứa mật khẩu và bí mật TOTP công khai; không dùng cho bất kỳ triển khai có dữ liệu thật. Realm nguồn `noxh-realm.json` vẫn không có người dùng mặc định.
- Giới hạn tần suất, phiên có thu hồi, RLS và vai trò DB tối thiểu áp dụng như bản chính thức.
- Khi dựng lại demo công khai thay cho bản Lam Sơn: dùng fixture này, không dùng tài liệu/ảnh của dự án thật; mọi số liệu ngưỡng, giá, mẫu đều là ví dụ.
