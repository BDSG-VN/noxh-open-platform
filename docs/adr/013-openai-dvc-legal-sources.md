# ADR 013 — OpenAI opt-in, official DVC handoff and reviewed form guidance

Accepted implementation scope, 2026-10-15, following explicit project-owner requests for OpenAI actions, investor-managed configuration and DVC integration. The original default prohibition on external AI is superseded only within these boundaries. Core workflows work with AI off.

## OpenAI

Deployment flag `EXTERNAL_AI_ENABLED=true` plus organization settings are required. Credential encrypted with server AES-GCM key/AAD bound to organization; metadata GET never returns it. Admin chooses model and daily request count. Fixed HTTPS Responses API destination, no redirects, 25-second timeout per provider call, 1 MiB provider-response bound, no arbitrary endpoint. Use `store:false`; this is not a promise of zero provider retention. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

Consent per request covers question + project instructions; the saved personal declaration is included only with a separate opt-in. No raw prompts/documents/provider errors are logged. Conversations are not persisted. Run metadata and encrypted action proposals are stored. Each request permits at most 3 provider calls, 1,600 output tokens/call, 2 proposals, 2 tool calls/round; organization daily request budget, 10 requests/citizen/hour, 3 concurrent organization runs. Failed attempts count toward limits. This is not a monetary cap; configure OpenAI billing controls separately.

[Strict function tools](https://developers.openai.com/api/docs/guides/function-calling) read preparation checklist, approved project instructions and official procedure links. They can propose a bounded declaration patch or support message. Zod independently validates model arguments. No network/browser/shell/admin/eligibility/lottery/official-submission tool. Document content and instructions are untrusted data. Actual writes require a separate citizen confirmation endpoint, owner/org checks, 15-minute expiry, matching input version, a single-use proposal lock and atomic write/audit/consumption. Updates always unset declaration confirmation.

## DVC

The catalog uses official procedure 1.014632 for relevant NOXH attestations and 1.012896 specifically for publicly invested state housing. The citizen opens the official site, selects agency/locality and authenticates there. The platform does not collect official credentials or OTPs. Receipt/reference, agency, note and status are encrypted and owned by the dossier citizen. All statuses are explicitly `citizen-reported` and unverified. No authenticated partner API specification/credentials have been supplied or verified; **automatic/bidirectional synchronization is not implemented**. Do not simulate it or infer a verified status from a receipt number. Add a separately authenticated, replay-resistant adapter only against a verified official integration contract.

## Legal source guidance

Six original government PDFs and 15 exact-page extracts have SHA-256/source/page metadata. See [legal registry](../../legal/README.md). The catalog is not an exhaustive legal opinion. Investor instructions are separate from immutable statutory source content. Each draft guidance release includes project, mode, subject group, effective dates, source hash and author. Only a different signed workforce subject with `form_legal_approver` may approve; approved current guidance becomes visible to dossier owners. Payloads cannot be edited; revisions create new versions. Revocation is audited, and a revoked newest release does not cause automatic fallback to an older one. Expired/future/draft releases are not sent to the assistant or customer. This does not yet implement deterministic filled PDFs or the complete document pipeline.

## Residual work

Provider-live test requires operator-owned key/model/budget. No real API request or paid token was used for development verification. File scanning/extraction, filled-form rendering, retention/withdrawal jobs, full project role assignments, production DB least privilege and independent security/legal review remain gates. These features do not make the complete blueprint production ready.
