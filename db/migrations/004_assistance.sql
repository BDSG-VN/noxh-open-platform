CREATE TABLE identity_private.ai_settings (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), enabled boolean NOT NULL DEFAULT false,
 model text NOT NULL, daily_limit integer NOT NULL CHECK(daily_limit BETWEEN 1 AND 1000), key_cipher text NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE identity_private.ai_runs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), owner_user_id uuid NOT NULL,
 dossier_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL CHECK(status IN('running','completed','failed')),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX ai_daily_usage ON identity_private.ai_runs(organization_id,created_at);
CREATE TABLE identity_private.ai_proposals (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, owner_user_id uuid NOT NULL, dossier_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('declaration','support')), payload_cipher text NOT NULL, input_version integer NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id)
);
CREATE TABLE online_cases (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, dossier_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 procedure_id text NOT NULL CHECK(procedure_id IN('1.014632','1.012896')),
 details_cipher text NOT NULL, source text NOT NULL DEFAULT 'citizen-reported' CHECK(source='citizen-reported'),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,dossier_id) REFERENCES prep_dossiers(organization_id,project_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id)
);
CREATE TABLE project_form_releases (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 form_id text NOT NULL, title text NOT NULL, source_hash text NOT NULL, catalog_version text NOT NULL,
 recipient text NOT NULL, instructions text NOT NULL, mode text NOT NULL CHECK(mode IN('buy','rent-buy','rent')),
 subject_group integer NOT NULL CHECK(subject_group BETWEEN 1 AND 13), created_by text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','revoked')), approved_by text, approved_at timestamptz,
 effective_from date NOT NULL DEFAULT CURRENT_DATE, effective_to date,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status IN('approved','revoked') AND approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL)),
 version integer NOT NULL CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 UNIQUE(organization_id,project_id,form_id,mode,subject_group,version)
);
CREATE FUNCTION identity_private.protect_form_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'form release cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approved_by','approved_at']) THEN RAISE EXCEPTION 'form release payload is immutable'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='approved') OR (OLD.status='approved' AND NEW.status='revoked' AND NEW.approved_by=OLD.approved_by AND NEW.approved_at=OLD.approved_at)) THEN RAISE EXCEPTION 'invalid form release transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_form_release BEFORE UPDATE OR DELETE ON project_form_releases FOR EACH ROW EXECUTE FUNCTION identity_private.protect_form_release();
ALTER TABLE online_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE online_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE project_form_releases ENABLE ROW LEVEL SECURITY; ALTER TABLE project_form_releases FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON online_cases TO noxh_runtime;
GRANT SELECT ON project_form_releases TO noxh_runtime;
CREATE POLICY online_case_owner ON online_cases TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true) AND EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=online_cases.organization_id)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true) AND EXISTS(SELECT 1 FROM prep_dossiers d WHERE d.id=dossier_id AND d.organization_id=online_cases.organization_id));
CREATE POLICY published_forms ON project_form_releases FOR SELECT TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND EXISTS(SELECT 1 FROM projects p WHERE p.id=project_id AND p.organization_id=project_form_releases.organization_id));
