# 011 — Investor admin and phone channel access

Accepted 2026-10-15. The owner explicitly requested actual admin backend, customer dashboard, phone OTP through Zalo and investor-managed provider configuration, extending the initial Sprint 0 scope.

Use Keycloak Authorization Code + PKCE with required password/TOTP and signed AMR verification for org_admin. Keep organization binding server-side; reserve project_manager until project assignments exist. BFF cookies are HttpOnly with same-origin write checks; OAuth state cookie is SameSite=Lax to allow IdP callback. No default human users.

Phone OTP uses approved investor-owned Zalo template transport, encrypted credentials/phone, keyed phone and OTP references, short-lived single-use challenge plus browser proof, bounded attempts and opaque revocable sessions. Provider failure cannot create sessions. Do not merge identities based on phone. Persist explicit authentication purpose consent on successful verification. Dashboard holds preparatory dossier references, not legal submissions or sensitive documents.

Business writes are parameterized and scoped, versioned for edits and transactionally audited. Soft archive preserves dossiers. Runtime currently uses development owner DB credentials; minimal DB role/RLS wiring, retention, recovery and production governance remain outstanding. See ADMIN-AND-ZALO.md for setup, provider prerequisites and tested/untested boundaries.
