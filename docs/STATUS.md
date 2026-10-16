# Bản tích hợp hoàn thiện luồng nghiệp vụ — 2026-10-16

Lõi migration 015–021 đã được hợp nhất vào main; bản 021 qua PR #5, merge `d932a9847ca0365c06e8c181afeef3fbfe972404`, từ source `ac3897827f914acdd92a3d5ee78944f620b9f859`. Migration 021 bổ sung ba thay đổi hồ sơ diễn tập tạo thông báo trong ứng dụng qua outbox giao dịch, quy tắc có người duyệt độc lập và lựa chọn nhận tin của khách. Mặc định tắt; không gửi email/Zalo. CI đạt 4/4 job; QA có 18 xác nhận CUA và 8 kiểm tra BFF, được ghi cùng giới hạn trong [VALIDATION.md](VALIDATION.md). Hợp nhất và kiểm thử không tự xác nhận đã nâng cấp dịch vụ đang chạy.

- Checklist preparation-v2 tính chứng cứ sạch và PDF đã xác nhận đúng phiên bản; checklist dự án có revision và pháp chế duyệt độc lập.
- Tri thức hướng dẫn có nguồn/phạm vi/hiệu lực; AI đề xuất PDF từ chứng cứ hiện hành, kiểm lại lúc xác nhận và tạo bản nháp trong giao dịch.
- Hợp đồng mua/thuê/thuê mua diễn tập; kỳ thu, đối soát, bàn giao, gia hạn/kết thúc/hoàn trả có quyền và người duyệt độc lập.
- Thông báo trong ứng dụng, mẫu được duyệt, lựa chọn mục đích/kênh, hàng đợi/lịch sử; adapter gửi ngoài chưa cài đặt.
- Xác minh Zalo phía máy chủ, challenge một lần, liên kết sau OTP mới; Mini App có bản khai, giấy tờ và bộ PDF dùng chung hồ sơ. Chưa nghiệm thu thiết bị/provider thật.
- Checkpoint Ed25519 ký ngoại tuyến, nhập khóa công khai ghim và Rust kiểm nhiều trang; gói khôi phục mã hóa có manifest/hash, kiểm tra PostgreSQL và kho tệp cô lập. Chưa thay quy trình giữ checkpoint/backup mới nhất ngoài máy.

Chi tiết và các giới hạn nằm trong [ADR 016](adr/016-governed-completion.md), [thông báo tự động 021](COMPLETION-NOTIFICATION-AUTOMATION.md), các tài liệu `COMPLETION-*.md` và [ma trận hiện hành](IMPLEMENTATION-MATRIX.md). Các điều kiện pháp lý, chữ ký, cơ quan liên thông, provider thật, quyền DB production, bảo mật độc lập và pilot chưa được chứng nhận hoàn tất.

## Phạm vi nền tảng v0.5

BDSG Foundation · MIT · cập nhật 2026-10-15. Mã nguồn đang được mở rộng theo yêu cầu chủ dự án; không công bố tỷ lệ hoàn thành 100% hoặc chứng nhận pháp lý/bảo mật.

Đã có mã triển khai cho các phân hệ: thông báo/đồng ý/quyền dữ liệu; giấy tờ riêng tư và quét an toàn; trích xuất OpenAI có xác nhận; PDF theo ánh xạ được duyệt và gói ZIP; tiếp nhận/bổ sung/thẩm định/quyết định/xem xét lại; nhân viên/phòng ban/quy trình/wiki/lưu trữ/sổ nội bộ; bảng hàng/hệ số giá/lượt chọn; tập hồ sơ bốc thăm, commitment/entropy/chứng nhận/công bố và verifier Node/Python/Rust. Hướng dẫn chi tiết trong README và ma trận nghiệm thu.

Runtime đã dùng ba bộ xử lý Rust bắt buộc: `lottery-runner` cho thực hiện/tái lập bốc thăm, `pricing-engine` cho tính giá số nguyên chính xác, `audit-verifier` cho kiểm chứng chuỗi nhật ký. NestJS vẫn xử lý phân quyền, giao dịch và lưu trữ; ghi hash sự kiện audit hiện thực hiện phía Node. Không có fallback Node khi các bộ xử lý Rust không sẵn sàng. Bốc thăm/tạo bảng giá dừng với 503 khi không có kết quả hợp lệ. Nhật ký vẫn đọc được nhưng thể hiện chưa kiểm chứng (`valid: null`, `engine: unavailable`); không tự coi lỗi hoặc quá giới hạn là chuỗi hợp lệ.

Toolchain được khóa **Rust 1.99.0** trong `rust-toolchain.toml`, CI và tầng build Docker. `pnpm build`/`pnpm check` dựng native trước Node; Docker chứa binary dưới `/opt/noxh/bin/`. Chạy host cần `pnpm native:build` và cấu hình đường dẫn tuyệt đối cho `LOTTERY_ENGINE_BIN`, `PRICING_ENGINE_BIN`, `AUDIT_VERIFIER_BIN`. Readiness kiểm tra ba tệp thực thi cùng Postgres/Redis/migrations, không thay kiểm thử hay chứng nhận thuật toán. Xem [ADR 015](adr/015-mandatory-rust-kernels.md) và [hướng dẫn chạy](../README.md).

Tích hợp thật chưa được nghiệm thu với Zalo/OpenAI/API cơ quan nhà nước. Bốc thăm và phân căn hiện chỉ diễn tập. Chưa có tài khoản API cơ quan để đồng bộ tự động. Danh mục nguồn/mẫu không đồng nghĩa đã rà soát mọi địa phương và mọi chế độ vốn/đối tượng; nhóm mới và quy định chuyển tiếp phải được pháp chế chốt. Sổ nội bộ chưa phải ERP/kế toán thuế đầy đủ. Runtime DB tối thiểu, ký số/checkpoint ngoài máy, rà soát bảo mật độc lập và pilot còn là điều kiện phát hành thật.

Kết quả kiểm tra bản tích hợp được cập nhật trong VALIDATION.md sau khi chạy, không suy ra từ việc có thư mục hoặc giao diện.

---

## Lịch sử v0.4

Phần dưới là ghi nhận tại thời điểm v0.4; các mục “Still missing” ở đây không phải danh sách thiếu hiện hành. Dùng phần v0.5 phía trên và [ma trận hiện hành](IMPLEMENTATION-MATRIX.md) để đánh giá bản tích hợp.

# v0.4 — Preparation, OpenAI, DVC and partner workspaces

BDSG Foundation · MIT. Development software; the full blueprint is **not complete**. See [implementation matrix](IMPLEMENTATION-MATRIX.md). Scope expanded by owner requests on 2026-10-15; the imported Sprint 0 limit is historical.

Implemented: v0.2 project/publication/archive and intake-round backend; Keycloak PKCE/TOTP and server organization roles; encrypted investor-managed Zalo OTP settings; bounded single-use phone OTP and revocable customer sessions; private customer dashboard and idempotent drafts.

Added in v0.3:

- Citizen dossier detail and seven-section workspace; encrypted, immutable declaration versions; household membership history; partial drafts, strict calendar validation, explicit confirmation, optimistic concurrency and owner checks.
- Deterministic preparation checklist/readiness with category subscores and missing tasks, assessment snapshots bound to input version. Generic `preparation-v1`, not a legally approved project checklist. Document/form categories stay zero; this implementation currently reaches at most 45/100. No eligibility decisions or submission blocking.
- Citizen-requested support with purpose-specific consent; encrypted message/reply; staff organization scope; open/responded/closed transitions and optimistic versions. Staff see only shared support messages, not private declarations.
- Append-only operational hash chain for new events since v0.3, verification endpoint and admin viewer. Historical v0.2 events are not retroactively claimed verified; no external signed checkpoint yet.
- Redesigned citizen portal, account workspace, dossier wizard and investor sidebar/tables/detail editors; search, empty/error/loading states; public intake-round schedules; Vietnam-time editing reads submitted date/time values.

Added in v0.4:

- Source registry: six official PDFs, 15 checksum-verified exact-page forms and source report in `legal/`. Project guidance has immutable payload, versions/effective dates and separate signed workforce author/approver. Only current approved guidance is visible to customers/AI; revocation has no silent fallback. This is not exhaustive legal certification or a filled-PDF engine.
- DVC: official procedure links and encrypted customer-owned receipts/agency/status records. Explicitly manual handoff and citizen-reported statuses; authorized automatic API synchronization is not available.
- OpenAI: deploy-flag + organization opt-in; encrypted API settings in admin; per-request consent and optional declaration sharing; bounded Responses API tools; encrypted, version-bound, expiring proposals; separate single-use customer confirmation applies declaration/support writes atomically. No live provider key/call used for validation.
- Partner portal (`apps/partner-console`, port 3004): investor-managed agencies/project grants/members; partner administrator, campaign manager and consultant roles checked server-side on each request. Investor approval required for live campaign pages. Named-agency consultation consent, encrypted contacts, manager assignment, consultant-only assigned access, progress notes and customer withdrawal. See `PARTNERS.md`.

Still missing: project staff assignments and full role separation; production least-privilege DB integration; consent withdrawal/retention/recovery; trusted Mini App identity/linking; private document ingestion/scanning/OCR; complete legally reviewed form/rule coverage and deterministic filled PDFs; official application snapshots/receipts/review/appeals; RAG/lottery/verifier; security/load/restore/pilot gates. Source retrieval is not legal approval; local and special-regime coverage needs further review.

Live Zalo delivery requires investor-owned approved template and credentials. No real provider credentials, paid sends, citizen PII or production infrastructure from other BDSG projects were used. Local demo OTP transport is outside the repository and isolated to synthetic accounts. Production readiness is not claimed.

# Cầu nối SaaS (15/10/2026)

Workforce có audience tùy chọn và cổng kiểm tra membership HTTPS cho instance riêng theo tổ chức. JWT/MFA vẫn bắt buộc; cổng phân quyền ràng buộc tổ chức/subject, không cache, không dùng quyền realm khi cổng lỗi. Quyền dự án nội bộ rộng hơn phạm vi provider bị từ chối toàn phiên. Kiểm thử ký JWT thật, thu hồi membership, sai phạm vi, sự cố và cấu hình thiếu nằm trong `workforce-gateway.test.ts`. Đây là tích hợp lõi MIT; website kinh doanh, dữ liệu dự án demo và cấu hình vận hành BDSG Housing được giữ riêng.
