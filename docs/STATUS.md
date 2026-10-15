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
