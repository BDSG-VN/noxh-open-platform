# ADR 012 — Versioned preparation and purpose-specific support

Accepted 2026-10-15 for development. The owner expanded the initial scaffold into a real citizen/admin workflow and requested a complete implementation trace.

Declarations use strict `household-v1` validation and authenticated AES-GCM encryption bound to organization, owner and dossier. Whole-snapshot saves accept partial drafts, use mandatory If-Match and a row lock, and append immutable versions. Household relationships are opaque relational references; names and birth dates remain in encrypted declaration snapshots. Edits clear citizen confirmation in the UI. Server rejects impossible/future dates and incomplete confirmed snapshots.

`preparation-v1` is a deterministic general preparation checklist. Evidence not integrated or unverified receives no points; documents and forms remain zero. It is not an eligibility rule, legal checklist or rank. Assessments preserve checklist and input version and cannot be edited.

Preparation support is a separate context from official application intake/review. The citizen explicitly shares a message for this purpose; staff read this message, never private household declarations. One active request per dossier; versioned response and closure. Message and reply ciphertext use request-specific authenticated contexts.

New operations are chained under an organization advisory transaction lock using SHA-256 over a fixed JSON tuple. Inserted event and chain row commit atomically with the business transition. The viewer reports the bounded verification scope, legacy exclusion and missing off-host checkpoint. This cannot prevent a privileged attacker rewriting a complete chain without an external trust anchor.

Remaining controls are tracked in STATUS and IMPLEMENTATION-MATRIX: runtime least privilege, full staff role/project assignments, retention/withdrawal, verified documents/forms and official submission/review. No production security or legal certification is implied.
