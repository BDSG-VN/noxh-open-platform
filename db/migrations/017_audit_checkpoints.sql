-- Signed checkpoints are evidence, not an automatic claim of off-host custody.
CREATE TABLE identity_private.audit_checkpoint_proposals (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 request_ref uuid NOT NULL, requested_by text NOT NULL CHECK(requested_by ~ '^[a-f0-9]{64}$'),
 proposal jsonb NOT NULL, proposal_hash text NOT NULL CHECK(proposal_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_ref), UNIQUE(organization_id,id), UNIQUE(organization_id,id,requested_by)
);
CREATE TABLE identity_private.audit_checkpoints (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>=0), event_count bigint NOT NULL CHECK(event_count>=0 AND event_count<=sequence),
 head text NOT NULL CHECK(head ~ '^[a-f0-9]{64}$'),
 envelope jsonb NOT NULL, envelope_hash text NOT NULL CHECK(envelope_hash ~ '^[a-f0-9]{64}$'),
 previous_hash text, proposed_by text NOT NULL, imported_by text NOT NULL CHECK(imported_by ~ '^[a-f0-9]{64}$'),
 imported_at timestamptz NOT NULL DEFAULT now(), CHECK(proposed_by<>imported_by),
 FOREIGN KEY(organization_id,id,proposed_by) REFERENCES identity_private.audit_checkpoint_proposals(organization_id,id,requested_by),
 UNIQUE(organization_id,sequence), UNIQUE(organization_id,envelope_hash),
 FOREIGN KEY(organization_id,previous_hash) REFERENCES identity_private.audit_checkpoints(organization_id,envelope_hash)
);
CREATE INDEX checkpoint_latest ON identity_private.audit_checkpoints(organization_id,sequence DESC);
CREATE TRIGGER immutable_checkpoint_proposals BEFORE UPDATE OR DELETE ON identity_private.audit_checkpoint_proposals FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_signed_checkpoints BEFORE UPDATE OR DELETE ON identity_private.audit_checkpoints FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
ALTER TABLE identity_private.audit_checkpoint_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_private.audit_checkpoint_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_private.audit_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_private.audit_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY checkpoint_proposal_scope ON identity_private.audit_checkpoint_proposals
 USING(organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
CREATE POLICY checkpoint_scope ON identity_private.audit_checkpoints
 USING(organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
-- Existing citizen runtime receives no new access to organization-wide audit.
REVOKE ALL ON identity_private.audit_checkpoint_proposals,identity_private.audit_checkpoints FROM PUBLIC,noxh_runtime;
