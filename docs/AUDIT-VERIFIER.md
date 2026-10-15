# Kiểm chứng chuỗi nhật ký bằng Rust

`crates/audit-verifier` cung cấp thư viện và chương trình `audit-verifier` để kiểm chứng **bản xuất được cung cấp**, hoàn toàn ngoại tuyến. Giao thức băm khớp với `auditHash` trong `apps/api/src/audit.ts`; chương trình không truy cập cơ sở dữ liệu, mạng hoặc khóa bí mật.

**Kết quả hợp lệ chỉ chứng minh các bản ghi được cung cấp có cấu trúc và liên kết băm nhất quán.** Nó không chứng minh tác giả, thời điểm thực, tính đầy đủ, chữ ký số hoặc kết luận kiểm toán độc lập. Một người kiểm soát dữ liệu có thể viết lại cả chuỗi và tính lại các băm. Một tiền tố hợp lệ bị cắt đuôi vẫn hợp lệ nếu không có mốc đối chiếu đáng tin cậy được lưu bên ngoài hệ thống. Đây là giới hạn của giao thức hiện có, không được giải quyết bằng việc chuyển ngôn ngữ sang Rust.

## Giao diện chương trình

Biên dịch và chạy từ gốc kho:

```sh
cargo build --release -p audit-verifier --locked
./target/release/audit-verifier < crates/audit-verifier/tests/fixtures/node-golden.json
```

Chương trình không nhận đối số hay đường dẫn tệp. Nó đọc duy nhất JSON UTF-8 từ stdin, trả đúng một đối tượng JSON xuống stdout rồi thoát. Không in nội dung bản ghi hoặc lỗi parser vào stderr. Không dùng shell để nội suy dữ liệu khi tích hợp từ API; truyền trực tiếp vào stdin của tiến trình con, với giới hạn thời gian và kiểm tra mã thoát.

Đầu vào có hai khóa bắt buộc:

| Khóa                     | Nội dung                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `expectedOrganizationId` | UUID chữ thường của tổ chức cần kiểm tra; lấy từ phạm vi đã xác thực khi dùng trong API |
| `events`                 | Toàn bộ các sự kiện của tổ chức theo thứ tự `sequence` tăng dần, bắt đầu từ sự kiện gốc |

Mỗi sự kiện có các trường chuỗi bắt buộc `id`, `organization_id`, `actor_ref`, `action`, `resource_ref`, `occurred_at`, `prev_hash`, `event_hash`; chỉ cho phép thêm trường `sequence` tùy chọn. Không nhận khóa lạ, khóa lặp, giá trị thiếu, `null` hay kiểu dữ liệu khác thay cho các chuỗi bắt buộc.

`sequence` phải có ở tất cả sự kiện hoặc không có ở sự kiện nào. Chấp nhận số nguyên JSON dương trong khoảng số nguyên chính xác của JavaScript, hoặc chuỗi số thập phân chuẩn dương không có dấu/khoảng trắng/số 0 ở đầu, tối đa `9223372036854775807`. Với BIGSERIAL của PostgreSQL nên xuất dạng chuỗi để tránh mất chính xác. Các số tăng nghiêm ngặt nhưng không cần liên tiếp vì nhiều tổ chức dùng chung bộ đếm. Chuỗi `sequence: "9007199254740993"` được giữ chính xác; số JSON tương ứng bị từ chối.

Thành công, mã thoát `0`:

```json
{
  "valid": true,
  "checked": 3,
  "head": "f2e361bf491cb0056e1f8dfab51bf8da7fc26ec0b0fafc81de57f3720d711ff8"
}
```

Không hợp lệ, mã thoát `1`, ví dụ:

```json
{
  "valid": false,
  "code": "HASH_MISMATCH",
  "checked": 1,
  "brokenAt": "70000000-0000-4000-8000-000000000002"
}
```

`checked` khi thất bại là số sự kiện đứng trước lỗi đã qua kiểm tra. `brokenAt` chỉ được trả nếu mã sự kiện là UUID đúng cấu trúc; không phản chiếu đầu vào không hợp lệ. Lỗi trước khi xác định sự kiện có `checked: 0` và không có `brokenAt`.

Các mã lỗi ổn định: `INPUT_TOO_LARGE`, `MALFORMED_INPUT`, `TOO_MANY_EVENTS`, `INVALID_ORGANIZATION`, `INVALID_EVENT`, `WRONG_ORGANIZATION`, `DUPLICATE_EVENT_ID`, `INVALID_TIMESTAMP`, `MIXED_SEQUENCE`, `INVALID_SEQUENCE`, `BROKEN_LINK`, `HASH_MISMATCH`, `INVALID_ARGUMENTS`, `READ_ERROR`.

## Kiểm tra và giới hạn

- Tối đa **2.000.000 byte** JSON đầu vào; stdin chỉ được đọc đến byte thứ 2.000.001 để phát hiện vượt ngưỡng.
- Tối đa **10.000 sự kiện**; trường văn bản `actor_ref`, `action`, `resource_ref` không rỗng và tối đa 16.384 byte mỗi trường. Cả giới hạn byte lẫn số lượng đều áp dụng.
- ID sự kiện và tổ chức là UUID dạng chữ thường; mỗi ID sự kiện chỉ xuất hiện một lần; mọi sự kiện thuộc đúng tổ chức yêu cầu.
- Băm là 64 ký tự hệ thập lục phân chữ thường. `prev_hash` của sự kiện đầu phải là 64 số `0`; các sự kiện sau nối đúng `event_hash` của sự kiện trước. Chương trình không tự sắp xếp, sửa hoặc chuẩn hóa dữ liệu để làm cho chuỗi hợp lệ.
- `occurred_at` phải đúng dạng UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, ngày thực trong lịch, không nhận múi giờ khác, độ chính xác khác hoặc giây nhuận. Không sắp xếp theo thời gian: đồng hồ hệ thống có thể lùi; thứ tự do chuỗi và bộ đếm xác định. Điều này không xác thực thời điểm được ghi.
- JSON UTF-8 phải hợp lệ. Không chuẩn hóa Unicode hoặc bỏ khoảng trắng bên trong chuỗi. Unicode tổ hợp, ký tự ngoài BMP, dấu tiếng Việt và các ký tự điều khiển JSON hợp lệ được băm theo đúng byte UTF-8 tương ứng. UTF-16 surrogate đơn lẻ bị từ chối; PostgreSQL UTF-8 không lưu được loại chuỗi không hợp lệ này.
- Chuỗi rỗng trả `valid: true`, `checked: 0`, `head` bằng 64 số `0`; kết quả này không chứng minh tổ chức thực sự chưa có hoạt động.

Tiền ảnh băm chính xác là UTF-8 của kết quả Node:

```js
JSON.stringify([
  'audit-v1',
  event.id,
  event.organization_id,
  event.actor_ref,
  event.action,
  event.resource_ref,
  event.occurred_at,
  event.prev_hash,
]);
```

Dùng SHA-256, kết quả hex chữ thường. `sequence` và `event_hash` **không nằm trong tiền ảnh băm của giao thức Node hiện tại**. Kiểm tra tăng dần của `sequence` chỉ xác minh tính nhất quán của metadata được cung cấp; không thể xác thực lại giá trị bộ đếm gốc nếu nó bị thay đổi nhưng vẫn tăng dần. Muốn ràng buộc thêm trường hoặc thêm chữ ký cần phiên bản giao thức mới và kế hoạch di chuyển rõ ràng.

Không sử dụng kết quả trên một trang dữ liệu, danh sách 100 sự kiện gần nhất hoặc bản xuất bị giới hạn để tuyên bố đã kiểm tra toàn bộ nhật ký. API phải lấy bản xuất nhất quán, đầy đủ cho đúng tổ chức; khi vượt ngưỡng hoặc Rust không chạy được phải báo chưa kiểm chứng. Quyền quản trị, bảo vệ dữ liệu cá nhân của bản xuất và chính sách lưu trữ vẫn do API kiểm soát.

## Bằng chứng tương thích Node / Rust

Fixture `crates/audit-verifier/tests/fixtures/node-golden.json` được tạo bằng hàm `auditHash` thực tế của API, với dữ liệu tổng hợp có dấu tiếng Việt, emoji, Unicode tổ hợp, dấu nháy, dấu gạch chéo, ký tự điều khiển và U+2028/U+2029. Không có dữ liệu cá nhân thật. Sinh lại sau khi thay đổi giao thức có chủ đích:

```sh
node --import tsx crates/audit-verifier/tests/fixtures/generate-node-fixture.ts
cargo test -p audit-verifier --locked
cargo fmt -p audit-verifier -- --check
```

Bộ test còn chạy Node thật bằng `node:crypto` và `JSON.stringify` để so sánh trực tiếp với Rust. Node.js phải có trên PATH khi chạy bộ test. Các trường hợp kiểm thử gồm sửa dữ liệu, tính lại băm ở giữa chuỗi, mất/reorder bản ghi, sai tổ chức, ID trùng, JSON sai cấu trúc, số sequence không chính xác, mốc thời gian không chuẩn, ngưỡng byte/số lượng và lỗi CLI. Một test riêng chứng minh giới hạn cắt đuôi: tiền tố vẫn hợp lệ nhưng có `head` khác, cần mốc bên ngoài đã được tin cậy để phát hiện.
