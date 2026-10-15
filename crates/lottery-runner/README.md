# Bộ xử lý bốc thăm Rust

`lottery-runner` là chương trình nhận một đối tượng JSON qua stdin và trả một
`LotteryResult` JSON qua stdout. Các trường đầu vào bắt buộc: `id`, `config`,
`secret`, `entropy`. Không nhận đối số dòng lệnh; không chấp nhận trường lạ,
JSON sai cấu trúc hoặc đầu vào vượt 2 MiB. Lỗi trả mã thoát 1 và thông báo cố
định trên stderr, không phản hồi nội dung đầu vào hay bí mật.

Chương trình gọi trực tiếp `lottery-engine::draw`: cùng ảnh chụp chuẩn hóa,
HKDF/HMAC, lấy mẫu loại bỏ và Fisher–Yates với vector kiểm thử Node/Python.
Chỉ cấu hình `synthetic: true` và mã hồ sơ giả lập được chấp nhận. Cổng này
không xác nhận đủ điều kiện pháp lý hay cho phép tổ chức bốc thăm thật.

API dùng `LOTTERY_ENGINE_BIN` là đường dẫn tuyệt đối đến binary. Trong Docker,
đường dẫn mặc định là `/opt/noxh/bin/lottery-runner`. Cả thực hiện và kiểm tra
lại kết quả đều gọi Rust; thiếu binary hoặc đầu ra không hợp lệ trả HTTP 503.
Không có phương án tự chuyển sang bộ máy Node trong môi trường vận hành.
Node chỉ được tiêm tường minh trong fixture kiểm thử đơn vị.

Chạy kiểm thử: `cargo test -p lottery-runner --locked`. Các bài kiểm tra gồm
kết quả chuẩn chính xác, JSON/trường sai, giới hạn kích thước, từ chối dữ liệu
thật và thay đổi dấu vết cam kết khi cấu hình bị thay đổi.
