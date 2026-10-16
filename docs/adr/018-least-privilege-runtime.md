# ADR 018 — Vai trò cơ sở dữ liệu tối thiểu cho API và worker

Ngày: 2026-10-16 · Chấp nhận cho bản phát triển; triển khai thật cần diễn tập riêng.

## Bối cảnh

API và worker trước đây kết nối bằng tài khoản tạo database (`POSTGRES_USER`), là superuser trong Compose. Superuser bỏ qua RLS, có thể tắt trigger bất biến, chạy DDL và đổi vai trò. Vai trò `noxh_runtime` có từ Sprint 0 nhưng chỉ phủ một phần bảng công dân và cần biến `app.*` mà mã chưa đặt cho mọi truy vấn.

## Quyết định

- Migration 022 tạo vai trò nhóm `noxh_app` (NOLOGIN, không superuser/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION, NOINHERIT). Login thực tế (mặc định `noxh_api`) chỉ là thành viên `noxh_app`, do `scripts/runtime-role.mjs provision` tạo bằng kết nối chủ migration.
- Quyền bảng được suy ra từ 592 câu SQL tĩnh trong `apps/api/src` cộng thân các trigger SECURITY INVOKER được kích hoạt, bằng `scripts/sql-inventory.mjs` và `scripts/runtime-privileges.mjs`. Không cấp TRUNCATE, REFERENCES, TRIGGER, CREATE trên schema hay quyền sở hữu. Bảng chỉ thêm (audit, quyết định, phiên bản bản khai…) không có UPDATE/DELETE.
- Bảng chỉ cần khóa hàng (`SELECT … FOR UPDATE`) mà mã không cập nhật được cấp UPDATE một cột kèm trigger `runtime_lock_only` từ chối mọi UPDATE từ thành viên `noxh_app`.
- Mọi bảng trong `public` và `identity_private` (trừ `schema_migrations` và `instance_organizations`) bật và FORCE RLS. Chính sách cho `noxh_app` gồm một chính sách cho phép và một chính sách RESTRICTIVE: hàng thuộc tổ chức có trong `identity_private.instance_organizations`, và nếu giao dịch đã ghim `app.organization_id` thì phải khớp giá trị đó. Bảng giới hạn tần suất/phiên thu hồi không có cột tổ chức dùng phạm vi toàn instance; liên kết PDF hồ sơ đi theo hàng hồ sơ cha.
- `instance_organizations` chỉ chủ migration ghi; công cụ provision đăng ký `AUTH_ORGANIZATION_ID`. Runtime chỉ đọc bảng này qua hàm SECURITY INVOKER.
- `DATABASE_REQUIRE_LEAST_PRIVILEGE=true` làm `/health/ready` thất bại nếu API không chạy bằng login tối thiểu. Compose phát triển bật cờ này; triển khai hiện hữu giữ hành vi cũ cho tới khi chuyển kết nối.

## Hệ quả

- Lỗi ứng dụng như quên điều kiện tổ chức, SQL injection hoặc thư viện bị lợi dụng không còn đọc/ghi được tổ chức khác, không sửa được chứng cứ bất biến, không tắt RLS và không tạo đối tượng mới bằng kết nối runtime.
- Thêm câu SQL cần quyền mới làm kiểm thử `runtime-privileges.test.ts` thất bại cho tới khi có migration mới; quyền thừa cũng bị phát hiện. Chạy toàn bộ bộ kiểm thử API với `NOXH_TEST_RUNTIME_ROLE=1` thực thi mọi câu SQL của service dưới vai trò `noxh_app`.
- Không thay thế: tách khóa mã hóa ra kho khóa, phân tách quản trị audit ngoài DB, sao lưu/khôi phục ngoài máy, quét bảo mật độc lập. Superuser hoặc người có quyền chủ bảng vẫn vượt được RLS; chỉ API/worker được hạ quyền.
- Chuyển một triển khai đang chạy sang login mới là thao tác vận hành riêng (migrate 022 → provision → đổi `DATABASE_URL` của API/worker → kiểm `/health/ready`), cần sao lưu và kế hoạch hoàn tác. Xem [vận hành](../COMPLETION-OPERATIONS.md#vai-trò-db-tối-thiểu-cho-runtime-022).
