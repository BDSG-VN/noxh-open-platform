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
- Email/Zalo mặc định không hoạt động. Cần **đồng thời** `NOTIFICATIONS_EXTERNAL_ENABLED=true`, adapter máy chủ được đăng ký lúc khởi động, cấu hình nhà cung cấp của tổ chức do `org_admin` nhập, cấu hình dự án được bật bởi `privacy_officer` hiện hành **khác người nhập cấu hình**, và khách đã đồng ý đúng kênh/mục đích.
- Registry `NotificationService.transports` chỉ được bộ khởi động API/worker gắn adapter đã kiểm tra (`registerNotificationAdapters`): `email-smtp` và `zalo-oa` ([lát cắt 023](#lát-cắt-023--gửi-thật-qua-worker)). Trình duyệt không chọn được URL hay endpoint; máy chủ SMTP phải nằm trong danh sách vận hành `NOTIFICATIONS_SMTP_ALLOWED_HOSTS`.
- Adapter bắt buộc khai báo hỗ trợ idempotency; `messageId` là khóa ổn định qua các lần thử (`Message-ID` SMTP, `tracking_id` Zalo). Hợp đồng adapter thật phải chứng minh khóa này chống gửi trùng tại nhà cung cấp, kể cả khi tiến trình chết sau gửi nhưng trước COMMIT; điều này **chưa được nghiệm thu** với nhà cung cấp thật.
- Xác nhận phát (`deliver`) kênh ngoài **không gửi trong yêu cầu HTTP**: nó chỉ tạo tác vụ trong `notification_deliveries` với ngân sách lần thử theo cấu hình (tối đa 3). Worker (`apps/api/dist/worker.js`) nhận tác vụ bằng lease có fencing và gửi; mỗi lời gọi adapter có hạn 8 giây và `AbortSignal`.
- Nhà cung cấp từ chối rõ (SMTP 5yz, Zalo `error≠0`/4xx) là `failed` và tác vụ vào hàng chờ lỗi ngay, không tự thử lại. Lỗi tạm (SMTP 4yz, HTTP 5xx/429, không kết nối được) là `failed` kèm thử lại theo lũy thừa có jitter (10s, 20s…) cho tới hết ngân sách, rồi vào hàng chờ lỗi `attempts_exhausted`.
- Timeout, im lặng sau khi đã gửi dữ liệu, throw hoặc biên nhận không hợp lệ là `outcome_unknown`: thư và tác vụ kết thúc, không tự thử lại, API chặn bấm gửi lại. Cần đối chiếu nhà cung cấp trước; chưa có tính năng tự đối soát.
- Tác vụ gửi giữ khóa chia sẻ tổ chức, khóa notification tổ chức và các khóa đọc quyền/lựa chọn trong giao dịch, tối đa 8 giây chờ adapter. Rút quyền xử lý, đổi lựa chọn, thu hồi mẫu, tắt kênh giữa lúc xếp hàng và lúc gửi được kiểm lại ngay trước khi gửi: thư bị `cancelled` (đồng ý) hoặc tác vụ vào hàng chờ lỗi `transport_disabled`.

Trạng thái `delivered` của email/Zalo nghĩa adapter chấp nhận phát theo giao thức của nó; không chứng minh người nhận đọc. Chỉ thư trong ứng dụng có xác nhận đọc của khách. `deliveryRef` được lưu mã hóa, không được đưa vào log hay phản hồi thông thường.

## Lát cắt 023 — gửi thật qua worker

Migration `023_notification_delivery.sql` thêm `notification_provider_settings` (cấu hình nhà cung cấp mã hóa AES-GCM theo tổ chức + kênh, giới hạn tần suất, người nhập), `notification_deliveries` (tác vụ gửi: trạng thái, mã lý do, ngân sách lần thử, lease/fencing, lịch thử lại, số lần gửi lại, số lần worker lỗi) và `notification_channel_state` (token bucket và ngắt mạch theo tổ chức + kênh). Cả ba bảng FORCE RLS, quyền `noxh_app` suy ra theo [ADR 018](adr/018-least-privilege-runtime.md); trigger chặn xóa và chặn mở lại tác vụ đã kết thúc.

- **Adapter** (`notification-transports.ts`): `EmailSmtpAdapter` dùng `node:net`/`node:tls` (EHLO, STARTTLS bắt buộc hoặc TLS ngầm, xác minh chứng chỉ, TLS ≥ 1.2, AUTH PLAIN, tiêu đề mã hóa RFC 2047, thân base64, dot-stuffing); `ZaloOaAdapter` gọi endpoint cố định `business.openapi.zalo.me/message/template` với `appsecret_proof`, không theo redirect, giới hạn phản hồi 16 KB. Lỗi adapter chỉ mang mã ngắn (`smtp-451`, `http-503`, `timeout`), không mang địa chỉ, bí mật hay nội dung.
- **Người nhận**: email chỉ gửi tới `sinkAddress` diễn tập trong cấu hình nhà cung cấp vì nền tảng chưa có nguồn email đã xác minh của khách; Zalo dùng `sinkPhone` nếu có, nếu không dùng số điện thoại đã xác minh OTP (`phone_accounts`). Không có người nhận hợp lệ thì tác vụ vào hàng chờ lỗi `recipient_unavailable`.
- **Giới hạn và ngắt mạch**: token bucket theo `ratePerMinute` của tổ chức/kênh; thiếu token thì tác vụ được dời lịch (`rate_limited`), không tốn lần thử. Ba lỗi tạm hoặc kết quả không rõ liên tiếp (từ chối rõ không tính) mở ngắt mạch 30 giây nhân đôi tới tối đa 5 phút (`circuit_open`); gửi thành công đặt lại. Trạng thái hiển thị trong màn hình tác vụ.
- **Worker**: vòng lặp 5 giây, tối đa 10 tác vụ mỗi đợt, lease 30 giây; `/health/live` của worker trả bộ đếm (`claimed`, `delivered`, `failed`, `deadLettered`, `unknown`, `cancelled`, `rateLimited`, `circuitOpen`, `workerFailures`) không kèm định danh. Log có cấu trúc chỉ gồm id thư/tổ chức/dự án, kênh, kết quả và mã lý do. Lỗi xử lý bất ngờ dời lịch 30 giây, tối đa 5 lần rồi vào hàng chờ lỗi `processing_failed`. `--notifications-once` chạy thêm một đợt gửi.
- **Gửi lại**: người vận hành có `records_write` xác nhận gửi lại tác vụ trong hàng chờ lỗi với `If-Match` phiên bản tác vụ; chỉ khi thư còn ngân sách (tối đa 3 lần thử tổng cộng, tối đa 2 lần gửi lại) và kênh đang bật. Thư `outcome_unknown`, `delivered`, `cancelled` không bao giờ mở lại.
- **Chưa có**: địa chỉ email xác minh của khách, webhook/biên nhận từ nhà cung cấp, đối soát `outcome_unknown`, xoay vòng credential, kiểm thử tải và nghiệm thu nhà cung cấp thật. Mọi triển khai giữ cờ tắt.

## Tích hợp

API gốc là `/api/v1`:

| Vai trò          | Đường dẫn                                                       | Phương thức / phiên bản              |
| ---------------- | --------------------------------------------------------------- | ------------------------------------ |
| Nhân sự          | `/admin/notifications/projects/:project/workspace`              | GET, 100 mẫu và 100 thư mới nhất     |
| Nhân sự          | `/admin/notifications/projects/:project/templates`              | POST, khóa idempotency               |
| Rà soát pháp chế | `/admin/notifications/projects/:project/templates/:id/review`   | POST, `If-Match`                     |
| Nhân sự          | `/admin/notifications/projects/:project/queue`                  | POST, khóa idempotency               |
| Nhân sự          | `/admin/notifications/projects/:project/messages/:id/deliver`   | POST, `If-Match`, `{accepted:true}`  |
| Rà soát dữ liệu  | `/admin/notifications/projects/:project/transports`             | POST, `If-Match` (0 khi chưa có)     |
| Quản trị tổ chức | `/admin/notifications/providers`                                | GET, không trả bí mật                |
| Quản trị tổ chức | `/admin/notifications/providers/:channel`                       | POST, `If-Match` (0 khi chưa có)     |
| Nhân sự          | `/admin/notifications/projects/:project/deliveries`             | GET, 100 tác vụ gửi mới nhất         |
| Nhân sự          | `/admin/notifications/projects/:project/deliveries/:id/requeue` | POST, `If-Match`, `{accepted:true}`  |
| Khách            | `/citizen/notifications/workspace`                              | GET, 100 thư trong ứng dụng mới nhất |
| Khách            | `/citizen/notifications/projects/:project/preferences`          | POST, `If-Match` (0 khi chưa có)     |
| Khách            | `/citizen/notifications/messages/:id/read`                      | POST, `If-Match`, `{accepted:true}`  |

Quyền thường dùng `records_read` / `records_write` và phân công dự án hiện hành. Quản trị tổ chức có thể quản lý thông thường; các bước pháp chế/quyền riêng tư vẫn cần quyền chuyên trách hiện hành. Customer chỉ thấy quan hệ hồ sơ của chính mình. Migration có khóa ngoại tổ chức/dự án/người sở hữu, RLS bắt buộc và thu hồi toàn bộ quyền trực tiếp của `noxh_runtime`; tách vai trò runtime đúng quyền vẫn là chốt phát hành hạ tầng.

UI: `NotificationsAdmin({projects,staff?})` và `NotificationsCustomer()`, tích hợp module Nest, guard/BFF, điều hướng và OpenAPI. [Lát cắt021](COMPLETION-NOTIFICATION-AUTOMATION.md) bổ sung quy tắc được duyệt độc lập và outbox riêng cho đúng ba sự kiện yêu cầu bổ sung/chấp thuận/từ chối hồ sơ diễn tập. Consumer có giới hạn, kiểm lại đồng ý và chống trùng; mặc định tắt. Hợp đồng legacy `ChannelNotificationProvider` và bảng nền `outbox_events` giữ nguyên; không tự phát mọi sự kiện, hợp đồng hoặc tin hàng loạt.

## Kiểm chứng và giới hạn

`pnpm --filter @noxh/api exec vitest run src/notification.test.ts src/notification-delivery.test.ts src/notification-transports.test.ts` kiểm chứng CSDL PostgreSQL nhúng thật: duyệt độc lập, snapshot bất biến/mã hóa, idempotency/concurrent API retry, scope hai tổ chức, nhân viên bị đình chỉ, purpose/channel consent, rút rồi cấp lại quyền, kênh mặc định tắt, xác nhận đọc và xác thực controller; worker: thử lại có backoff rồi hàng chờ lỗi, gửi lại có giới hạn, từ chối rõ, timeout/im lặng là `outcome_unknown`, khóa idempotency ổn định, token bucket, ngắt mạch, hủy khi rút đồng ý/tắt kênh giữa chừng, phạm vi hai tổ chức, lease giả, worker lỗi, bí mật/địa chỉ/nội dung không xuất hiện trong log hay phản hồi; adapter chạy với máy chủ SMTP giả (STARTTLS/TLS ngầm, chứng chỉ tự ký tạo bằng `openssl` lúc chạy) và máy chủ Zalo giả trên `127.0.0.1`. Không có lời gọi nhà cung cấp thật trong kiểm thử; `NOXH_TEST_RUNTIME_ROLE=1` chạy toàn bộ SQL của service dưới `noxh_app`.

Đây là lát cắt tổng thể synthetic có giao diện và persistence; worker, adapter, giới hạn tần suất và ngắt mạch đã có mã và kiểm thử với nhà cung cấp giả, **chưa nghiệm thu với nhà cung cấp thật**. Cần hợp đồng API/nhà cung cấp đã xác minh, credential vault/rotation, biên nhận và webhook có xác thực/chống replay, quota theo nhà cung cấp, đối chiếu kết quả không rõ, nguồn email xác minh của khách, kiểm thử tải/thất bại PostgreSQL thật và chính sách retention trước khi mở kênh thật. Mặc định tắt.
