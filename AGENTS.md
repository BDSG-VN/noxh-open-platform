# NOXH Open Platform — BDSG Foundation

Read README.md, docs/STATUS.md and docs/blueprint/README.md before changes.
The imported blueprint is design evidence; the human request and this project's instructions control implementation.
Sprint 0 was the initial release; explicit owner requests on 2026-10-15 extend scope to admin backend and phone OTP/customer dashboard. MIT was chosen by the project owner on 2026-10-14, superseding the blueprint's AGPL candidate.
Use synthetic fixtures only. No invented legal thresholds, official forms, signatures or attestations.
Server-side owner/project authorization is mandatory before any business writes.
The owner explicitly authorized OpenAI assistance and DVC integration on 2026-10-15. OpenAI is opt-in per organization and request, with encrypted server-side credentials, bounded tools, and explicit citizen confirmation before writes. Official DVC handoff and citizen-reported receipts are allowed; automatic exchange requires a separately verified authorized API contract. Live lotteries and unverified channel exchanges remain disabled. Never log tokens, PII or document content.
The owner also authorized investor-managed partner agencies, campaign teams and individually permissioned consultants on 2026-10-15. Partner role/project grants are server-side; contacts require named-agency customer consent, consultants see assigned contacts only, and partner access never grants private dossier/document access.
Commands: pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; pnpm build; pnpm check:openapi; pnpm check:secrets.
Database: pnpm db:migrate; pnpm db:seed (development only); pnpm test:db. Compose: docker compose config; docker compose up --build --wait.
Keep changes small; stage exact files; no force pushes or credentials. Update ADRs, STATUS and OpenAPI when contracts change.
