# Sprint 0 status

Version 0.1.0 — development foundation, synthetic data only. Not production ready.

Implemented: pnpm/Turborepo workspace; NestJS liveness/readiness; synthetic public project API and citizen browsing; investor/transparency shells; official Zalo SDK adapter boundary (no login); contracts and deny-default policy interfaces/tests; transactional checksum migrations; scoped SQL schema and seed; dev Compose; AI/worker and Rust shells; typed OpenAPI; CI; source notices/MIT.

Not implemented: authenticated Keycloak sessions, trusted Zalo token verification or secure account linking, consent UX/storage endpoints, household wizard, real documents/upload/scanning/encryption, readiness rules, legal templates or PDF generation, OCR/RAG, official submission/receipt, staff review, audit chain/checkpoints, durable jobs, lottery protocol/verifier/certification, production deployment or restore/load/security signoff.

Checklist:

- [x] Architectural assumptions, 10 ADRs, STRIDE/privacy draft
- [x] Monorepo applications/shared interfaces, minimal synthetic UI
- [x] SQL migrations, RLS baseline, synthetic fixture seed
- [x] Dev Compose with dedicated identity DB and private storage
- [x] MIT decision and upstream source attribution
- [ ] Final validation evidence: see docs/VALIDATION.md
- [ ] Sprint 1: integrate identity and scoped authorization into server business routes

Blueprint tasks are roadmap, not authority to execute production actions. No production infrastructure from other BDSG projects is changed.
