# Development restore runbook

Volumes are durable but not backups. Stop application writers, export PostgreSQL using pg_dump -Fc, and restore to a separate empty database with pg_restore; verify migrations and synthetic count before switching. Back up Keycloak DB and private object data consistently. Do not test restore on real BDSG infrastructure. Encryption, off-host backups, restore drills and capacity tests are release gates for Sprint 11; not completed in Sprint 0.
