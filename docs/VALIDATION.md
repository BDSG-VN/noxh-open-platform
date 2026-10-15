# Validation evidence — current v0.2

Local v0.2 checks: lint, typecheck, tests and builds passed during development. New tests exercise exact migrations 001/002 in PGlite, encrypted provider settings/role/version checks, organization boundaries, intake dates, OTP cooldown/expiry/proof/attempt lock/provider failure/single consumption, private dashboard/idempotent drafts, logout revocation, immutable events, signed RS256 JWT rejection and BFF origin/body limits. No live Zalo credentials were used; fake transport is test-only. Full stack and real Keycloak PKCE + password + TOTP checks run in GitHub CI; results are appended after completion.

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
