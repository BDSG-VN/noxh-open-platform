CREATE TABLE households (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id), UNIQUE(organization_id,id)
);
ALTER TABLE prep_dossiers ADD COLUMN household_id uuid;
ALTER TABLE prep_dossiers ADD FOREIGN KEY(organization_id,household_id) REFERENCES households(organization_id,id);
CREATE TABLE household_members (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, household_id uuid NOT NULL, person_ref text NOT NULL,
 relationship text NOT NULL CHECK(relationship IN('owner','spouse','child','parent','other')),
 valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
 FOREIGN KEY(organization_id,household_id) REFERENCES households(organization_id,id)
);
CREATE TABLE readiness_assessments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, dossier_id uuid NOT NULL,
 input_version integer NOT NULL, checklist_version text NOT NULL, score integer NOT NULL CHECK(score BETWEEN 0 AND 100),
 result_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,dossier_id) REFERENCES prep_dossiers(organization_id,project_id,id)
);
CREATE TABLE preparation_requests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, dossier_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 message_cipher text NOT NULL, reply_cipher text, status text NOT NULL DEFAULT 'open' CHECK(status IN('open','responded','closed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,dossier_id) REFERENCES prep_dossiers(organization_id,project_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id)
);
CREATE UNIQUE INDEX one_active_preparation_request ON preparation_requests(dossier_id) WHERE status IN('open','responded');
CREATE TABLE identity_private.audit_chain (
 sequence bigserial PRIMARY KEY, id uuid NOT NULL UNIQUE REFERENCES identity_private.operations(id),
 organization_id uuid NOT NULL REFERENCES organizations(id), actor_ref text NOT NULL, action text NOT NULL, resource_ref text NOT NULL,
 occurred_at text NOT NULL, prev_hash text NOT NULL, event_hash text NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$')
);
CREATE TRIGGER immutable_audit_chain BEFORE UPDATE OR DELETE ON identity_private.audit_chain FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_declarations BEFORE UPDATE OR DELETE ON declaration_versions FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_readiness BEFORE UPDATE OR DELETE ON readiness_assessments FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE INDEX audit_org_sequence ON identity_private.audit_chain(organization_id,sequence);
CREATE INDEX declaration_latest ON declaration_versions(dossier_id,version DESC);
CREATE INDEX requests_org_status ON preparation_requests(organization_id,status,created_at);
ALTER TABLE households ENABLE ROW LEVEL SECURITY; ALTER TABLE households FORCE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY; ALTER TABLE household_members FORCE ROW LEVEL SECURITY;
ALTER TABLE readiness_assessments ENABLE ROW LEVEL SECURITY; ALTER TABLE readiness_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE preparation_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE preparation_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON households,household_members,preparation_requests TO noxh_runtime;
GRANT SELECT,INSERT ON readiness_assessments TO noxh_runtime;
CREATE POLICY household_owner ON households TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true));
CREATE POLICY member_owner ON household_members TO noxh_runtime USING(EXISTS(SELECT 1 FROM households h WHERE h.id=household_id AND h.organization_id=household_members.organization_id)) WITH CHECK(EXISTS(SELECT 1 FROM households h WHERE h.id=household_id AND h.organization_id=household_members.organization_id));
CREATE POLICY readiness_owner ON readiness_assessments TO noxh_runtime USING(EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=readiness_assessments.organization_id AND d.project_id=readiness_assessments.project_id)) WITH CHECK(EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=readiness_assessments.organization_id AND d.project_id=readiness_assessments.project_id));
CREATE POLICY preparation_request_owner ON preparation_requests TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true) AND EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=preparation_requests.organization_id AND d.project_id=preparation_requests.project_id)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true) AND EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=preparation_requests.organization_id AND d.project_id=preparation_requests.project_id));
