# ADR 019 — Gửi email/Zalo do worker đảm nhiệm, có giới hạn và mặc định tắt

Ngày: 2026-10-17 · Chấp nhận cho diễn tập tổng hợp; chưa nghiệm thu nhà cung cấp thật.

## Bối cảnh

Lát cắt 019 có hợp đồng adapter nhưng gửi ngay trong yêu cầu HTTP xác nhận phát, giữ khóa tổ chức trong lúc chờ nhà cung cấp và chỉ cho người vận hành bấm thử lại bằng tay. Chưa có adapter thật, chưa có giới hạn tần suất, ngắt mạch hay hàng chờ lỗi. Nhà cung cấp thật trả lỗi tạm, giới hạn tốc độ và đôi khi im lặng; gửi trùng hay gửi ngoài đồng ý là rủi ro trực tiếp với khách hàng.

## Quyết định

- Hai adapter được rà soát nằm trong mã nguồn và chỉ được tiến trình API/worker gắn lúc khởi động theo biến môi trường: `email-smtp` (`node:net`/`node:tls`, STARTTLS hoặc TLS ngầm bắt buộc, xác minh chứng chỉ, máy chủ phải thuộc `NOTIFICATIONS_SMTP_ALLOWED_HOSTS`) và `zalo-oa` (endpoint cố định HTTPS, không theo redirect, giới hạn phản hồi). Trình duyệt không bao giờ chọn endpoint; adapter không nhận URL từ cơ sở dữ liệu.
- Cấu hình nhà cung cấp theo tổ chức và kênh do `org_admin` nhập, được adapter kiểm tra theo chính sách vận hành rồi mã hóa AES-GCM với AAD gắn tổ chức/kênh; phản hồi và log không bao giờ chứa bí mật. Bật kênh cho dự án vẫn cần `privacy_officer` hiện hành và **khác** người nhập cấu hình.
- Xác nhận phát kênh ngoài chỉ tạo tác vụ `notification_deliveries`. Worker nhận bằng lease có fencing, kiểm lại đồng ý, lựa chọn, mẫu, hồ sơ, khách, cấu hình kênh ngay trước khi gửi; mỗi lời gọi adapter có hạn 8 giây. Từ chối rõ là cuối; lỗi tạm thử lại lũy thừa có jitter trong ngân sách được duyệt (tối đa 3 lần tổng cộng); im lặng hoặc lỗi không phân loại là `outcome_unknown` và không bao giờ tự thử lại.
- Token bucket và ngắt mạch theo tổ chức + kênh nằm trong cơ sở dữ liệu, tuần tự hóa bằng khóa hàng; dời lịch không tốn lần thử. Hàng chờ lỗi chỉ mở lại bằng thao tác gửi lại có xác nhận, `If-Match` và giới hạn (tối đa 2 lần, kênh phải đang bật).
- Người nhận email chỉ là hộp thư diễn tập trong cấu hình vì nền tảng chưa có email xác minh của khách; Zalo dùng số diễn tập hoặc số đã xác minh OTP. Chỉ dự án và hồ sơ tổng hợp. Mọi bảng mới FORCE RLS và quyền runtime suy ra theo ADR 018.
- Cờ `NOTIFICATIONS_EXTERNAL_ENABLED` mặc định tắt và worker cần `AUTH_ORGANIZATION_ID` rõ; không có chế độ gửi hàng loạt hay tự kích hoạt theo mọi sự kiện.

## Hệ quả

- Lỗi nhà cung cấp không còn gắn với yêu cầu của người vận hành; trạng thái tác vụ, mã lý do và bộ đếm trên `/health/live` của worker đủ để vận hành mà không lộ địa chỉ hay nội dung.
- Gửi trùng khi tiến trình chết sau khi nhà cung cấp chấp nhận nhưng trước COMMIT vẫn phụ thuộc nhà cung cấp tôn trọng khóa idempotency (`Message-ID`, `tracking_id`); điều này chưa được chứng minh với nhà cung cấp thật và là điều kiện nghiệm thu.
- Chưa có: webhook/biên nhận có xác thực, đối soát `outcome_unknown`, xoay vòng credential, nguồn email xác minh, kiểm thử tải với PostgreSQL thật. Mọi triển khai giữ cờ tắt cho tới khi nghiệm thu riêng. Phạm vi và các ca kiểm tra nằm trong [hướng dẫn thông báo](../COMPLETION-NOTIFICATIONS.md#lát-cắt-023--gửi-thật-qua-worker).
