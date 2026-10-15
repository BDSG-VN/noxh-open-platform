# Cầu nối quyền thành viên cho dịch vụ quản lý

Bản tự triển khai vẫn dùng Keycloak và quyền nhân sự nội bộ như trước. Nhà cung cấp SaaS có thể chạy **một instance và bộ dữ liệu riêng cho mỗi tổ chức**, dùng chung hệ thống đăng nhập nhưng kiểm tra quyền thành viên qua cổng quản trị của mình.

`WORKFORCE_AUDIENCE` tùy chọn thay cho audience mặc định `noxh-api`. `WORKFORCE_CLIENT_ID`, issuer, JWKS, chữ ký RS256, thời hạn phiên và MFA vẫn bắt buộc. Không dùng issuer hay audience do trình duyệt gửi.

Nếu cấu hình `WORKFORCE_MEMBERSHIP_ENDPOINT` hoặc `WORKFORCE_MEMBERSHIP_KEY`, cả hai phải hợp lệ. Endpoint phải HTTPS, không có thông tin đăng nhập, query hay fragment. Khóa ngẫu nhiên riêng cho từng instance, tối thiểu 43 ký tự base64url, nằm trong secret phía máy chủ. Không đưa khóa vào mã nguồn, URL, trình duyệt hoặc log.

Sau khi xác minh JWT và trạng thái thu hồi cục bộ, API POST JSON `{organizationId, subject, tokenHash}` tới endpoint với Bearer của instance. `tokenHash` là SHA-256 của phiên, cho phép provider áp dụng đăng xuất tập trung; JWT không được gửi tiếp. Provider phải ràng buộc khóa với đúng tổ chức và kiểm tra membership/subscription hiện hành. Kết quả 200 JSON tối đa 4096 byte: `{organizationId, subject, active: true, role: "org_admin" | "staff", projectIds: []}`. Sai phạm vi, membership bị khóa hoặc phản hồi 401/403/404 đều từ chối truy cập. Lỗi mạng, phản hồi sai hoặc quá 3 giây trả 503; không quay về quyền realm và không cache quyền.

Trong chế độ này, quyền nhạy cảm từ realm bị bỏ qua. `org_admin` do provider xác nhận chỉ có phạm vi tổ chức cố định của instance. `staff` còn phải có hồ sơ nhân sự hoạt động và quyền dự án được chủ đầu tư cấp trong cơ sở dữ liệu instance. Phản hồi cần có `projectIds` (mảng UUID tối đa 100 phần tử): mảng rỗng giữ phạm vi nội bộ; mảng có giá trị giới hạn thêm theo provider. Nếu còn quyền dự án nội bộ nằm ngoài phạm vi provider, toàn bộ đăng nhập bị từ chối đến khi người vận hành đồng bộ lại quyền. Cách này bảo vệ cả những phân hệ tự đọc lại quyền dự án trong DB. Cổng provider không cấp quyền hồ sơ hoặc quyền dự án qua JSON tùy ý.

Đây là cầu nối phân quyền, không tự cung cấp thanh toán, máy chủ, sao lưu, cấu hình Zalo/AI hoặc phê duyệt pháp lý. Nhà cung cấp phải quản lý vòng đời các dịch vụ đó và kiểm tra sẵn sàng trước khi mở tiếp nhận thật. Mã lõi giữ giấy phép MIT; dịch vụ SaaS có thể có hợp đồng vận hành riêng.

## Cấp trách nhiệm nhạy cảm trong instance

Quản trị tổ chức đăng ký đúng `subject` từ hệ thống đăng nhập trong phân hệ Nhân sự, rồi cấp riêng quyền theo trách nhiệm. Danh mục gồm quyền điều hành nội bộ và các quyền biểu mẫu, bảo vệ dữ liệu, tiếp nhận/thẩm định/phê duyệt hồ sơ, rà soát giá và vận hành/giám sát bốc thăm diễn tập. Tên phòng ban không tự cấp quyền. `org_admin` do provider xác nhận có thể thiết lập instance khi chưa có hồ sơ nhân viên, nhưng mặc định không có quyền nhạy cảm; chỉ hồ sơ nhân viên đang hoạt động của đúng tổ chức và subject mới cung cấp các quyền này. Khóa hoặc xóa quyền nội bộ có hiệu lực ở lần xác thực tiếp theo. Trong chế độ tự triển khai, các quyền realm đã ký vẫn được hỗ trợ để tương thích cấu hình hiện có.

Cấp quyền không thay thế vai trò truy cập phân hệ: các phân hệ chỉ dành cho quản trị tổ chức vẫn yêu cầu `org_admin`; `staff` chỉ được vào các tuyến đã cho phép và dự án được giao. Người soạn không được tự phê duyệt trong các quy trình đã yêu cầu tách trách nhiệm. Các cổng vận hành thật, tích hợp và bốc thăm vẫn giữ điều kiện riêng, không được mở bằng việc cấp quyền.

Phạm vi dự án trong `Staff` được kiểm tra lại ở các thao tác điều hành và lọc danh mục. Việc cấp thêm quyền dự án cục bộ sau bước xác thực không mở rộng phạm vi của yêu cầu đang chạy. Quyền cục bộ hiện hành vẫn được đọc lại để xử lý việc thu hồi.
