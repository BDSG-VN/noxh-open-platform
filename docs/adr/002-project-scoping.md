# ADR-002: Postgres organization/project scoping

Status: Accepted for Sprint 0

UUIDs, composite foreign keys, organization/project RLS and owner access form the foundation. noxh_runtime is NOLOGIN and NOBYPASSRLS. Apply trusted transaction-local scopes after authenticated server authorization; never derive scope from a request header alone. Migration owner is privileged and must not be used for future business queries.
