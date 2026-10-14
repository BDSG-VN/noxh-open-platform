# NOXH Open Platform

Giải pháp mã nguồn mở của **BDSG Foundation** cho nhà ở xã hội: một chủ đầu tư, nhiều dự án, cổng công dân và kênh Zalo dùng chung backend. Giấy phép **MIT**.

**v0.1.0 / Sprint 0: nền phát triển, chỉ có dữ liệu giả lập. Chưa tiếp nhận hồ sơ thật, chưa xét duyệt hay bốc thăm.** Blueprint v2 được lưu nguyên bản tại [docs/blueprint](docs/blueprint/README.md); lựa chọn MIT thay thế đề xuất AGPL trong tài liệu gốc.

## Chạy bằng Docker

Yêu cầu Node 22.12+ hoặc 24, pnpm 11.25.0 và Docker Engine/Desktop có Compose.

```sh
git clone https://github.com/BDSG-VN/noxh-open-platform.git
cd noxh-open-platform
node scripts/init-dev-env.mjs
docker compose config --quiet
docker compose up --build --wait --wait-timeout 600
```

Cổng công dân: http://localhost:3000; chủ đầu tư: http://localhost:3001; minh bạch: http://localhost:3002; API: http://localhost:4000/health/live và /health/ready; Keycloak local: http://localhost:8080; MinIO console local: http://localhost:9001. Tài khoản kỹ thuật local được sinh vào `.env` (không commit). Bucket `noxh-private` bị tắt anonymous access. Đây là cấu hình **development**, không dùng `start-dev` hoặc credential root cho production.

```sh
# Worker AI tùy chọn; không gọi dịch vụ AI bên ngoài
docker compose --profile ai up --build --wait --wait-timeout 600
# Dừng dịch vụ, giữ toàn bộ volume
docker compose down
```

Không dùng `down -v` nếu cần giữ dữ liệu. Migration chạy trước API; seed chỉ chứa dữ liệu giả lập. `/health/ready` kiểm tra Postgres, Redis và migration; không chứng minh đăng nhập/storage/legal readiness. API danh mục mẫu hiện đọc fixture có nhãn, chưa đọc bảng projects.

## Phát triển không dùng Docker cho ứng dụng Node

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm check
```

Để chỉ xem giao diện và API giả lập (không cần Postgres/Redis):

```sh
ALLOW_SYNTHETIC_FIXTURES=true pnpm --filter @noxh/api dev
# Terminal khác
pnpm --filter @noxh/citizen-web dev
pnpm --filter @noxh/investor-console dev
pnpm --filter @noxh/transparency-web dev
pnpm --filter @noxh/zalo-miniapp dev
```

Zalo shell: http://localhost:3003. Token SDK không được coi là chứng minh danh tính; backend trao đổi token trả 501 đến khi có tích hợp xác minh phía máy chủ. `/health/ready` trả 503 khi chưa chạy các dịch vụ; `/health/live` vẫn kiểm tra tiến trình API.

## Cơ sở dữ liệu và kiểm tra

```sh
# Sau init-dev-env và khi Postgres/Redis đã chạy
set -a
. ./.env
set +a
pnpm db:migrate
pnpm db:seed
pnpm test:db
pnpm check:openapi
pnpm check:secrets
```

`db:migrate` dùng giao dịch, advisory lock và checksum; chạy lặp không áp lại migration. `test:db` chạy RLS bằng role không phải superuser và kiểm tra khóa ngoại xuyên tổ chức. Role `noxh_runtime` không có quyền đăng nhập; tích hợp runtime credentials và actor-scoped transaction thuộc Sprint 1. Không đưa biến phạm vi do client gửi trực tiếp vào RLS.

Python worker: `python -m venv .venv`, `.venv/bin/pip install -r services/ai-worker/requirements.txt`, rồi `cd services/ai-worker && ../../.venv/bin/python -m pytest`. Rust shells: `cargo test --workspace`; verifier cố ý thoát mã 2 vì chưa triển khai.

## Cấu trúc

```text
apps/        api (NestJS), citizen-web, investor-console,
             transparency-web (Next.js), zalo-miniapp (React + SDK)
packages/    contracts, ui, authz, form-engine
services/    ai-worker (FastAPI placeholder)
crates/      lottery-engine, lottery-verifier (fail-closed placeholders)
db/          migrations, synthetic fixtures
scripts/     migration, seed, local env, contract/security gates
docs/        blueprint, ADRs, threat model, status, validation
```

## Các nguyên tắc

Hồ sơ chuẩn bị khác đơn đã nộp. AI chỉ hỗ trợ; không tự xét điều kiện, nộp hồ sơ hay điều khiển bốc thăm. Mẫu chính thức cần nguồn pháp lý, phiên bản và người duyệt. Chưa thu thập PII trong bản phát triển. Mọi thao tác nghiệp vụ tương lai phải có xác thực/phân quyền máy chủ, dấu vết, phiên bản và cơ chế chống ghi lặp.

Xem [trạng thái thực tế](docs/STATUS.md), [kết quả kiểm tra](docs/VALIDATION.md), [lộ trình Sprint 1–12](docs/blueprint/BACKLOG.md), [threat model](docs/THREAT_MODEL.md), [quyết định kiến trúc](docs/adr/README.md), [OpenAPI 3.1](docs/openapi.json).

## Tái sử dụng và đóng góp

Một số UI primitives lấy từ `AleksNeStu/ai-real-estate-assistant` theo MIT, giữ thông báo bản quyền trong [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Chi tiết [REUSE.md](docs/REUSE.md). Backend lõi được dựng mới bằng NestJS theo blueprint.

Gửi issue/PR với phạm vi nhỏ, test và cập nhật tài liệu. Không đưa dữ liệu cá nhân, giấy tờ thật hoặc token vào issue. Xem [CONTRIBUTING.md](CONTRIBUTING.md) và [SECURITY.md](SECURITY.md). Phần mã công bố không đồng nghĩa đã được chứng nhận pháp lý/bảo mật.
