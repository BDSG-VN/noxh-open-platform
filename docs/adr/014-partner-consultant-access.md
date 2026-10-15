# ADR 014 — Partner campaigns and assigned consultant access

Accepted 2026-10-15 on explicit owner request for investor-managed partner agencies, campaign teams and individually permissioned consultants.

One verified phone session can identify a citizen or agency member, but never grants a partner role by itself. Every partner request looks up active phone-bound membership and active agency in the database. The separate portal has its own HttpOnly cookie and origin guard. No caller-provided role, agency or customer ID establishes authority.

An investor creates an agency, assigns projects and provisions its first administrator. Agency admins provision staff; campaign managers draft campaigns and assign consultations; consultants can read/update only assigned contacts. Every write rechecks role, agency, project grant and version inside a transaction. One active agency administrator must remain. Suspension and project withdrawal block future API access immediately.

Public campaign pages require investor approval, active agency/project grant and a published project. Editing approved content resets approval. Campaigns do not post externally or spend money. A customer shares a named-agency-specific consultation only after explicit consent; the verified account phone is used, and no dossier/declaration/document data is exposed. Contact/notes are encrypted at rest. Withdrawal clears the shared ciphertext and records consent withdrawal atomically. Investor dashboards show aggregate activity, not the agency's contact payload.

See [operator guide and role matrix](../PARTNERS.md). Tests cover unauthorized roles, cross-agency IDs, unassigned consultants, stale versions, approved publication, customer consent, withdrawal, member suspension, final-admin preservation and grant removal. Full project-scoped workforce roles, production least-privilege DB and independent privacy/security review remain outside this development release.
