# ADR-008: Transactional outbox and versioned migrations

Status: Accepted for Sprint 0

SQL migration runner locks and applies checksum-verified migrations in a transaction. Outbox and append-only audit table permission skeletons exist but no delivery or audit hash-chain writer is implemented. Future state changes must atomically commit state and outbox/audit events.
