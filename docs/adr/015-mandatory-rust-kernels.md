# ADR 015 — Ba bộ xử lý Rust bắt buộc trong runtime

Trạng thái: chấp nhận ngày 2026-10-15 theo yêu cầu chủ dự án. Áp dụng cho bản tích hợp v0.5, vẫn giữ các cổng diễn tập/triển khai thật.

## Bối cảnh và quyết định

Rust cần trực tiếp xử lý các nghiệp vụ xác định, thay vì chỉ tồn tại dưới dạng thư mục hay công cụ kiểm chứng tùy chọn. API NestJS tiếp tục giữ xác thực, phân quyền, scope tổ chức/dự án, khóa phiên bản, giao dịch và lưu trữ. Ba kết quả dưới đây bắt buộc đi qua binary Rust; không có biến môi trường bật fallback Node.

| Binary           | Lời gọi runtime                                             | Kiểm tra phía API                                                                                                            |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `lottery-runner` | `LotteryService`: thực hiện và tái lập khi xác nhận kết quả | Cấu trúc chặt, tập mã không thiếu/trùng, thứ hạng/suất/căn, thuật toán, snapshot, commitment, bí mật và entropy đúng đầu vào |
| `pricing-engine` | `InventoryService`: lập bảng giá                            | Số lượng/mã căn, phân số hệ số/giá, làm tròn và chứng cứ số học khớp dữ liệu đã khóa                                         |
| `audit-verifier` | `DossierService.audit`: kiểm chứng chuỗi `audit-v1`         | Kết luận/giới hạn số sự kiện, số đã kiểm tra và head cuối khớp chuỗi được cung cấp                                           |

`lottery-engine` là thư viện được runner và `lottery-verifier` dùng chung. CLI `lottery-verifier` tiếp tục phục vụ kiểm tra chứng cứ công khai ngoại tuyến. Bộ tham chiếu Node/Python được giữ để đối chiếu vector và kiểm thử chéo. Fixture đơn vị có thể tiêm bộ tham chiếu tường minh; cấu hình triển khai không tự chuyển sang bộ tham chiếu này. Tạo sự kiện và tính hash khi ghi audit hiện vẫn ở Node; quyết định này chuyển **kiểm chứng** audit sang Rust, không chuyển toàn bộ backend sang Rust.

Quyết định này thay mô tả placeholder trong [ADR 006](006-lottery-gates.md) và ghi nhận việc đã có kết quả/chứng cứ diễn tập so với trạng thái khởi đầu của [ADR 009](009-public-evidence.md). Nguyên tắc hạn chế dữ liệu công khai và các điều kiện pháp lý/kiểm toán trong hai ADR vẫn được giữ.

## Giao tiếp tiến trình và giới hạn

`apps/api/src/native-kernel.ts` chỉ nhận loại kernel cố định và chọn executable tương ứng; dùng `spawn` không qua shell, không nhận câu lệnh do người dùng gửi. Một lần chạy nhận JSON qua stdin và trả JSON qua stdout. Bí mật/entropy không nằm trong argv; cầu nối không ghi nội dung stdin, stdout hay stderr vào log. Tiến trình con chỉ nhận môi trường tối thiểu cho locale/backtrace, không kế thừa credential ứng dụng.

Đầu vào/đầu ra cầu nối tối đa **2.000.000 byte**; stderr được tiêu thụ với giới hạn 8.192 byte và không chuyển nội dung ra người dùng. Thời gian chờ mặc định 5 giây; `RUST_KERNEL_TIMEOUT_MS` chỉ chấp nhận số nguyên từ 100 đến 10.000 ms, giá trị khác dùng mặc định. Mỗi tiến trình API cho phép tối đa hai lời gọi cùng loại và tổng bốn lời gọi; vượt giới hạn trả 429. Timeout, lỗi tiến trình, JSON sai hoặc đầu ra không hợp lệ trả lỗi 503 đã lược bỏ chi tiết. Đây là giới hạn mỗi tiến trình API, chưa phải hàng đợi hay quota phân tán.

Runner bốc thăm chỉ nhận dữ liệu giả lập, dùng đúng giao thức canonical snapshot/HKDF/HMAC/rejection sampling/Fisher–Yates đã có vector chung. Thư viện tính giá dùng số nguyên `u128`, kiểm tra tràn và miền đầu vào hữu hạn; không nhận phương án giá hợp pháp từ cơ quan nhà nước thay cho chủ đầu tư. Verifier audit nhận tổ chức dự kiến và chuỗi có giới hạn, kiểm tra nội dung/liên kết; không xác nhận tác giả, chữ ký hay tính đầy đủ tuyệt đối của lịch sử.

## Xử lý lỗi và khả năng đọc nhật ký

Không có binary phù hợp hoặc không có kết quả hợp lệ thì không ghi kết quả bốc thăm/bảng giá; không đánh dấu hoàn thành rồi tính lại bằng Node. Lời gọi diễn ra trong giao dịch nghiệp vụ, nên lỗi không làm tiến trạng thái đã lưu.

Nhật ký cần tiếp tục đọc được để điều tra ngay cả khi verifier hỏng hoặc chuỗi quá giới hạn kiểm chứng online. Trong trường hợp đó, API trả bản ghi và `verification.valid: null`, `verification.engine: unavailable`, `checked: 0` cùng lý do; không hiển thị “hợp lệ”. Kết quả Rust phát hiện sai chuỗi là `valid: false`, `engine: rust`, khác với chưa thể kiểm chứng. Một kết quả `valid: true` chỉ nói chuỗi được đưa vào khớp giao thức; một tiền tố hợp lệ vẫn có thể qua kiểm tra nếu thiếu checkpoint/head tin cậy bên ngoài. Kiểm chứng online hiện giới hạn 10.000 sự kiện và 2.000.000 byte; chuỗi lớn cần quy trình kiểm chứng ngoại tuyến/checkpoint riêng, chưa tự triển khai ở đây.

## Build và triển khai

`rust-toolchain.toml` khóa **1.99.0**, profile minimal và rustfmt; dependency Rust khóa phiên bản và `Cargo.lock`. `pnpm native:build` gọi `cargo build --workspace --release --locked`; `pnpm build` và `pnpm check` dựng native trước các bước Node. CI cài cùng toolchain, chạy kiểm tra định dạng, kiểm thử Rust và các kiểm thử API gọi binary thật. Kết quả chạy cụ thể nằm trong [VALIDATION.md](../VALIDATION.md), không suy ra chỉ từ cấu hình CI.

Docker build nhiều tầng dùng `rust:1.99.0-bookworm`, biên dịch workspace rồi sao chép bốn CLI (`lottery-runner`, `lottery-verifier`, `pricing-engine`, `audit-verifier`) sang `/opt/noxh/bin/` trong image Node. Ba binary runtime được cấu hình bằng:

| Biến môi trường      | Mặc định trong image           |
| -------------------- | ------------------------------ |
| `LOTTERY_ENGINE_BIN` | `/opt/noxh/bin/lottery-runner` |
| `PRICING_ENGINE_BIN` | `/opt/noxh/bin/pricing-engine` |
| `AUDIT_VERIFIER_BIN` | `/opt/noxh/bin/audit-verifier` |

Chạy host cần binary đúng hệ điều hành/kiến trúc và **đường dẫn tuyệt đối**; đường dẫn tương đối bị từ chối. Ví dụ macOS/Linux, từ gốc kho:

```sh
rustup toolchain install 1.99.0 --profile minimal --component rustfmt
pnpm native:build
export LOTTERY_ENGINE_BIN="$PWD/target/release/lottery-runner"
export PRICING_ENGINE_BIN="$PWD/target/release/pricing-engine"
export AUDIT_VERIFIER_BIN="$PWD/target/release/audit-verifier"
pnpm --filter @noxh/api dev
```

`/health/ready` có trường `checks.rust`, kiểm tra ba đường dẫn tồn tại, là tệp và có quyền thực thi. Kiểm tra này không chạy vector, kiểm tra chữ ký binary hay chứng nhận phiên bản/thuật toán. Đơn vị triển khai phải bảo vệ tệp thực thi và biến môi trường, đồng thời chạy các kiểm thử native trước khi đưa vào phục vụ.

## Giới hạn và điều kiện phát hành

Rust không tự giải quyết tính hợp pháp của danh sách, đối tượng ưu tiên, cách làm tròn pháp lý, phương án giá, quy chế bốc thăm hay nguồn entropy. Bốc thăm/phân căn vẫn chỉ diễn tập với dữ liệu giả lập; entropy hiện được nhập theo quy trình diễn tập. Chưa có checkpoint ký số ngoài máy, xác thực beacon/biên bản thật hay chứng nhận kiểm toán độc lập cho vận hành bốc thăm thật.

Triển khai thật còn cần bộ mẫu/quy trình dự án được pháp chế duyệt, pilot, quyền DB tối thiểu, vận hành dữ liệu cá nhân, backup/DR ngoài máy và kiểm tra bảo mật độc lập. Zalo/OpenAI/API cơ quan nhà nước vẫn cần tài khoản, quyền tích hợp và nghiệm thu thực tế tương ứng. Quyết định này xác định kiến trúc đã có mã chạy, không tuyên bố hoàn tất 100% hay chứng nhận sẵn sàng production.
