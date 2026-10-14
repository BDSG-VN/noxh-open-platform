# ADR-007: Compose self-hosted development

Status: Accepted for Sprint 0

Compose includes application Postgres, Redis, Keycloak/dedicated Postgres, private S3-compatible MinIO, API, worker and three web shells. All exposed ports bind loopback. Development credentials are generated locally; start-dev is never production configuration. Image digests and least-privilege runtime identities are production backlog.
