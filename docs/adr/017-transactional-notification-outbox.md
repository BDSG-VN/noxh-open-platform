# ADR 017 — Thông báo nghiệp vụ gắn với giao dịch nguồn

Ngày: 2026-10-16 · Chấp nhận cho diễn tập tổng hợp.

## Bối cảnh

Hồ sơ đã đổi trạng thái nhưng hàng đợi thủ công chưa đảm bảo khách nhận được thông báo tương ứng. Gửi ngay trong giao dịch sẽ gắn lỗi nhà cung cấp với quyết định hồ sơ; gửi sau commit mà không có outbox có thể mất sự kiện.

## Quyết định

Ba thao tác yêu cầu bổ sung, chấp thuận và từ chối lưu sự kiện riêng cùng giao dịch nguồn, trước khóa audit. Consumer dùng lease có fencing, idempotency và giao dịch nguyên tử để ghi hộp thư mã hóa. Metadata sự kiện không chứa lý do từ chối hoặc giấy tờ.

Quy tắc phải có pháp chế độc lập duyệt mẫu trong ứng dụng. Sự kiện ghim quyền, mẫu, thông báo quyền riêng tư và lựa chọn nhận tin tại thời điểm nguồn; consumer kiểm lại trước khi commit. Cấp quyền hoặc đồng ý sau đó không hồi sinh sự kiện đã bỏ qua. Claim có giới hạn, tối đa ba lần; không có API gửi hoặc retry từ trình duyệt.

Cờ triển khai mặc định tắt. Chỉ dự án và hồ sơ tổng hợp được xử lý; chỉ kênh `in_app`, mục đích `transactional`. Bật consumer phải cấu hình một tổ chức rõ ràng. Email, Zalo, nhắc lịch và thông báo pháp lý chính thức chưa thuộc consumer này.

## Hệ quả

Migration 021 thêm bảng riêng và khóa quyền DB mặc định. Chạy thử cần PostgreSQL tách biệt; không seed thay đồng ý của khách. Mọi triển khai giữ cờ tắt cho tới khi quy trình cụ thể được nghiệm thu. Phạm vi, giới hạn và các ca kiểm tra nằm trong [hướng dẫn 021](../COMPLETION-NOTIFICATION-AUTOMATION.md).
