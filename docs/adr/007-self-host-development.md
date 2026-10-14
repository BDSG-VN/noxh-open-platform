# ADR-007: Compose self-hosted development

Status: Accepted for Sprint 0

Compose includes application Postgres, Redis, Keycloak/dedicated Postgres, private S3-compatible MinIO, API, worker and three web shells. All exposed ports bind loopback. Development credentials are generated locally; start-dev is never production configuration. Image digests and least-privilege runtime identities are production backlog.

CI found MinIO vendor image pulls unavailable on Docker Hub and Quay. Storage images now compile the two pinned official upstream commits (see THIRD_PARTY_NOTICES.md), retaining their licenses inside the images. Builds need network access to GitHub and Go module mirrors. This trades a slower first build for an independently buildable development stack; hardened production storage remains a separate gate.
