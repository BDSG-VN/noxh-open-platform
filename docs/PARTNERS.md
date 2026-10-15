# Đối tác truyền thông và tư vấn

BDSG Foundation · MIT · Cổng `apps/partner-console`, mặc định `http://localhost:3004`. Không cần tài khoản mạng quảng cáo để dùng luồng nội bộ. Không tự gửi tin nhắn, email, đăng quảng cáo hoặc chi tiền trên Facebook/Zalo.

## Vận hành

1. Chủ đầu tư đăng nhập Keycloak + TOTP vào admin, mở **Đối tác & marketing**, thêm đơn vị, tên/số điện thoại quản lý và các dự án được giao.
2. Quản lý đơn vị vào cổng đối tác, xác thực số đã cấp qua Zalo OTP; backend tra membership đang hoạt động. Người không được cấp quyền không vào được bảng điều khiển dù xác thực điện thoại thành công.
3. Quản lý thêm nhân viên, chọn vai trò và có thể khóa quyền. Chủ đầu tư cũng có quyền quản lý nhân viên của đơn vị.
4. Quản lý đơn vị/quản lý chiến dịch soạn nội dung cho dự án được giao, chọn kênh và gửi chủ đầu tư duyệt. Bản nháp/chờ duyệt không mở trang tư vấn công khai. Chủ đầu tư duyệt, yêu cầu sửa hoặc dừng. Sửa chiến dịch đã duyệt đưa về bản nháp và tắt trang công khai cho đến khi duyệt lại. Dự án của chiến dịch được cố định sau khi tạo; muốn chuyển dự án phải tạo chiến dịch mới, không mang liên hệ đã consent sang dự án khác.
5. Sau khi duyệt, đối tác sao chép đường dẫn `/tu-van/<campaign UUID>` tại cổng khách hàng. Khách đọc tên đơn vị nhận thông tin, đăng nhập số điện thoại và đồng ý riêng trước khi chia sẻ họ tên, liên hệ đã xác thực và câu hỏi.
6. Quản lý phân công yêu cầu cho chuyên viên. Chuyên viên chỉ thấy khách được giao cho mình, cập nhật đang tư vấn/chờ khách bổ sung/đã kết thúc và ghi chú nội bộ. Đây không phải trạng thái xét điều kiện hoặc duyệt hồ sơ NOXH.
7. Khách theo dõi và dừng chia sẻ tại dashboard. Hệ thống xóa ciphertext liên hệ trong bản ghi chia sẻ và ghi rút consent trong cùng transaction; API đối tác không đọc hoặc sửa được yêu cầu đã rút. Metadata/audit không chứa nội dung liên hệ. Không thể thu hồi bản sao một bên đã tự tải/ghi ngoài hệ thống; chính sách vận hành/retention cần được phê duyệt trước khi dùng thật.

## Ma trận quyền thực thi trên máy chủ

| Thao tác                            | Chủ đầu tư                                          | Quản lý đơn vị                      | Quản lý chiến dịch                  | Chuyên viên                   |
| ----------------------------------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------- | ----------------------------- |
| Tạo/khóa đơn vị, giao/thu hồi dự án | Có                                                  | Không                               | Không                               | Không                         |
| Cấp/đổi vai trò/khóa nhân viên      | Có                                                  | Trong đơn vị                        | Không                               | Không                         |
| Soạn/gửi chiến dịch                 | Duyệt, dừng                                         | Trong dự án được giao               | Trong dự án được giao               | Chỉ đọc chiến dịch của đơn vị |
| Duyệt chạy truyền thông             | Có                                                  | Không                               | Không                               | Không                         |
| Xem liên hệ đã được khách đồng ý    | Chỉ thống kê, không mở nội dung liên hệ ở admin này | Trong đơn vị và dự án còn được giao | Trong đơn vị và dự án còn được giao | Chỉ yêu cầu được giao mình    |
| Phân công yêu cầu                   | Không ở phân hệ admin này                           | Có                                  | Có                                  | Không                         |
| Cập nhật tiến độ tư vấn             | Không ở phân hệ admin này                           | Có                                  | Có                                  | Yêu cầu được giao mình        |
| Mở bản khai/giấy tờ riêng của khách | Không được cấp qua quan hệ đối tác                  | Không                               | Không                               | Không                         |

Không tin role, partnerId, phone hoặc ownerId do trình duyệt tự khai. Membership gắn HMAC của số điện thoại đã xác thực; mỗi số có một đơn vị trong một tổ chức ở phiên bản này. Đổi số/chuyển đơn vị cần quy trình xác minh riêng, chưa hỗ trợ tự động. Khóa nhân viên/đối tác hoặc thu hồi dự án có hiệu lực tại API tiếp theo, không chỉ ẩn nút. Không được xóa/demote quản lý đơn vị cuối cùng đang hoạt động. Các thay đổi dùng If-Match, transaction và audit. Danh mục và danh sách tư vấn hiện giới hạn 200 bản ghi mỗi truy vấn; cần bổ sung phân trang cho triển khai lớn.

BFF đối tác dùng cookie HttpOnly riêng `noxh_partner`, CSRF exact-origin và danh sách đường dẫn cho phép. Core session dựa trên OTP, các vai trò chỉ tra tại DB sau xác thực. Production cần triển khai HTTPS, quản trị MFA phù hợp và kiểm tra bảo mật/retention theo mô hình vận hành trước khi tiếp nhận dữ liệu thật.

## Giới hạn hiện tại

Theo dõi chiến dịch gồm trạng thái duyệt, trang đích và số yêu cầu tư vấn đã consent. Chưa có ad-platform OAuth/spend, impression/click attribution, tự gửi quảng cáo, hoa hồng/hợp đồng hoặc phân bổ tài chính. Không có điểm chấm khách, máy quyết định đủ điều kiện, cam kết kết quả hay quyền ưu tiên xét duyệt từ đối tác.

Cấu hình `PARTNER_PUBLIC_ORIGIN` ở runtime BFF và `CITIZEN_PUBLIC_ORIGIN` ở runtime cho đường dẫn tư vấn công khai; mặc định localhost phục vụ demo. Khóa Zalo được chủ đầu tư quản lý tại admin. Không đưa khóa API vào biến `NEXT_PUBLIC_*` hoặc repository. Thêm tên miền cổng vào cấu hình TLS của triển khai thật.
