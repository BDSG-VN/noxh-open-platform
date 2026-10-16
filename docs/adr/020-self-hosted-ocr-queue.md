# ADR 020 — OCR tự triển khai qua hàng đợi worker, mặc định tắt

Ngày: 2026-10-17 · Chấp nhận cho diễn tập tổng hợp; chưa đánh giá chất lượng trên giấy tờ thật.

## Bối cảnh

Trích xuất giấy tờ hiện chỉ có đường OpenAI (ADR 013): phải bật `EXTERNAL_AI_ENABLED`, khách đồng ý gửi tệp ra ngoài và tổ chức tự chịu chính sách lưu giữ của nhà cung cấp. Nhiều đơn vị không được phép đưa giấy tờ nhân thân ra khỏi hạ tầng của mình. Dịch vụ `services/ai-worker` từ Sprint 0 chỉ là vỏ FastAPI từ chối mọi tài liệu. Cần một đường đọc chữ chạy hoàn toàn trên máy chủ của tổ chức, tái dùng kho giấy tờ mã hóa, quét an toàn và luồng đề xuất/xác nhận đã có, với mô hình worker lease/fencing/thử lại của ADR 019.

## Quyết định

- `ai-worker` có `POST /ocr` nhận thẳng byte PNG/JPEG/PDF, kiểm tra chữ ký định dạng, kích thước, số điểm ảnh, số trang và PDF chủ động trước khi chạy. Hai bộ đọc chung một hợp đồng: `tesseract` (tiến trình con cố định argv, không shell, thư mục tạm riêng, môi trường tối thiểu, hạn thời gian, danh sách ngôn ngữ từ `OCR_LANGUAGES` giao với traineddata có sẵn) và `fake` (xác định theo hash đầu vào, dùng cho kiểm thử và ảnh CI không có traineddata). PDF được rasterise bằng `pdftoppm`; không có poppler thì PDF bị từ chối với mã `pdf-rasteriser-unavailable`. Kết quả gồm các dòng chữ có hộp bao, độ tin cậy từng dòng, điểm chất lượng (trung bình độ tin cậy có trọng số độ dài), bộ đọc/phiên bản và thời gian xử lý. Không ghi log nội dung hay byte; lỗi chỉ là mã lớp.
- Bảng `identity_private.document_ocr_jobs` (migration 024) giữ một tác vụ đang hoạt động cho mỗi giấy tờ, với tổ chức/hồ sơ/giấy tờ/chủ sở hữu, hash nguồn, đồng ý mục đích riêng `document-ocr-v1`, trạng thái `pending/running/succeeded/failed/cancelled`, ngân sách tối đa 3 lần thử, tối đa 2 lần đưa lại hàng đợi, lease có fencing, `next_attempt_at`, điểm chất lượng, cờ chất lượng thấp, kết quả mã hóa AES-GCM với AAD gắn tổ chức/chủ sở hữu/tác vụ và chỉ mã lý do ở dạng rõ. Trigger giữ danh tính bất biến, trạng thái cuối và kết quả không sửa được; FORCE RLS với hai chính sách `noxh_app` và quyền cột suy ra theo ADR 018.
- Khách chỉ yêu cầu OCR cho giấy tờ `scan_status='clean'` của chính mình, sau khi tick đồng ý riêng; tệp cách ly hoặc bị từ chối không bao giờ được gửi. Khách xem trạng thái, hủy khi đang chờ hoặc đang chạy (lease bị xóa nên kết quả đang bay bị loại bỏ, đồng ý mục đích được rút) và xem chữ đã đọc. Rút đồng ý xử lý chung cũng rút các đồng ý `local-ocr:*`.
- Worker (`apps/api/src/worker.ts`) nhận tác vụ bằng `FOR UPDATE SKIP LOCKED` trong tổ chức `AUTH_ORGANIZATION_ID`, kiểm lại giấy tờ/hash/đồng ý/thông báo bảo vệ dữ liệu ngay trước và ngay sau khi gọi `OCR_WORKER_URL` (http/https cố định từ cấu hình triển khai, không nhận URL từ cơ sở dữ liệu hay trình duyệt) với hạn 30 giây và phản hồi tối đa 2 MiB, rồi ghi kết quả mã hóa và một đề xuất `document_extractions` có `model='local-ocr:<engine>'`. Đường chấp nhận từng trường hiện có không đổi; không có trường nào tự ghi vào bản khai. Lỗi tạm (không kết nối, 5xx/429, quá hạn) thử lại lũy thừa có jitter trong ngân sách; từ chối rõ (4xx) hoặc phản hồi không hợp lệ là cuối. Ngoại lệ worker đưa tác vụ về hàng đợi tối đa 5 lần rồi thất bại.
- Người vận hành (`org_admin`) xem sức khỏe hàng đợi bằng bộ đếm/mã lý do và đưa lại hàng đợi một tác vụ thất bại với `If-Match` trong ngân sách. Không có chế độ OCR hàng loạt, không tự chạy cho mọi tệp tải lên.
- Cờ `LOCAL_OCR_ENABLED` mặc định tắt ở API, worker và ai-worker; `OCR_QUALITY_THRESHOLD` (mặc định 0,6) chỉ gắn cờ cảnh báo, không chặn kết quả.

## Hệ quả

- Giấy tờ không rời hạ tầng của tổ chức; tổ chức tự chịu trách nhiệm đóng gói traineddata `vie` và poppler trong ảnh `ai-worker` (Dockerfile đã cài, ảnh CI của kho chỉ có `eng`).
- Chất lượng OCR trên giấy tờ Việt Nam thật (CCCD, sổ hộ khẩu, giấy xác nhận viết tay) chưa được đánh giá; chưa có bộ dữ liệu `vie` chuẩn và chưa có tách trường theo mẫu — kết quả là các dòng chữ, không phải trường có nghĩa. Điểm chất lượng là ước lượng của bộ đọc, không phải xác suất đúng.
- Chưa có: nhận dạng theo mẫu/khóa trường, hàng đợi ưu tiên, giới hạn tài nguyên cấp tiến trình (cgroup/seccomp) ngoài hạn thời gian và kích thước, kiểm thử tải với PostgreSQL thật, nghiệm thu trên thiết bị quét của đơn vị. Mọi triển khai giữ cờ tắt cho tới khi nghiệm thu riêng. Phạm vi và ca kiểm tra trong [hướng dẫn OCR](../COMPLETION-OCR.md).
