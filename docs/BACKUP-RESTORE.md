# Sao lưu mã hóa, diễn tập khôi phục và tải giả lập

Công cụ tự lưu trữ, không gọi đám mây. Sao lưu PostgreSQL và kiểm tra khôi phục **cơ sở dữ liệu tạm**. Đây chưa phải phương án phục hồi toàn bộ hạ tầng.

## Chuẩn bị

- Node.js 22+, các gói workspace đã cài và PostgreSQL client tools tương thích với phiên bản máy chủ. `pg_dump` không được cũ hơn phiên bản major của máy chủ; `pg_restore` phải đọc được archive của `pg_dump`. Kiểm tra phiên bản trước vận hành.
- `SOURCE_DATABASE_URL` được nạp từ kho bí mật/môi trường quản trị để sao lưu. Không truyền URL có mật khẩu qua tham số lệnh hoặc ghi vào lịch sử shell.
- `DRILL_ADMIN_DATABASE_URL` là kết nối quản trị có quyền tạo một database tạm trên máy chủ dành cho diễn tập. Công cụ không nhận tên database đích từ người dùng. Vai trò mà policy/GRANT của bản sao tham chiếu, ví dụ `noxh_runtime`, phải tồn tại trong cluster diễn tập; công cụ không tự sửa các vai trò của cluster.
- `BACKUP_ENCRYPTION_KEY`: 32 byte ngẫu nhiên độc lập dạng 64 ký tự hex, nạp qua kho bí mật. Script từ chối dùng cùng giá trị `AUTH_ENCRYPTION_KEY`. Giữ bản escrow có kiểm soát và tách nơi lưu khóa với archive; mất khóa sẽ không giải mã được.
- `PG_DUMP_BIN`, `PG_RESTORE_BIN` tùy chọn để chỉ rõ đường dẫn executable. Không có shell nội suy. Kết nối PostgreSQL được truyền qua môi trường con, mật khẩu không nằm trong dòng lệnh. Client stderr và nội dung bản ghi không được in ra.

Không dùng khóa minh họa hoặc tài khoản production trong báo cáo/ảnh chụp. Chọn thư mục sao lưu riêng chỉ quản trị viên truy cập được; thư mục đích phải tồn tại. Ví dụ dưới đây giả định các biến môi trường đã được nạp an toàn:

```sh
node scripts/backup-restore.mjs backup --out /secure/backups/noxh-2026-10-15.noxh
node scripts/backup-restore.mjs restore --input /secure/backups/noxh-2026-10-15.noxh --drill
```

## Định dạng và tính toàn vẹn

Một giao dịch PostgreSQL `REPEATABLE READ READ ONLY` xuất snapshot cho `pg_dump --snapshot`. Manifest và archive cùng nhìn một mốc dữ liệu. Manifest gồm các checksum migration, số dòng từng bảng, hash cấu trúc cột/ràng buộc/index/policy/hàm và kết quả kiểm tra chuỗi audit theo từng tổ chức. Chuỗi audit sai thì việc sao lưu không được đánh dấu thành công.

Dữ liệu đi trực tiếp từ stdout `pg_dump` qua AES-256-GCM vào tệp tạm **đã mã hóa**. Header được xác thực như AAD, nonce mới mỗi bản; manifest cũng ở trong ciphertext. Không có SQL/dump bản rõ trung gian ở bước sao lưu. Chỉ tạo tên đích sau khi `pg_dump` và mã hóa hoàn tất, fsync tệp, dùng hard link nguyên tử không ghi đè. Archive có quyền `0600`; tệp tạm được dọn khi thất bại. Không có tùy chọn ghi đè bản cũ.

Đầu ra chỉ có đường dẫn archive, dung lượng, số bảng/migration/audit và hash manifest, không chứa URL kết nối, khóa, bản ghi hoặc giấy tờ. Archive có dữ liệu nhạy cảm dù đã mã hóa; áp dụng thời hạn lưu, kiểm soát truy cập và quy trình chuyển bản sao được tổ chức phê duyệt.

## Diễn tập khôi phục

`--drill` là điều kiện bắt buộc. Công cụ giải mã vào thư mục tạm `0700`, tệp bản rõ `0600`, xác minh tag GCM **trước khi** gọi `pg_restore`. Sai khóa, sửa header, sửa ciphertext hoặc tag đều dừng trước khi khôi phục. Bản rõ được xóa cả khi thành công hoặc thất bại; việc xóa tệp không được coi là bảo đảm xóa vật lý trên SSD, vì vậy cần volume tạm được mã hóa tại hệ điều hành.

Database đích luôn được script tự sinh `noxh_restore_drill_<24 ký tự hex>`. Không có tham số phục hồi đè database. Database identity chuẩn hóa localhost/127.0.0.1/::1 và bỏ thông tin tài khoản; cùng database nguồn bị từ chối. Script tạo database từ `template0`, chạy `pg_restore --single-transaction --exit-on-error --no-owner`, rồi đối chiếu manifest và tự tính lại audit chain. Không vô hiệu ràng buộc để ép kết quả khớp.

Chỉ database được **chính lần chạy này tạo thành công** mới được dọn. Không dùng `DROP ... FORCE`, không liệt kê rồi xóa theo tiền tố, không ngắt kết nối của tiến trình khác. Nếu không dọn được, thông báo đúng tên database tạm để quản trị viên xử lý; dữ liệu gốc không bị thay đổi. PostgreSQL utility có giới hạn 15 phút mỗi tiến trình; một job khôi phục lớn hơn cần được tổ chức đánh giá và điều chỉnh công cụ riêng.

Kiểm tra thành công xác minh schema, migration checksums, số dòng và chuỗi audit của bản sao. Nó chưa chứng minh khôi phục đầy đủ quyền sở hữu/ACL của một cluster mới, số dư nghiệp vụ, toàn bộ nội dung tệp đối tượng, RPO/RTO hoặc khả năng phục vụ traffic sau sự cố.

## Phần hạ tầng còn phải sao lưu

Phải có runbook riêng cho kho đối tượng S3/MinIO, volume và database Keycloak, cấu hình triển khai, chứng thư và khóa giải mã ứng dụng, tài liệu pháp lý gốc, ký checkpoint ngoài máy và khóa provider. Không đưa các khóa này vào cùng archive. Redis nếu chứa tác vụ nghiệp vụ cần chính sách khôi phục/reconcile, không chỉ khôi phục PostgreSQL. Chưa có lịch sao lưu hoặc chuyển bản sao ra máy khác tự động trong công cụ này.

## Tải đọc nhiều dự án bằng dữ liệu giả lập

```sh
ALLOW_SYNTHETIC_FIXTURES=true node scripts/load-synthetic.mjs --origin http://127.0.0.1:4000 --requests 120 --concurrency 4
```

Script chỉ chấp nhận HTTP loopback cổng API 4000, không có user/password/path/query và không đi theo redirect. Catalog phải có 2–100 dự án công bố, **tất cả** có cờ giả lập; tối đa 20 dự án được dùng cho bài chạy. Dữ liệu thật hoặc catalog lẫn dữ liệu thật bị từ chối. Chỉ gọi GET health/live, health/ready, chi tiết dự án và lịch tiếp nhận; không có phiên đăng nhập, PII, AI/provider hoặc ghi nghiệp vụ.

Giới hạn cứng 1–500 yêu cầu, 1–8 worker, 3 giây mỗi yêu cầu, 60 giây toàn bài và 256 KiB mỗi response. Báo số yêu cầu hoàn thành/thất bại, số dự án, thời gian, p50/p95; lỗi hoặc timeout làm exit code khác 0. Đây là bài tải đọc giả lập nhỏ để phát hiện lỗi cơ bản, không phải benchmark production, thử cạnh tranh phân căn, SLO/SLA hoặc chứng nhận năng lực chịu tải.

Kiểm thử đơn vị an toàn: `node --test tests/backup-restore.test.mjs`. Bằng chứng native thực tế, khi đã chạy, cần ghi riêng thời điểm, phiên bản client/server, số migration và manifest hash; không ghi URL có mật khẩu hoặc khóa.

## Bằng chứng diễn tập ngày 15/10/2026

Đã chạy trên cơ sở dữ liệu demo PostgreSQL 17.6 sau migration 001–014, lúc 07:02 UTC. Client `pg_dump`/`pg_restore` 17.6 được biên dịch từ [mã nguồn chính thức](https://ftp.postgresql.org/pub/source/v17.6/), SHA-256 archive nguồn `e0630a3600aea27511715563259ec2111cd5f4353a4b040e0be827f94cd7a8b0`. Đây là công cụ native phục vụ kiểm tra, không được chép vào mã nguồn dự án.

Sao lưu mã hóa và khôi phục vào database tạm thành công: **66 bảng, 14 migration, 31 sự kiện audit**, archive 299.770 byte, thời gian cả bước 520 ms trên dữ liệu demo nhỏ. Hash manifest nguồn và bản phục hồi cùng là `ead9682159ce4d52e5b964b900b7dfddd9ff348131f4cdeff96fc926b259ba67`. Công cụ đã xóa database tạm và dump bản rõ sau kiểm tra; không phục hồi đè database nguồn. Archive và khóa kiểm thử nằm ngoài repository, có quyền truy cập riêng. Thời gian này không phải RTO đã cam kết cho dữ liệu lớn hoặc sự cố toàn hệ thống.

Bài tải đọc trên bản demo API đang chạy: 2 dự án giả lập, **120/120 yêu cầu hoàn thành, 0 lỗi**, 4 worker, 100,38 ms, p50 1,72 ms, p95 9,68 ms. Chỉ là baseline GET công khai tại thời điểm đo; không suy rộng thành năng lực production hoặc kiểm thử tải các phân hệ mới chưa được khởi động lại trong tiến trình API ở thời điểm này.
