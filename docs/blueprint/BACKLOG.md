# Backlog — proposed, 2-week sprints

| Sprint | Deliverable | Acceptance gate |
|---|---|---|
| 0 | Monorepo, Compose, CI, ADRs, threat model | clean setup, tests, no secrets |
| 1 | Organization/project scopes, Keycloak, citizen identity model | cross-project denial tests |
| 2 | Zalo SDK adapter, web login, secure identity linking | cross-channel continuity test |
| 3 | Public projects, campaigns, opt-in lead intake | permission and consent tests |
| 4 | Household/dossier declarations, schema-driven wizard | resume draft on both channels |
| 5 | Document storage, quarantine, malware scan, versioning | unsafe upload rejected |
| 6 | Readiness rules and AI guidance with local mock | deterministic score and explanations |
| 7 | Form registry, approved templates, PDF rendering | pixel/field snapshot checks |
| 8 | External confirmation tracking and OCR review | no silent overwrite |
| 9 | Official submission, receipt, reviewer workflow | idempotency, audit, SoD |
| 10 | Lottery protocol library and independent verifier | published vectors reproduce |
| 11 | Security hardening, multi-project load, backup restore | signed UAT and pentest |
| 12 | Pilot release with synthetic dry-run, legal signoff | go/no-go checklist |

P0: security, consent, project scoping, citizen dossier, approved forms, official submission and audit. P1: AI OCR/RAG, notifications, reports. P2: partner/bank portal, payments, contract management. Production lottery is blocked until external audit and legal approval.

## Initial issues
- [ ] ADR-001 boundaries and transaction strategy
- [ ] Threat model, data classification, DPIA
- [ ] Schema migrations and row/project scoping
- [ ] Zalo token verification spike against current SDK
- [ ] Citizen account linking UX + abuse prevention
- [ ] Versioned checklist schema and deterministic scoring
- [ ] Legal form inventory and template approval workflow
- [ ] PDF render comparison fixtures
- [ ] OCR suggestions and human confirmation UI
- [ ] Official submission receipt and immutable snapshot
- [ ] Lottery algorithm RFC, seed ceremony and test vectors
- [ ] Restore drill and penetration testing plan
