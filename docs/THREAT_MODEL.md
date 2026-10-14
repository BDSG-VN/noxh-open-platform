# Threat model and privacy assessment draft

Status: engineering draft, not a completed DPIA/pentest or legal opinion.
Assets: citizen identity, declarations, private scans, submitted snapshots, review decisions, lottery evidence, keys.
Trust boundaries: web/Zalo→API; API→identity verification; API→DB/storage; isolated worker→document access; staff→privileged decisions; evidence→public.

| STRIDE            | Threat                                                              | Sprint 0 / required future control                                                                                 |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Spoofing          | Forged Zalo ID, unverified cookie or caller-supplied role           | No session issued; authenticated token verification/link re-authentication is deferred                             |
| Tampering         | Cross-project UUID, changed migration, mutable application snapshot | Composite FKs, owner RLS, deny-default policy tests, migration checksums; immutable submissions still deferred     |
| Repudiation       | Unlogged approval, self approval, draw retries                      | SoD policy denies self approval; no official operations exposed; audit writer/signing not implemented              |
| Disclosure        | Public S3 URL, logs/prompts containing PII                          | Private bucket init, synthetic fixtures, no document/AI ingestion; encryption and key management deferred          |
| Denial of service | Oversized files, XML/PDF bombs, costly AI request                   | No upload endpoint or AI processor; future quotas, quarantine scanner, isolated rendering and rate limits required |
| Elevation         | Global backend key proxy, infra admin reads PII                     | No key-injecting proxy; server policy excludes infra_admin; runtime authorization integration deferred             |

Privacy: no real PII collected in Sprint 0. Before pilots define controller/processor duties, purpose-specific consent, retention/deletion, data export/correction, legal basis, impact assessment and incident/restore process. No protected-characteristic readiness ranking, automatic eligibility or disclosure of real persons.
Residual risks: dev database owner bypasses RLS (health/migration only); generated local S3/root credentials are not production identities; scripts do not prove storage encryption or scanner readiness; infrastructure exposure depends on host/firewall. Startup/build success is not go-live approval.
