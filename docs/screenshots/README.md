# Ảnh giao diện chạy thực tế

Ảnh chụp ứng dụng chạy thực tế, không dùng dữ liệu người thật. Các ảnh `*-v05.jpg` chụp bản tích hợp 2026-10-15: đăng nhập Keycloak/password/TOTP và điện thoại/OTP bằng dịch vụ cục bộ; có dữ liệu diễn tập ghi rõ. Ảnh đối tác từ kiểm tra v0.4 trước đó; phân hệ tiếp tục dùng cùng cơ chế phân quyền.

- investor-overview-v05.jpg: tổng quan chủ đầu tư, menu các phân hệ.
- investor-operations-v05.jpg: kế hoạch dự án 14 công việc, chờ rà soát nhánh áp dụng.
- investor-inventory-v05.jpg: bảng8căn và phương án giá minh họa, chưa mở bán.
- investor-applications-v05.jpg: hàng đợi12hồ sơ giả lập đã qua người đề xuất và người duyệt độc lập trong service integration.
- citizen-dashboard-v05.jpg: tài khoản khách, hồ sơ riêng, yêu cầu tư vấn và lựa chọn dữ liệu.
- citizen-privacy-v05.jpg: trạng thái đồng ý hiện hành, rút đồng ý và hạn chế trên tài khoản giả lập.
- investor-audit-v05.jpg: nhật ký được kernel Rust đối chiếu; không phải checkpoint ngoài máy.
- citizen-documents-v05.jpg: quy trình giấy tờ và mẫu PDF, chỉ dữ liệu giả lập.
- lottery-room-v05.jpg: phòng công khai12mã/8suất, kết quả đã lưu; chỉ trình chiếu, không chạy lại.
- partner-consultant.png / partner-consultant-mobile.png: chuyên viên chỉ đọc khách được giao.

Ảnh không chứng minh nghiệm thu pháp lý, bốc thăm thật, provider Zalo/OpenAI thật hoặc đồng bộ cơ quan nhà nước. Chi tiết bằng chứng kiểm tra tại ../VALIDATION.md; phần còn thiếu tại ../IMPLEMENTATION-MATRIX.md.

## Bản hoàn thiện 16/10/2026

Ảnh chụp production build qua BFF/API cục bộ, dữ liệu tổng hợp. Chín nhóm kiểm tra trình duyệt qua; màn hình admin kiểm ở 1440 px và 390 px. Identity, OpenAI, scanner và storage trong lượt này dùng test-double; ảnh không chứng minh provider hoặc hồ sơ pháp lý thật. Sáu màn hình admin được chụp lại sau khi chốt giao diện, phần cấu hình Mini App vẫn tắt và secret để trống.

- [completion-admin-knowledge-desktop.png](completion-admin-knowledge-desktop.png): Quản trị tri thức hướng dẫn AI — dữ liệu giả lập, phiên bản duyệt độc lập. (1440 × 2067 px)
- [completion-admin-checklists-desktop.png](completion-admin-checklists-desktop.png): Danh mục chuẩn bị hồ sơ có phiên bản — ví dụ giả lập, không quyết định điều kiện. (1440 × 3088 px)
- [completion-admin-tenancy-desktop.png](completion-admin-tenancy-desktop.png): Theo dõi hợp đồng thuê diễn tập — chưa phải giao kết hoặc thu tiền thật. (1440 × 1000 px)
- [completion-admin-audit-desktop.png](completion-admin-audit-desktop.png): Chuỗi nhật ký được Rust đối chiếu — chưa có checkpoint độc lập trong ví dụ. (1440 × 3772 px)
- [completion-admin-notifications-desktop.png](completion-admin-notifications-desktop.png): Thông báo trong ứng dụng: mẫu duyệt độc lập, hàng chờ và lịch sử diễn tập. (1440 × 1451 px)
- [completion-admin-zalo-miniapp-desktop.png](completion-admin-zalo-miniapp-desktop.png): Cấu hình Mini App: secret trống và tính năng chưa bật; không phải nghiệm thu Zalo thật. (1440 × 1000 px)
- [completion-admin-zalo-miniapp-mobile.png](completion-admin-zalo-miniapp-mobile.png): Cấu hình Mini App ở chiều rộng 390 px — dữ liệu giả lập, chưa bật đăng nhập thật. (390 × 1262 px)
- [completion-citizen-ai-form-proposal-desktop.png](completion-citizen-ai-form-proposal-desktop.png): Trợ lý đề xuất tạo PDF để khách xác nhận; dữ liệu và provider đều giả lập. (1440 × 2150 px)
- [completion-citizen-ai-form-proposal-mobile.png](completion-citizen-ai-form-proposal-mobile.png): Đề xuất AI trên màn hình 390 px; chưa tạo PDF cho tới khi khách xác nhận. (390 × 4410 px)
- [completion-citizen-contract-ack-desktop.png](completion-citizen-contract-ack-desktop.png): Khách đã kiểm tra hợp đồng thuê diễn tập; không phải chữ ký hay giao dịch tiền thật. (1440 × 3261 px)
- [completion-citizen-inbox-contract-mobile.png](completion-citizen-inbox-contract-mobile.png): Hộp thư, tùy chọn nhận tin riêng từng mục đích và hợp đồng diễn tập trên màn hình nhỏ. (390 × 5250 px)

Không công khai tài khoản, script seed, bản khai người thật hoặc PDF đã điền. [Bằng chứng và giới hạn kiểm tra](../VALIDATION.md).
