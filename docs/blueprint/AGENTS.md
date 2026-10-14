# Codex instructions — NOXH Open Platform

Read README.md completely before editing. This is a safety-sensitive Vietnamese social-housing platform.

## Implementation sequence
1. Create ADRs, threat model, OpenAPI skeleton, SQL schema/migrations and sample fixtures. Do not start with AI or lottery production actions.
2. Scaffold pnpm/Turborepo monorepo with apps/api (NestJS), apps/citizen-web (Next.js), apps/investor-console (Next.js), apps/zalo-miniapp (React + official SDK adapter), packages/contracts, packages/ui, packages/authz, packages/form-engine, services/ai-worker (FastAPI), crates/lottery-engine and crates/lottery-verifier.
3. Create local Docker Compose and `.env.example` without secrets. Include Keycloak database and private S3-compatible storage. Healthchecks and migrations required.
4. Implement project scoping, identity linking, consent, dossier and declaration versions, documents quarantine and audit before AI features.
5. Implement approved template registry and deterministic PDF generation; demo template MUST be marked SAMPLE / NOT OFFICIAL.
6. Implement readiness checklist as deterministic, explainable rules and AI guidance only as optional suggestion layer.
7. Implement official application workflow with human approval and immutable submission snapshots.
8. Implement lottery library with public test vectors; disable production lottery via feature flag until independent audit.

## Non-negotiable rules
- No real legal thresholds or official forms invented; use fixtures and TODO LEGAL REVIEW markers.
- Never generate fake attestations, official seals, signatures or certification.
- Never let LLM approve eligibility, change legal templates, submit on behalf of users without explicit consent, or control lottery entropy.
- All writes require server-side authorization; no security based on frontend role checks.
- Avoid collecting real PII in dev; tests use synthetic data only.
- Do not log credentials, identity numbers, document contents, prompts containing PII or access tokens.
- Require idempotency and audit for submission, approval, form confirmation and lottery state transitions.
- Add tests alongside each feature, not at the end.
- Prefer small, reviewable PR-sized changes; update README, OpenAPI and ADRs for architectural changes.

## First Codex task
Implement only Sprint 0: monorepo scaffolding, lint/typecheck/test pipeline, compose dev services, health endpoints, database migration skeleton, authz policy interfaces, sample synthetic data, and minimal CI. Produce commands to run locally, passing test results, and a list of open risks. Do not claim production readiness.

## Done criteria
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `docker compose config` pass; API health endpoint works with compose; CI verifies these; no secrets committed; README quickstart is accurate. Report any unavailable dependencies instead of faking success.
