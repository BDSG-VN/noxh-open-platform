# Validation evidence — v0.4 development release (2026-10-15)

Local evidence for the preparation/partner/OpenAI/DVC implementation; not a production-readiness or exhaustive legal certification. GitHub [run 38688311778](https://github.com/BDSG-VN/noxh-open-platform/actions/runs/38688311778) passed Node, Python, Rust and full Compose at `f1faf5af934646ff07f190b7c6affd72ad36133f`. A subsequent campaign-scope regression fix adds migration 006; its final CI revision is recorded below after completion.

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
