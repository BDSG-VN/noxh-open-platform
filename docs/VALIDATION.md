# Bằng chứng thông báo tự động 021 — 16/10/2026

Bản 021 đã hợp nhất vào main qua PR #5, merge `d932a9847ca0365c06e8c181afeef3fbfe972404`; mã nguồn được kiểm tra tại `ac3897827f914acdd92a3d5ee78944f620b9f859`, migration 001–021. Chỉ ba thay đổi hồ sơ tổng hợp tới hộp thư trong ứng dụng; cờ triển khai mặc định tắt. Chi tiết ở [hướng dẫn 021](COMPLETION-NOTIFICATION-AUTOMATION.md).

- `pnpm check` đạt: ESLint/Prettier, typecheck, **242 Vitest** (API **194**), **24 kết quả Node**, OpenAPI/generated operations, secret-pattern gate và bốn trọng lượng font tiếng Việt. **19 ca PostgreSQL native** được bỏ qua trong lệnh mặc định cục bộ vì không đặt biến kết nối; kết quả riêng bên dưới không cộng lẫn vào 242 ca.
- PostgreSQL **17.6** cô lập: **19/19 ca độc lập đạt**, gồm hai kết nối TCP, khóa chờ thực, `SKIP LOCKED`, lease/fencing, crash trước commit, đồng ý/rút/cấp lại, thu hồi mẫu/quy tắc/quyền nhân sự, chống trùng và RLS không đặc quyền. Các DB sinh riêng cho từng lượt đã được xóa; cluster riêng đã dừng và tệp kết nối tạm đã xóa sau kiểm tra. CI chạy 19 ca này bằng service PostgreSQL 17.6 riêng có đúng guard; vì vậy tổng CI là **261 Vitest** (242 ca thường + 19 ca native), khác tổng cục bộ mặc định.
- `pnpm build:node`: **10/10 gói production đạt**; Next giới hạn hai build worker. `cargo test --workspace --locked --offline`: **35 ca đạt** trên Rust 1.99.0. Python: **3 ca đạt** trên 3.11.15, có cảnh báo deprecation Starlette/httpx hiện hữu. Dependency audit runtime không báo lỗ hổng đã biết tại thời điểm kiểm tra.
- Có thêm **13 ca PGlite** cho outbox/nghiệp vụ và **4 ca lifecycle** trong tổng Vitest phía trên. Bốn ca SSR giao diện kiểm cách trình bày/trạng thái/phân biệt người lập với người duyệt; kết quả trình duyệt thực được ghi riêng bên dưới.
- Một lần kiểm tích hợp gặp lỗi socket ở bài HTTP dùng Supertest mở/đóng listener qua nhiều yêu cầu; bài kiểm hiện giữ một listener cho mỗi test và giữ nguyên mọi assertion phân quyền. Một ca CLI audit cũng lỗi trong lượt chạy trước, sau đó qua khi kiểm độc lập và trong lượt `pnpm check` đầy đủ. Không sửa hoặc bỏ qua điều kiện xác minh Rust để làm xanh.

- Browser trên production frontend và BFF/API: **18 xác nhận CUA đạt** (14 chức năng và 4 cặp nhãn mở đúng form), cùng **8 kiểm tra HTTP BFF** về phương thức, query, origin và chưa đăng nhập. Tác giả lưu nháp nhưng không tự duyệt; persona độc lập xác nhận và duyệt; khách tự chọn thông báo riêng tư cùng nhận tin nghiệp vụ trong ứng dụng; yêu cầu bổ sung qua ApplicationsAdmin tạo sự kiện giao dịch và worker thực phát đúng một thư. Khách xác nhận đọc, tải lại vẫn giữ trạng thái; người duyệt thu hồi bằng ô xác nhận mới. Sự kiện thiếu chính sách giữ lý do và lịch sử chỉ đọc. Bốn nhãn accordion bị lệch đã được sửa chữ và kiểm lại trên build mới với fixture mới, không ghi quyết định nghiệp vụ qua browser trong lượt kiểm nhãn.
- Desktop **1440 px** và mobile **390 px** không tràn ngang toàn trang; console không ghi nhận error/warning. Dự án/tài khoản đều giả lập; identity/storage/AV dùng test-double, AppModule/BFF/source/outbox/lifecycle chạy thực và cờ tự động chỉ bật trong tổ chức fixture. Mọi dịch vụ/worker loop/tab QA riêng được dọn sau kiểm tra. Hai ảnh đã rà soát ở [thư viện 021](screenshots/README.md#thông-báo-tự-động-021--16102026), không chứa tài liệu dự án riêng hoặc dữ liệu người thật.
- CI [run 38900301354](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38900301354) tại `ac3897827f914acdd92a3d5ee78944f620b9f859` đạt **4/4 job Node, Python, Rust và Compose**, gồm 19 ca PostgreSQL native trong job Node. Các kết quả CI/QA này không tự xác nhận đã triển khai 021 lên dịch vụ đang chạy.

Không gửi email/Zalo, không có thông báo pháp lý được chứng thực, không nhận hồ sơ thật và không thay các điều kiện vận hành/pháp chế/provider còn mở trong [ma trận](IMPLEMENTATION-MATRIX.md).

---

# Bằng chứng đợt hoàn thiện — 16/10/2026

Bản phát triển trên nhánh `codex/housing-completion`, migration 001–020. Các kết quả sau đã chạy trên mã tích hợp; không thay nghiệm thu provider, pháp lý hoặc production.

- ESLint/Prettier toàn kho và typecheck 10 gói (13 tác vụ phụ thuộc) qua. `pnpm build:node` production **10/10 gói qua**; bốn ứng dụng Next giới hạn hai build worker. Mini App có cảnh báo chunk khoảng 790 kB minified (188 kB gzip); chưa có đánh giá hiệu năng thiết bị thật. Kiểm tra giao diện được ghi riêng sau khi chạy, không suy ra từ typecheck.
- `pnpm test`: **221 Vitest cases** (trong đó API **177/177**), **24 kết quả Node test** đều qua. API chạy một worker; kiểm tra loopback dùng quyền listener. Bao gồm toàn bộ hành trình Mini App qua AppModule/controller/CORS/privacy thật, stale/cross-owner/cross-dossier, ZIP đồng thời với sửa bản khai, AI hash/phạm vi/thu hồi consent, tenancy/notification và checkpoint.
- `cargo test --workspace --locked --offline`: **35 test qua** trên toolchain 1.99.0; `cargo fmt --all -- --check` qua. Ba binary release được build và các bài API gọi Rust thật, gồm phân trang trên 10.000 sự kiện. CLI ký/kiểm Ed25519 giữ giới hạn 15 giây mỗi child; ngân sách tổng của bài kiểm 5 child được tách khỏi giới hạn từng process.
- Python worker: **3 test qua** trên Python 3.11.15; CI vẫn dùng Python 3.12. Không thay runtime Python hoặc nâng dependency trong đợt này.
- OpenAPI 3.1/generated operations, secret-pattern gate và hash/giấy phép/độ phủ ký tự tiếng Việt của bốn trọng lượng font đều qua. Đây là kiểm tra nguồn, không phải pentest hay kiểm toán bảo mật.
- Khôi phục native: PostgreSQL **17.6**, **20 migration**, **1 object tổng hợp**, **1 sự kiện audit có checkpoint ký**. Capture → plan → restore vào database mới → kiểm inventory/config/migration/Rust → dọn database đã qua; tamper bị từ chối trước restore. Không khôi phục đè hệ thống đang chạy, không import S3/Keycloak thật hoặc chứng minh custody/RPO/RTO.
- Browser production build, dữ liệu tổng hợp: **9 nhóm kiểm tra qua** qua BFF/controller/service thật. Khách xác nhận hợp đồng diễn tập, đọc thông báo và đổi lựa chọn tiếp nhận; AI đề xuất → người dùng xác nhận → tải PDF nháp → xác nhận trường → tải PDF đã xác nhận. Sáu màn hình admin kiểm ở 1440 px và 390 px, không lỗi JavaScript/API hoặc tràn ngang toàn trang. Ảnh mới và phạm vi test-double ở [thư viện ảnh](screenshots/README.md); không thay nghiệm thu provider/thiết bị Zalo thật.
- CI [run 38849551489](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38849551489) tại `77985e8181cf95892efd453ac9aef685564a339d` qua đủ **Node, Python, Rust và Compose**, gồm PostgreSQL TCP/RLS, Keycloak MFA và private bucket thật trong môi trường CI. Revision này đã gồm hai chỉnh sửa trình bày cuối và 11 ảnh tổng hợp; merge `0fa99a92f77d323af6f271d00a3a3ff1901f9d50` vào main có cùng cây mã. Các cập nhật bằng chứng chỉ tài liệu sau đó dùng `[skip ci]`, không thay mã ứng dụng.
- Kho pháp lý: **10 PDF nguồn, 16 mẫu trích** được kiểm hash/trang; 15 mẫu cũ giữ nguyên byte. Mẫu BQP mới chờ duyệt chuyên ngành/dự án; nguồn BCA cũ được đánh dấu lịch sử/chưa xác minh hiện hành. Đối chiếu và các khoảng trống nằm trong [báo cáo nguồn](LEGAL-COVERAGE-20261016.md).

Identity/OA/OpenAI/antivirus/object storage bên ngoài trong hành trình Mini App dùng test-double có nhãn tổng hợp; không có token provider thật, giấy tờ người thật hoặc thông báo trả phí. CORS/PrivacyGuard/controller/service/PDF và các processor Rust được chạy thực trong phạm vi kiểm tra. Chưa đồng bộ API cơ quan nhà nước, ký/thu tiền/bốc thăm thật, kết luận nhóm 13 hoặc tự coi các nhánh vốn có cùng quy trình. Các điều kiện còn mở ở [ma trận](IMPLEMENTATION-MATRIX.md).

---

# Bằng chứng v0.5 — bản tích hợp (2026-10-15)

Đây là kiểm tra phát triển bằng dữ liệu giả lập, không phải chứng nhận production/pháp lý. CI bản tích hợp sẽ được ghi theo commit sau khi hoàn tất; kết quả v0.4 phía dưới chỉ chứng minh phiên bản lịch sử đó.

- `pnpm check` đã qua: ESLint/Prettier, typecheck 13 tác vụ, 131 Vitest (API 102, các package 29),16 kết quả Node hạ tầng/SQL/safety, OpenAPI và secret-pattern gate. Kiểm thử HTTP/antivirus cần quyền socket cục bộ; lần chạy sandbox bị EPERM không được ghi là pass. Bản chạy đủ socket sau đó qua.
- `pnpm build` toàn bộ10package qua. Hai cổng được build lại sau sửa hướng dẫn cũ cho khớp chức năng. API build lại sau gia cố quyền dữ liệu/PDF và khóa chứng cứ tại thời điểm phê duyệt.
- Dependency audit runtime: không tìm thấy cảnh báo đã biết tại thời điểm chạy. Đây không phải kiểm toán độc lập/SBOM toàn bộ image.
- PostgreSQL17 native: migration001–014 áp dụng thành công và chạy lặp không áp lại; non-superuser RLS/owner/project/unset-scope/cross-org FK qua. Các SQL migration cũ giữ checksum.
- Backup/restore thật: archive PostgreSQL mã hóa AES-GCM 299770byte, mode0600; khôi phục database tạm có66bảng/14migration/31event audit, manifest khớp. Xóa database drill và bản plaintext tạm, giữ dữ liệu nguồn. Xem [BACKUP-RESTORE.md](BACKUP-RESTORE.md); chưa phải khôi phục toàn bộ Keycloak/MinIO/cấu hình/khóa ngoài máy.
- Bounded GET load trên demo mới:3dự án giả lập,120/120yêu cầu,0lỗi,4worker,p95 7.64ms. Chỉ baseline đọc công khai trên localhost; không đại diện tải nhận giấy tờ/AI/đồng thời production.
- Storage: AWS SDK thực kết nối MinIO native, ghi/đọc envelope mã hóa, giải mã đúng owner AAD, kiểm hash và xóa đúng object test mới. Bucket anonymous403.
- Antivirus native thật: ClamAV1.5.4 từ gói Cisco chính thức đã kiểm tra chữ ký/notarization; bản portable đặt trong thư mục demo riêng. Definitions daily28154/main63/bytecode339 được freshclam kiểm chữ ký. Adapter INSTREAM thực nhận PDF sạch→clean và EICAR tiêu chuẩn vô hại→rejected. Không fakeclean/bỏ quét; lỗi cấu hình/protocol giữ quarantine. PDF được parse chặt chỉ sau AVclean, malformed bị từ chối mà không log nội dung.
- PDF engine:3tests qua, render kiểm tra vị trí chữ tiếng Việt và nguồn trang; ZIP được kiểm CRC độc lập. Native pipeline thực tế PostgreSQL+MinIO+ClamAV→PDF draft→xác nhận→PDF+ZIP đã qua trên tổ chức/persona giả lập riêng. Minh họa1trường tên,4trang gồm3trang mẫu+provenance; không khẳng định đã duyệt mapping toàn bộ15mẫu hoặc sinh giấy xác nhận/chữ ký.
- Bốc thăm:7tests về full-cohort, round/mode, pending, loại trừ có lý do/duyệt độc lập, một attempt, hủy/thay thế và source drift. Node/Python/Rust tái lập cùng golden vector; Rust 31 tests qua, gồm runner thực thi, bộ kiểm chứng nhật ký và tính giá số nguyên chính xác. Phòng demo12mã/8suất thực sự publish bằng LotteryService, chứng cứ được Python và Rust kiểm chứng độc lập. Entropy local diễn tập, không phải beacon đáng tin hoặc chứng thư ký số.
- Rust runtime: `pnpm native:build` release locked và toàn bộ build10package qua. Bảy bài đối chiếu gọi binary Rust thực (hai lottery/audit, năm pricing), gồm golden vector, sửa chứng cứ, 40 bộ giá đối chiếu, 500 căn và tiền vượt giới hạn số nguyên an toàn JavaScript. Bridge có bốn bài kiểm tra giới hạn dữ liệu, timeout, lệnh cố định và môi trường con không nhận khóa ứng dụng. Backend demo khởi động lại với readiness `rust:true`; UI nhật ký đối chiếu92sự kiện bằng Rust, dự thảo giá8căn được tạo từ UI qua Rust, không tự duyệt.
- Giao diện: font Be Vietnam Pro tự lưu trữ, bốn trọng lượng có checksum/giấy phép và phủ ký tự tiếng Việt; `pnpm check:fonts` qua. Menu theo nghiệp vụ, biểu mẫu điền có điều khiển từng trường và các tác vụ dài chia bước. Ảnh chụp bản build thật tại breakpoint desktop1280, không phải bản dựng ảnh. Chưa ghi nhận thêm nghiệm thu điện thoại sau đợt chỉnh cuối.
- Browser bản mới: Keycloak password+TOTP admin và điện thoại/OTP khách qua, menu điều hành/bảng hàng/xét duyệt và dữ liệu backend hiển thị; khách có bản khai, lựa chọn dữ liệu và các bước giấy tờ/nộp/chọn căn. Ghi nhận consent trên persona demo từ UI, không seed thay lựa chọn người thật. Ảnh tại [screenshots](screenshots/README.md).
- Không dùng khóa OpenAI thật, không gửi Zalo thật hoặc dữ liệu công dân thật, không có API cơ quan nhà nước được cấp quyền. Các fake transport trong unit test được phân biệt với kiểm tra native. Pháp chế địa phương/chế độ vốn, pilot, runtime least privilege, ký số/off-host audit và pentest độc lập còn mở trong [ma trận](IMPLEMENTATION-MATRIX.md).

---

# Validation evidence — v0.4 development release (2026-10-15)

Local evidence for the preparation/partner/OpenAI/DVC implementation; not a production-readiness or exhaustive legal certification. GitHub [run 38688311778](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38688311778) passed Node, Python, Rust and full Compose at `f1faf5af934646ff07f190b7c6affd72ad36133f`. Campaign-scope regression fix/migration006 at `c4713bbf42f17e36cd73a6631570db9660721866` also passed all four jobs: [run38689734798](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38689734798).

- `pnpm check`: ESLint, Prettier, typecheck for 10 packages, 75 Vitest cases, 12 Node infrastructure/embedded-Postgres test results, OpenAPI/generated operation checks and the secret-pattern gate passed. Test tasks run serially to avoid a shared Vitest cache cleanup race observed with parallel tasks on this Mac.
- `pnpm build`: all 10 packages passed, including the new partner portal. The API was rebuilt after the additional AI context-bound test/change; UI layouts were rebuilt after visual inspection.
- Native PostgreSQL 17: exact migrations 001–006 applied; migration rerun twice, development seed and TCP non-superuser RLS/denial checks passed. Demo keeps existing encrypted declarations and support history across restarts.
- Legal PDFs: six official originals with source/hash manifest, 15 exact-page extracts; all output hashes/page counts checked, extracted page text matches the corresponding original, and all 15 first pages rendered and visually inspected. This proves extraction integrity, not legal approval or exhaustive applicability.
- Browser: real Keycloak password + TOTP admin login, private customer phone OTP login, specialist phone OTP login and agency administrator login passed against the native backend. OTP delivery stayed in the isolated synthetic demo inbox; no live Zalo send.
- Browser: assigned consultant saw one contact and saved consultation progress/notes; the other consultant saw zero contacts and no personnel management. Agency manager created a new consultant through the portal; that new account then completed phone OTP login and saw the request assigned to it. A campaign created in the portal moved draft → pending → approved through the investor UI; its public page accepted a separate named-agency customer consent and the agency assigned that request to the newly created consultant.
- Browser: customer birth date persisted after another field changed, save and reload; declaration version/readiness updated from actual backend data. Customer support/reply worked earlier in the same implementation session. Browser saved an explicitly synthetic DVC receipt and displayed citizen-reported/unverified status; the admin OpenAI settings view and the customer disabled state were inspected without entering a key.
- Security cases: owner/org and cross-agency denial, unassigned-consultant denial, stale versions, consent/withdrawal, last-active-admin preservation, member/agency suspension, project revocation (including guessed write IDs and attempts to recover revoked-project leads by moving a campaign), encrypted contacts/keys/proposals, canonical UUID case binding for encrypted data, independent form approval, dates/revocation, prompt-tool scope, expiring/single-use/version-bound confirmed AI writes, no default declaration sharing, provider budget enforcement and bounded legal-guide context.

Browser viewport checks: partner consultant workspace inspected at actual 390px DOM/screenshot width; document scroll width was 390px, with the data table scrolling within its own container. Desktop customer/admin/partner views were inspected at 1280px. The initial override was not reflected in the customer tab; mobile evidence is limited to the partner portal actually measured. Screenshots are stored under `docs/screenshots`.

OpenAI transport used an injected synthetic provider in tests. No real API key, paid token, citizen document or real personal data was transmitted to OpenAI. DVC uses official handoff + unverified customer-reported receipt tracking; no partner API access or automatic synchronization is claimed. OCR/AV/private-document ingestion and complete filled-PDF generation remain absent. The v0.4 baseline passed Docker startup, real Keycloak PKCE/TOTP and Rust in the linked CI run. The migration 006 follow-up must pass its own check; earlier v0.2 evidence below does not certify later code.

# Validation evidence — current v0.2

Local v0.2 checks: lint, typecheck, tests and builds passed during development. New tests exercise exact migrations 001/002 in PGlite, encrypted provider settings/role/version checks, organization boundaries, intake dates, OTP cooldown/expiry/proof/attempt lock/provider failure/single consumption, private dashboard/idempotent drafts, logout revocation, immutable events, signed RS256 JWT rejection and BFF origin/body limits. No live Zalo credentials were used; fake transport is test-only. Full stack and real Keycloak PKCE + password + TOTP checks run in GitHub CI; results are appended after completion.

## Verified v0.2 revision

[Run 38661274909](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38661274909) at code commit `c6094ad4068b2f6c42e6d03eb2d6fd0f1c867bd2` passed all four jobs: Node, Python, Rust and Compose.

- Local and CI Node checks: lint, typecheck, 41 Vitest cases plus 12 Node test results, OpenAPI/generated types, secret pattern gate, runtime dependency audit and builds passed.
- Exact PostgreSQL migrations ran twice and synthetic seed/RLS checks passed on TCP PostgreSQL.
- Real Keycloak Authorization Code + PKCE, password and TOTP completed. Tokens contained the required subject, issuer, audience, client, signed OTP AMR and org_admin role. API validated the real token and returned scoped dashboard/projects/settings metadata.
- Investor SSR page rendered the dashboard and project data after authentication; the bearer token was absent from HTML. Staff logout persisted revocation; replay returned 401.
- Full Docker stack started; health/readiness and citizen/investor/transparency HTTP checks passed; anonymous private-bucket access returned 403.
- Local browser checks: customer phone login and staff login pages rendered; unauthenticated customer dashboard and investor root redirected to their login pages.
- Zalo transport success/error contracts were tested with injected test responses. No live Zalo credential, message or paid transaction was used. Investor configuration and real provider acceptance must be verified by the deploying owner.

Initial smoke-driver failures were corrected (auxiliary form selection, localhost Secure-cookie handling and explicit Base32 fixture encoding). The integration check also found and corrected a missing Keycloak `basic` scope for the required subject claim. No application authentication rule was relaxed.

Documentation-only evidence updates after this verified code revision use `[skip ci]`; application/deployment code stays at the tested revision. Production limitations remain in ADMIN-AND-ZALO.md and THREAT_MODEL.md.

Historical v0.1 evidence below refers only to that earlier revision; its shell/disabled-login descriptions do not describe v0.2.

# Validation evidence — Sprint 0

This records actual checks, not a production-readiness certification.

Local checks completed in the implementation session:

- `pnpm lint`: ESLint and formatting passed.
- `pnpm typecheck`: all 9 workspace packages passed.
- `pnpm test`: 28 Vitest cases across 9 packages, plus 12 Node test results (5 Compose invariants, 6 embedded PostgreSQL denial/constraint cases and their parent suite) passed.
- `pnpm build`: all 9 packages passed; Next.js uses webpack for repeatable builds in restricted local environments.
- `pnpm check:openapi`: OpenAPI 3.1 and generated operation types passed.
- `pnpm check:secrets`: tracked/unignored source pattern gate passed; ignored generated .env is excluded. This is not an exhaustive secret/security audit.
- `pnpm audit --prod --audit-level high`: no known runtime dependency vulnerabilities reported at check time.
- Docker Compose official standalone CLI `config --quiet`: passed with generated development env. CLI download checksum was verified.
- Python worker: 3 pytest cases passed on local Python 3.11.15; CI targets Python 3.12.
- PostgreSQL embedded via PGlite: exact SQL migration/fixtures execute; tests run as `noxh_runtime`, reject other owner/project and unset scope, reject cross-project write and cross-organization composite FK. Separate TCP Postgres migration/seed/RLS tests run in CI.

Local HTTP/browser evidence and GitHub CI results are recorded below. Docker daemon and Rust toolchain are not installed on this Mac; Compose full startup and Rust checks are delegated to the repository CI rather than reported as locally passed.

Remaining gates: Sprint 1 identity/runtime scope integration, official template and legal review, private document processing/encryption, signed audit/lottery evidence, restore/load/security review and pilot approval.

Browser verification completed using the Codex browser on local production builds:

- Citizen catalog: two explicitly synthetic projects; search `An Bình` returns one; unmatched query returns zero and a clear empty state.
- Project detail: synthetic notice and disabled application intake control.
- Investor console: clearly marked shell, no session/real staff actions; sign-in remains disabled.
- Transparency: explicitly no results or certificates published.
- Desktop 1280px and mobile 390px inspected; mobile project detail scroll width equals viewport (390px), no horizontal overflow observed.
- Screenshots: [citizen desktop](screenshots/citizen-desktop.jpg), [citizen mobile](screenshots/citizen-mobile.jpg), [investor console](screenshots/investor-desktop.jpg).

## First GitHub CI run

[Run 38603865187](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38603865187) passed Node build/checks, actual TCP PostgreSQL migration/seed/RLS, Python and Rust tests. Compose configuration passed but startup failed because MinIO Client registry pull was denied. The storage images were changed to builds from pinned official source; a subsequent CI run must verify full startup.

Local HTTP checks: citizen web `/` 200; API `/health/live` 200; API `/health/ready` 503 without Postgres/Redis, as expected.

## Verified final code revision

[Run 38607859018](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38607859018) at code commit `52eb7e3f0a5a9fa71d2d948ea00e108a38772d3a` passed all four jobs: Node, Python, Rust and Compose. The complete development stack built from source and started successfully. API `/health/ready` returned success, the citizen page contained the expected catalog heading, investor/transparency pages returned success, and unauthenticated access to the private S3 bucket returned 403.

Actual TCP PostgreSQL migrations ran twice without duplicate application, synthetic seed succeeded and non-superuser RLS tests passed. Rust verified the library fails closed and the unimplemented verifier returns nonzero. No live lottery or official citizen workflow is implied.

Documentation-only evidence updates after this code revision use `[skip ci]` to avoid rebuilding unchanged storage binaries; their formatting/source checks are run locally. No application, migration or deployment behavior changes in those updates.
