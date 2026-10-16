# OCR nội bộ và hàng đợi xử lý giấy tờ (024)

Cập nhật 2026-10-17. Phần mềm phát triển, mặc định tắt. OCR nội bộ chưa được đánh giá chất lượng trên giấy tờ thật và chưa có bộ dữ liệu tiếng Việt được nghiệm thu; kết quả chỉ là gợi ý để người khai đối chiếu. Quyết định thiết kế ở [ADR 020](adr/020-self-hosted-ocr-queue.md).

## Luồng đã triển khai

1. Khách mở không gian giấy tờ của hồ sơ, chọn một giấy tờ **đã quét an toàn** và bấm “Đọc chữ trên giấy tờ (OCR nội bộ)” sau khi tick đồng ý riêng (`document-ocr-v1`). API ghi `consent_records` với mục đích `local-ocr:<giấy tờ>:<sha256>` và tạo tác vụ `pending`. Tệp cách ly/bị từ chối bị từ chối ngay; mỗi giấy tờ chỉ có một tác vụ đang hoạt động; tối đa 20 yêu cầu/giờ/người.
2. Worker (`node apps/api/dist/worker.js`, hoặc `--notifications-once` cho một lượt) nhận tác vụ bằng `FOR UPDATE SKIP LOCKED` với lease 60 giây, kiểm lại giấy tờ còn `clean` và đúng hash, đồng ý còn hiệu lực và thông báo bảo vệ dữ liệu hiện hành, giải mã tệp từ kho riêng và gửi byte đến `OCR_WORKER_URL/ocr` (ai-worker nội bộ) với hạn 30 giây.
3. ai-worker kiểm tra định dạng/kích thước/điểm ảnh/trang, rasterise PDF bằng `pdftoppm`, chạy `tesseract` (hoặc bộ đọc `fake` khi kiểm thử) rồi trả các dòng chữ với hộp bao, độ tin cậy, điểm chất lượng, bộ đọc/phiên bản và thời gian xử lý.
4. Worker khóa lại tác vụ theo lease (fencing), kiểm lại giấy tờ/đồng ý một lần nữa, mã hóa kết quả (AES-GCM, AAD gắn tổ chức/chủ sở hữu/tác vụ) và tạo một đề xuất `document_extractions` với `model='local-ocr:<engine>'`: mỗi dòng là một trường `lineN` có trang, đoạn chứng cứ và độ tin cậy, kèm cảnh báo đối chiếu và cảnh báo chất lượng thấp khi điểm dưới `OCR_QUALITY_THRESHOLD`.
5. Khách xem trạng thái (trang tự cập nhật 4 giây/lần khi còn tác vụ chờ), xem chữ đã đọc, hủy tác vụ đang chờ/đang chạy (kết quả đang bay bị loại bỏ, đồng ý mục đích được rút) và dùng đúng luồng “Đối chiếu thông tin được gợi ý” hiện có để kiểm tra và lưu từng dòng. Không có dữ liệu nào tự ghi vào bản khai.
6. `org_admin` xem `GET /api/v1/admin/ocr/queue` (số tác vụ theo trạng thái, tuổi tác vụ chờ lâu nhất, lease quá hạn, 20 thất bại gần nhất với mã lý do) và đưa lại hàng đợi một tác vụ `failed` bằng `POST /api/v1/admin/ocr/jobs/{job}/requeue` với `If-Match`, tối đa 3 lần thử và 2 lần đưa lại tổng cộng.

Mã lý do: `worker_unavailable`, `worker_timeout` (thử lại lũy thừa 15s/30s có jitter trong ngân sách), `worker_rejected`, `invalid_result` (cuối), `document_unavailable`, `consent_unavailable` (hủy), `attempts_exhausted`, `processing_failed` (tối đa 5 ngoại lệ worker), `cancelled_by_owner`, `requeued`. Log có cấu trúc và `/health/live` của worker chỉ mang định danh, mã và bộ đếm.

## Cấu hình

| Biến                                                                   | Mặc định                 | Ý nghĩa                                                                                   |
| ---------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------- |
| `LOCAL_OCR_ENABLED`                                                    | `false`                  | Bật ở API (nhận yêu cầu), worker (xử lý) và ai-worker (nhận `/ocr`). Giá trị khác lỗi.    |
| `OCR_WORKER_URL`                                                       | trống                    | URL http/https nội bộ của ai-worker; không userinfo/query. Worker từ chối khi thiếu.      |
| `OCR_QUALITY_THRESHOLD`                                                | `0.6`                    | Dưới ngưỡng này tác vụ được gắn cờ chất lượng thấp; không chặn kết quả.                   |
| `OCR_ENGINE`                                                           | `tesseract`              | `tesseract` hoặc `fake` (chỉ kiểm thử) trong ai-worker.                                   |
| `OCR_LANGUAGES`                                                        | `vie+eng`                | Danh sách `+`; chỉ ngôn ngữ có traineddata mới được dùng, không có thì ai-worker từ chối. |
| `OCR_MAX_BYTES`/`OCR_MAX_PIXELS`/`OCR_MAX_PAGES`/`OCR_TIMEOUT_SECONDS` | 5 MiB / 25 Mpx / 10 / 20 | Giới hạn đầu vào và thời gian tiến trình con.                                             |

Compose: `docker compose --profile ai --profile documents up --build` chạy ai-worker cùng ClamAV/MinIO; đặt `LOCAL_OCR_ENABLED=true` và `OCR_WORKER_URL=http://ai-worker:4100` trong `.env`. Ảnh `services/ai-worker` cài `tesseract-ocr`, `tesseract-ocr-vie`, `tesseract-ocr-eng`, `poppler-utils` và chạy không đặc quyền.

## Kiểm thử

- `services/ai-worker/test_ocr.py` (22 ca): hợp đồng `/ocr`, bộ đọc `fake` xác định, kiểm tra đầu vào nghiêm (rỗng, sai chữ ký, loại không hỗ trợ, PDF chủ động, quá kích thước, quá điểm ảnh, ảnh hỏng), ánh xạ lỗi/hết giờ không lộ chi tiết, không ghi log nội dung, phân tích TSV tesseract thành dòng và điểm chất lượng, kiểm tra danh sách ngôn ngữ, chạy tesseract thật trong sandbox với ngôn ngữ sẵn có, rasterise PDF nhiều trang và giới hạn trang, giới hạn khi thiếu `pdftoppm`.
- `apps/api/src/document-ocr.test.ts` (17 ca) trên PGlite với kho/scanner giả và ai-worker giả qua `node:http` trên `127.0.0.1`: cần đồng ý riêng và cờ triển khai; từ chối tệp cách ly/bị từ chối và không gọi worker; từ chối khác chủ sở hữu/tổ chức; một tác vụ đang hoạt động/giấy tờ; chạy đầy đủ với kết quả mã hóa, đề xuất `local-ocr`, không ghi bản khai và đường chấp nhận hiện có; cờ chất lượng thấp; claim/lease/fencing và hủy khi đang chạy loại bỏ kết quả; rút đồng ý giữa chừng; giấy tờ bị rút; thử lại rồi thất bại; hết giờ/từ chối/phản hồi lỗi; đưa lại hàng đợi có giới hạn chỉ cho `org_admin`; ngoại lệ worker 5 lần; lease hết hạn; cấu hình sai dừng an toàn; vòng đời worker chỉ lộ bộ đếm.
- `apps/api/src/runtime-privileges.test.ts` và các tệp trên chạy được với `NOXH_TEST_RUNTIME_ROLE=1` (vai trò `noxh_app`, migration 024).
- `apps/citizen-web/app/dossiers/[id]/document-workspace.test.tsx`: thẻ tác vụ chỉ cho hủy khi đang chờ/đang chạy, cảnh báo chất lượng thấp và diễn giải lý do bằng tiếng Việt.

## Giới hạn

- Chưa đánh giá độ chính xác trên CCCD, sổ hộ khẩu, giấy xác nhận viết tay hay bản scan mờ; chưa có bộ dữ liệu `vie` đối chiếu. Ảnh CI của kho chỉ có traineddata `eng`, nên kiểm thử tesseract thật dùng tiếng Anh.
- Kết quả là các dòng chữ, chưa tách trường theo mẫu (`fullName`, `identityNumber`...). Điểm chất lượng là ước lượng của bộ đọc, không phải xác suất đúng.
- Cô lập tiến trình chỉ gồm argv cố định, thư mục tạm riêng, môi trường tối thiểu, hạn thời gian và giới hạn kích thước; chưa có cgroup/seccomp.
- PDF cần `pdftoppm`; không có thì chỉ ảnh PNG/JPEG. PDF nhiều hơn `OCR_MAX_PAGES` bị từ chối chứ không cắt bớt.
- Chưa kiểm thử tải với PostgreSQL thật và nhiều worker. Cổng a11y có thêm trang `/dossiers/{id}?tab=documents` với giấy tờ sạch và một tác vụ OCR chất lượng thấp trong API giả (xem VALIDATION.md).
