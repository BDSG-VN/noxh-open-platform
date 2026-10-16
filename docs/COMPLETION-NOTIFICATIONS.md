# Thông báo dự án — lát cắt 019

## Phạm vi đã triển khai

Module riêng `NotificationService` / `NotificationController`, hợp đồng `notifications.ts` và migration `019_notifications.sql` cung cấp luồng có lưu trữ thật: soạn mẫu theo dự án → người khác có quyền pháp chế hiện hành duyệt → chọn đúng hồ sơ → lập hàng đợi → chủ động xác nhận phát → khách xem và xác nhận đã đọc trong hộp thư. Chỉ dự án và hồ sơ `synthetic=true`; không chứng nhận tống đạt pháp lý.

Mẫu gồm kênh, mục đích, tiêu đề, nội dung văn bản thuần và căn cứ sử dụng. Chỉ ba biến cố định `{projectName}`, `{applicationCode}`, `{reference}`; không HTML, biểu thức thực thi hay truy xuất trường tùy ý. Bản mẫu đã tạo bất biến; thay nội dung bằng bản mới, không sửa bản đã duyệt. Người soạn không tự duyệt, từ chối hoặc thu hồi. Duyệt yêu cầu quyền `form_legal_approver` trong phiên và hồ sơ nhân sự đang hoạt động, có quyền và phân công dự án hiện hành ngay trong giao dịch. Tài khoản quản trị cũng phải đáp ứng bước rà soát độc lập này.

Nội dung mẫu, thư, căn cứ, ghi chú duyệt và biên nhận adapter được AES-GCM với AAD gắn đối tượng. Audit chỉ lưu hành động/định danh, không nội dung thư hoặc bí mật kênh. Tên mẫu cấu hình, mục đích, kênh, trạng thái, chủ thể và mã định danh quan hệ là metadata trong CSDL; không nhập dữ liệu cá nhân vào tên mẫu.

## Đồng ý và rút lại

Lựa chọn nhận tin tách biệt theo **tổ chức + dự án + người dùng + mục đích + kênh**. Mặc định tất cả tắt. Đồng ý marketing không cấp quyền thông báo nghiệp vụ và ngược lại. Mỗi lần bật phải có thông báo riêng tư được duyệt hiện hành, quyền xử lý không bị hạn chế, cùng thao tác xác nhận rõ. Không suy diễn số điện thoại đã xác minh thành đồng ý nhận tin.

Mỗi lựa chọn và mỗi thư ghim chính xác ID quyết định đồng ý riêng tư, phiên bản lựa chọn kênh và hash thông báo. Rút lại rồi đồng ý lại không làm sống lại hàng đợi cũ. Trước phát kiểm tra lại lựa chọn, quyền xử lý, mẫu, chủ hồ sơ, dự án và hồ sơ chưa rút. Lựa chọn thay đổi hoặc mẫu thu hồi sẽ hủy các thư `queued`/`failed`; lựa chọn mới cần lập thư mới. Rút lựa chọn nhận tin vẫn thực hiện được khi đã rút quyền xử lý chung. Hộp thư cũ vẫn đọc được; xác nhận đọc không được mô tả như chữ ký hay đồng ý nội dung pháp lý.

Mỗi thay đổi lựa chọn và mỗi quyết định duyệt/thu hồi mẫu có sự kiện bất biến riêng; thu hồi không ghi đè chứng cứ quyết định duyệt trước. Module chưa triển khai tự xóa theo thời hạn; việc lưu hoặc xóa chứng cứ cần chính sách lưu trữ được phê duyệt và luồng retention/erasure riêng.

## Hàng đợi và kênh ngoài

- Tạo mẫu và hàng đợi dùng `idempotencyKey` UUID; cùng khóa phải cùng nội dung và người tạo. Chỉ trả kết quả cũ trong đúng phạm vi đã kiểm tra.
- Phát trong ứng dụng tạo bản ghi lần phát và hộp thư trong cùng giao dịch. Bấm phát lặp không tạo thêm lần phát khi thư đã thành công. Không có tác vụ ngầm gửi toàn bộ khách hàng.
- Email/Zalo mặc định không hoạt động. Cần **đồng thời** `NOTIFICATIONS_EXTERNAL_ENABLED=true`, adapter máy chủ được đăng ký, cấu hình dự án được bật bởi `privacy_officer` hiện hành và khách đã đồng ý đúng kênh/mục đích.
- Giao diện không nhận URL, token, mật khẩu hoặc khóa bí mật. Registry `NotificationService.transports` chỉ được bộ khởi động/worker vận hành gắn adapter đã kiểm tra. Adapter nhận UUID người dùng để tự tra kênh xác minh theo hợp đồng được duyệt; không tự lấy địa chỉ hay số điện thoại từ dữ liệu trình duyệt.
- Adapter bắt buộc khai báo hỗ trợ idempotency; `messageId` là khóa ổn định qua các lần thử. Hợp đồng adapter thật phải chứng minh khóa này chống gửi trùng tại nhà cung cấp, kể cả khi tiến trình chết sau gửi nhưng trước COMMIT. Chưa có adapter nhà cung cấp thật trong lát cắt này.
- Mỗi lời gọi có hạn 8 giây và `AbortSignal`. Kết quả từ chối rõ ràng là `failed`; chỉ người vận hành xác nhận thử lại với phiên bản hiện hành, giới hạn được cấu hình 1–3 lần. Không có retry vô hạn.
- Timeout, lỗi mạng, throw hoặc biên nhận không hợp lệ là `outcome_unknown`; không tự thử lại và API chặn bấm gửi lại. Cần đối chiếu nhà cung cấp trước; chưa có tính năng tự đối soát hay mở lại trạng thái này.
- Tác vụ gửi giữ khóa chia sẻ tổ chức, khóa notification tổ chức và các khóa đọc quyền/lựa chọn trong giao dịch, tối đa 8 giây chờ adapter. Rút quyền xử lý và thay đổi lựa chọn được tuần tự hóa với phát. Không được ghép lời gọi này tùy tiện vào giao dịch nghiệp vụ đang giữ khóa ngược thứ tự.

Trạng thái `delivered` của email/Zalo nghĩa adapter chấp nhận phát theo giao thức của nó; không chứng minh người nhận đọc. Chỉ thư trong ứng dụng có xác nhận đọc của khách. `deliveryRef` được lưu mã hóa, không được đưa vào log hay phản hồi thông thường.

## Tích hợp

API gốc là `/api/v1`:

| Vai trò          | Đường dẫn                                                     | Phương thức / phiên bản              |
| ---------------- | ------------------------------------------------------------- | ------------------------------------ |
| Nhân sự          | `/admin/notifications/projects/:project/workspace`            | GET, 100 mẫu và 100 thư mới nhất     |
| Nhân sự          | `/admin/notifications/projects/:project/templates`            | POST, khóa idempotency               |
| Rà soát pháp chế | `/admin/notifications/projects/:project/templates/:id/review` | POST, `If-Match`                     |
| Nhân sự          | `/admin/notifications/projects/:project/queue`                | POST, khóa idempotency               |
| Nhân sự          | `/admin/notifications/projects/:project/messages/:id/deliver` | POST, `If-Match`, `{accepted:true}`  |
| Rà soát dữ liệu  | `/admin/notifications/projects/:project/transports`           | POST, `If-Match` (0 khi chưa có)     |
| Khách            | `/citizen/notifications/workspace`                            | GET, 100 thư trong ứng dụng mới nhất |
| Khách            | `/citizen/notifications/projects/:project/preferences`        | POST, `If-Match` (0 khi chưa có)     |
| Khách            | `/citizen/notifications/messages/:id/read`                    | POST, `If-Match`, `{accepted:true}`  |

Quyền thường dùng `records_read` / `records_write` và phân công dự án hiện hành. Quản trị tổ chức có thể quản lý thông thường; các bước pháp chế/quyền riêng tư vẫn cần quyền chuyên trách hiện hành. Customer chỉ thấy quan hệ hồ sơ của chính mình. Migration có khóa ngoại tổ chức/dự án/người sở hữu, RLS bắt buộc và thu hồi toàn bộ quyền trực tiếp của `noxh_runtime`; tách vai trò runtime đúng quyền vẫn là chốt phát hành hạ tầng.

UI mới: `NotificationsAdmin({projects,staff?})` và `NotificationsCustomer()`. Root tích hợp module Nest, guard/BFF, điều hướng và OpenAPI. Không sửa hợp đồng legacy `ChannelNotificationProvider` hay bảng nền `outbox_events` đang chưa có worker thực tế. Không tự nối sự kiện thay đổi hồ sơ/hợp đồng vào phát hàng loạt; liên kết tự động từng sự kiện nghiệp vụ là bước tích hợp riêng cần chính sách mẫu/đối tượng và thứ tự khóa được duyệt.

## Kiểm chứng và giới hạn

`pnpm --filter @noxh/api exec vitest run src/notification.test.ts` kiểm chứng CSDL PostgreSQL nhúng thật: duyệt độc lập, snapshot bất biến/mã hóa, idempotency/concurrent API retry, scope hai tổ chức, nhân viên bị đình chỉ, purpose/channel consent, rút rồi cấp lại quyền, giới hạn retry, kênh mặc định tắt, kết quả không xác định, xác nhận đọc và xác thực controller. Mock transport chỉ dùng trong phép thử, không gửi tin.

Đây là lát cắt tổng thể synthetic có giao diện và persistence, chưa là hệ thống gửi email/Zalo sản xuất. Cần hợp đồng API/nhà cung cấp đã xác minh, credential vault/rotation, biên nhận và webhook có xác thực/chống replay, quota theo nhà cung cấp, đối chiếu kết quả không rõ, worker có admission/rate limits, kiểm thử tải/thất bại PostgreSQL thật và chính sách retention trước khi mở kênh thật.
