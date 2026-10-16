# Thông báo tự động từ hồ sơ — phạm vi 021

Phân hệ này nối ba thay đổi hồ sơ diễn tập tới hộp thư khách hàng trong ứng dụng. Đây là thông báo nghiệp vụ để người dùng mở hồ sơ đối chiếu; không xác nhận đã tống đạt hợp lệ, không gửi email/Zalo và không mở tiếp nhận hồ sơ thật.

## Phạm vi và cấu hình

- `application.supplement-requested`: yêu cầu bổ sung được lưu thành công.
- `application.approved`: quyết định chấp thuận được lưu thành công.
- `application.rejected`: quyết định từ chối được lưu thành công.

`NOTIFICATIONS_AUTOMATION_ENABLED` mặc định không khai báo hoặc `false`. Chỉ chuỗi chính xác `true` bật producer/consumer; giá trị khác chặn khởi động/xử lý. Khi bật phải có `AUTH_ORGANIZATION_ID` UUID rõ ràng; worker không quét mọi tổ chức. Cả dự án và hồ sơ nguồn bắt buộc `is_synthetic`/`synthetic=true`.

Không thay đổi `NOTIFICATIONS_EXTERNAL_ENABLED`, không đăng ký adapter và không gọi nhà cung cấp. Các mẫu email/Zalo, tiếp thị và sự kiện miền khác nằm ngoài consumer này. Mẫu tự động phải được duyệt, thuộc cùng dự án, kênh `in_app`, mục đích `transactional`; đồng ý tiếp thị không được chuyển thành đồng ý nghiệp vụ.

## Quy tắc và phân quyền

Admin hoặc nhân sự có `records_write` trong dự án lập bản nháp cho một loại sự kiện và một phiên bản mẫu. Pháp chế độc lập có `form_legal_approver` trong phiên, bản ghi nhân sự đang hoạt động và phân công đúng dự án duyệt hoặc từ chối; người lập không tự duyệt. Duyệt/thu hồi yêu cầu `If-Match`, xác nhận rõ và ghi chú 10–1.000 ký tự. Có tối đa một quy tắc đã duyệt cho mỗi loại sự kiện/dự án; phải thu hồi trước khi duyệt bản khác.

Nội dung quy tắc bất biến; đổi mẫu phải lập bản mới. Ghi chú rà soát mã hóa; lịch sử duyệt chỉ thêm. Chính sách lưu ID/phiên bản nhân sự duyệt. Consumer kiểm lại đúng nhân sự, phiên bản, trạng thái, quyền và phân công dự án; thay đổi/cấp lại quyền không làm quy tắc cũ tự sống lại. Cần thu hồi và rà soát bản mới. Thay đổi hồ sơ nhân sự không liên quan quyền cũng tăng phiên bản và làm quy tắc cũ dừng, theo nguyên tắc thận trọng này.

API dưới `/api/v1/admin/notifications/projects/:project/automation`:

| Phương thức/đường dẫn       | Hành vi                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| `GET /`                     | 100 quy tắc/sự kiện gần nhất, tổng số theo trạng thái, cờ bật thực tế     |
| `POST /policies`            | Lập nháp `{eventType, templateId, idempotencyKey}`                        |
| `POST /policies/:id/review` | `{decision: approve/reject/revoke, accepted: true, note}`; cần `If-Match` |

Không có API trình duyệt để claim, gửi, retry hoặc đổi cờ worker. Scope tổ chức/dự án và quyền hiện hành được kiểm ở máy chủ.

## Giao dịch nguồn và đồng ý tại thời điểm sự kiện

`ApplicationService.requestSupplement()` và `decide()` gọi typed producer bên trong cùng giao dịch với thay đổi hồ sơ, trước khi khóa chuỗi audit. Giao dịch nguồn rollback thì không có sự kiện. Khóa duy nhất `(organization_id, application_id, event_type, application_version)` làm retry không tạo thông báo thứ hai.

Outbox riêng chỉ chứa metadata: mã hồ sơ công khai, phiên bản hồ sơ, loại sự kiện, ID nguồn và các pin quy tắc/mẫu/thông báo quyền riêng tư/lần đồng ý/phiên bản tùy chọn nhận tin. Không sao chép lý do từ chối, yêu cầu bổ sung, tên, số điện thoại hoặc giấy tờ. Producer chụp phiên bản, không giữ khóa thông báo sau khóa hồ sơ. Consumer kiểm lại toàn bộ trước khi ghi hộp thư.

Nếu lúc sự kiện xảy ra chưa có quy tắc, mẫu hợp lệ, đồng ý xử lý hiện hành hoặc tùy chọn `in_app/transactional` đúng phiên bản thì sự kiện được ghi `skipped` ngay. Duyệt quy tắc hay bật nhận tin sau đó không phát lại sự kiện này. Consumer cũng không gửi khi hồ sơ đã đổi phiên bản, rút hồ sơ, khách bị vô hiệu hóa, dự án bị lưu trữ, mẫu/quy tắc bị thu hồi hoặc quyền riêng tư thay đổi. Rút rồi đồng ý lại tạo pin mới; không khôi phục sự kiện cũ.

## Consumer, lease và phục hồi

Consumer nhận tối đa 10 sự kiện đến hạn mỗi lượt, `FOR UPDATE SKIP LOCKED`, lease token UUID ngẫu nhiên/30 giây và tối đa 3 lần claim. Token mới thay thế lease hết hạn; consumer cũ không thể ghi kết quả. Worker dùng phạm vi tổ chức đã cấu hình và principal hệ thống cố định cho audit, không dựng phiên nhân sự/admin giả.

Dispatch giữ khóa tổ chức, advisory `notifications:<org>`, dòng sự kiện và các bản ghi cần xác minh. Inbox mã hóa, attempt kết quả và ack `delivered` của sự kiện được commit cùng một giao dịch. Crash trước commit không để lại inbox một nửa; lease hết hạn mới được claim lại. Cùng một UUID sự kiện là khóa idempotency inbox; nếu thông báo thủ công đã dùng khóa này thì dừng `idempotency_conflict`, không ghi đè hoặc tự gửi thông báo thủ công.

Quy tắc bị thu hồi chuyển sự kiện pending/processing của quy tắc sang `skipped`, xóa lease. Consumer đang chạy và thu hồi được tuần tự hóa bởi cùng khóa thông báo: giao dịch nào giữ khóa trước hoàn thành trước. Thu hồi sau một thông báo đã commit không xóa bằng chứng đã gửi. Thay đổi đồng ý nhận tin/quyền riêng tư và thay đổi nhân sự được khóa cùng bản ghi quyền liên quan; không tuyên bố có thể thu hồi ngược một giao dịch đã hoàn tất.

Lỗi xử lý nội bộ trả sự kiện về pending với khoảng chờ `5 × attempt_count` giây; lần thứ ba kết thúc `failed/attempts_exhausted`. Lease bỏ dở ba lần cũng kết thúc failed. Không có retry vô hạn hoặc nút hồi sinh sự kiện terminal. Không lưu nội dung lỗi/raw stack vào sự kiện. Các sự kiện terminal và metadata nguồn bất biến ở DB.

Trong mỗi giao dịch, mọi khóa nghiệp vụ được lấy trước audit cuối giao dịch. Claim lấy tất cả dòng sẽ sửa trước khi append audit; không lấy thêm dòng sự kiện sau khi giữ khóa chuỗi audit. Timeout khóa 2 giây/câu lệnh 5 giây giới hạn chờ; đây không phải bằng chứng về tải sản xuất.

## Chạy và dừng

API đăng ký lifecycle opt-in chạy mỗi 5 giây với `unref()`, không chạy chồng trong cùng tiến trình, không tick ngay lúc khởi động. Nhiều replica dùng lease/khóa PostgreSQL để tránh tạo trùng. Dừng ứng dụng hủy interval, ngừng claim tiếp và đợi giao dịch đang chạy. Consumer chỉ chạy khi provider đã được đăng ký trong AppModule.

Worker hiện hữu hỗ trợ một lượt sau khi build:

```sh
node apps/api/dist/worker.js --notifications-once
```

Lệnh xuất phạm vi, cờ bật và số đếm; mặc định tắt thì không claim việc. Nếu lượt chạy gặp lỗi xử lý, mã thoát là 1 sau khi đóng ứng dụng; sự kiện skipped theo nghiệp vụ không được tính là lỗi xử lý. Worker thường trực dùng cùng lifecycle; `/health/live` chỉ mô tả tiến trình và số xử lý trong phiên hiện tại, không xác nhận đã gửi mọi thông báo hay kết nối nhà cung cấp. Không dùng lệnh này như sự chấp thuận bật trên máy chủ thật.

## Kiểm tra và giới hạn

`notification-automation.test.ts` kiểm nguồn thực ba loại sự kiện, rollback/idempotency, scope/SoD, mặc định tắt, rút/cấp lại đồng ý, thu hồi/cấp lại quyền nhân sự, mẫu/quy tắc/hồ sơ thay đổi, fencing/crash-before-commit, hết 3 lần, xung đột khóa inbox và dừng lifecycle. Kiểm thử PostgreSQL hai kết nối độc lập nằm trong `notification-automation-review.pg.test.ts`; phải chạy với cluster tạm tách biệt theo hướng dẫn của test, không trỏ DB demo/khách hàng. Không gọi dịch vụ gửi tin thật.

Kiểm tra cục bộ ngày 16/10/2026: 13/13 ca PGlite mới; 16/16 ca hồ sơ/thông báo hiện hữu; 19/19 ca PostgreSQL 17.6 độc lập. PostgreSQL đã quan sát khóa chờ thực bằng `pg_blocking_pids` cho hai chiều rút đồng ý/dispatch, tranh lease và thu hồi mẫu; kiểm vai trò không đặc quyền bị từ chối mặc định và phân vùng tổ chức khi cấp SELECT tạm trong giao dịch rollback. Typecheck API, ESLint và định dạng phạm vi thay đổi đạt. Test native mặc định bỏ qua nếu không có `NOTIFICATION_AUTOMATION_PG_URL`; khi bật chỉ chấp nhận instance tạm có cổng/tên DB/data-directory đúng các guard trong test. Đây là bằng chứng kiểm thử phạm vi, chưa phải xác nhận tải hoặc vận hành production.

Phiên bản này không tự phát mọi loại thông báo dự án, không có lịch nhắc định kỳ, không phải hàng đợi chung thay thế cho tất cả worker và không mở email/Zalo tự động. Vận hành thật cần duyệt quy trình, rà soát nội dung/đồng ý, giám sát failed/skipped và đánh giá tải/bảo mật riêng.
