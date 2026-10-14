# ADR-001: NestJS modular monolith and workers

Status: Accepted for Sprint 0

Core business transactions stay in one NestJS API. AI runs in an isolated FastAPI worker. A Nest application-context worker is scaffolded but processes no jobs. Avoid copying the upstream FastAPI business backend because it conflicts with this boundary.
