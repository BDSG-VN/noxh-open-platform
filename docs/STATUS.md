# v0.2 — Admin backend and customer access

Implemented: real investor admin API and UI for projects, publication/archive, intake rounds and DB counts; Keycloak PKCE/TOTP verification and server roles; version checks and append-only operational events; investor-managed encrypted Zalo OTP settings; bounded single-use phone OTP, revocable customer sessions; private customer dashboard and idempotent preparatory dossier creation; published DB project catalog. MIT, BDSG Foundation.

Initial Sprint 0 foundation remains. Scope expanded by explicit owner request on 2026-10-15. Setup and limitations: [ADMIN-AND-ZALO.md](ADMIN-AND-ZALO.md). Validation evidence is recorded separately in VALIDATION.md.

Not implemented: project_manager assignments, production DB role/RLS integration for new routes, full consent lifecycle/retention and recovery; trusted Mini App token exchange/linking; household declarations, real documents/upload/scanning; legal templates/PDFs, readiness assessments, official submissions, review/appeals, audit chains, OCR/RAG, lotteries, production deployment or security certification. No production infrastructure from other BDSG projects is changed.

Live Zalo delivery requires investor-owned approved template and credentials; no real provider credentials or paid sends used in development. No production pilot is claimed.
