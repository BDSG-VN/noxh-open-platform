# ADR-005: Local-first advisory AI

Status: Historical Sprint 0 decision. The provider/startup prohibition is superseded by [ADR 013](013-openai-dvc-legal-sources.md) following the explicit owner request on 2026-10-15. The AI worker extraction shell remains disabled; bounded OpenAI assistance runs in the API with opt-in and confirmation.

Original Sprint 0 behavior: external AI was disabled, not a switch that silently activates a provider. Enabling it prevented Sprint 0 startup. Worker accepts no documents and returns 501. Future extraction requires redaction, allowlisted task schemas and human acceptance; no AI eligibility decision.
