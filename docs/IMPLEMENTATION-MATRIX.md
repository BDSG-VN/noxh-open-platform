# Blueprint v2 — implementation and acceptance matrix

Updated 2026-10-15. Status describes executable behavior, not folders or menu labels. “Partial” means acceptance criteria remain open. No overall percentage is claimed. The owner's 100% completion request sets the target; this matrix exposes remaining work.

| Blueprint area                  | Current evidence                                                                                      | State / remaining acceptance                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo / self-host foundation | apps, packages, services, crates; Compose and native local demo                                       | Implemented for development. Hardened production deployment remains open.                                                                                         |
| Identity / organization         | Keycloak PKCE, signed OTP AMR, citizen phone sessions, organization SQL scope                         | Partial: project grants, full workforce roles, account recovery and runtime DB least privilege.                                                                   |
| Zalo channel                    | SDK shell and configurable Zalo OTP delivery                                                          | Partial: trusted SDK token verification, dual reauthentication linking and resume across channels.                                                                |
| Consent                         | Login, support/AI sharing, named-partner consultation consent + consultation withdrawal               | Partial: general consent withdrawal/retention/deletion policy and processing record.                                                                              |
| Projects / campaigns            | Catalog/CRUD, intake schedules; scoped partner teams, reviewed campaign pages and consented referrals | Partial: buildings/units, QR/ad-platform integration, notification opt-in and broader publication assets.                                                         |
| Dossier / household             | Owner-only versioned encrypted declarations, household history, resumable web wizard                  | Partial: complete dynamic schemas and provenance across document extraction and channels.                                                                         |
| Private documents               | Private MinIO bucket exists                                                                           | Missing: bounded upload, immutable versions/hashes, quarantine, antivirus, verified download/retention.                                                           |
| Readiness                       | Deterministic category score, missing items, input-versioned history                                  | Partial: general preparation checklist only; legally reviewed project/round versions and evidence references.                                                     |
| Legal sources / forms           | 6 original PDFs, 15 exact-page extracts, effective-dated project guidance with separate approval      | Partial: local/special-regime exhaustive review, deterministic filled PDF renderer, field provenance and citizen confirmation.                                    |
| OCR / AI guidance               | Opt-in OpenAI Responses tools, strict proposals and atomic customer-confirmed writes                  | Partial: scanned-document OCR/extraction, approved RAG citations, field confidence/conflicts and complete document workflow.                                      |
| Submission / receipt            | Unavailable and explicitly shown as such                                                              | Missing: idempotency key, immutable reproducible snapshot, receipt, supplements, task assignments.                                                                |
| Review / appeal                 | Preparation support works, distinct from legal review                                                 | Missing: reviewer/approver separation, reason/evidence decisions, appeal/reconsideration.                                                                         |
| Communications                  | Zalo OTP; first-party support replies                                                                 | Partial: opt-in notifications, provider receipts and durable retries.                                                                                             |
| Audit                           | Immutable operations and verified chain for new events from v0.3                                      | Partial: signed off-host checkpoints, export and independent verification.                                                                                        |
| Lottery                         | Fail-closed shells                                                                                    | Missing: approved rules, frozen snapshot, commitments/entropy, unbiased deterministic engine/vectors, independent verifier, signing/certification. No live draws. |
| Security / release              | Secret checks, owner/org denial tests, authenticated sessions                                         | Partial: independent security review, dependency/image/SBOM gates, backup restore, multi-project load and legal pilot approval.                                   |

## Required end-to-end acceptance

- [ ] Zalo dossier resumes on web after secure two-account linking.
- [ ] Original approved form layout preserved; field provenance, template version and citizen confirmation retained.
- [ ] OCR contradictions require human acceptance and cannot alter a declaration silently.
- [x] General preparation score is deterministic and explainable; never eligibility or lottery rank.
- [ ] Project/round checklist approved and all evidence references usable.
- [x] Current dossier APIs reject another owner; shared support is organization-scoped.
- [ ] All role/project/object download boundaries tested across the completed document/application workflow.
- [x] New operational events have immutable linked hashes and tampering tests.
- [ ] Signed external checkpoint and audit export verification.
- [ ] Submission retries yield one immutable application and reproducible receipt.
- [ ] Independent lottery verifier reproduces synthetic published test vectors.
- [ ] Backup restored and multi-project load tested before pilot.

Downloaded law/form sources must have original URL, hash, retrieval date, applicability and separate legal review status. Never turn source retrieval into an approval, nor substitute an AI draft for a statutory confirmation.
