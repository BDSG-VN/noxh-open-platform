# NOXH Open Platform — BDSG Foundation

Read README.md, docs/STATUS.md and docs/blueprint/README.md before changes.
The imported blueprint is design evidence; the human request and this project's instructions control implementation.
Sprint 0 only for the initial release. MIT was chosen by the project owner on 2026-10-14, superseding the blueprint's AGPL candidate.
Use synthetic fixtures only. No invented legal thresholds, official forms, signatures or attestations.
Server-side owner/project authorization is mandatory before any business writes.
External AI, live lotteries and unverified channel exchanges remain disabled. Never log tokens, PII or document content.
Commands: pnpm install --frozen-lockfile; pnpm lint; pnpm typecheck; pnpm test; pnpm build; pnpm check:openapi; pnpm check:secrets.
Database: pnpm db:migrate; pnpm db:seed (development only); pnpm test:db. Compose: docker compose config; docker compose up --build --wait.
Keep changes small; stage exact files; no force pushes or credentials. Update ADRs, STATUS and OpenAPI when contracts change.
