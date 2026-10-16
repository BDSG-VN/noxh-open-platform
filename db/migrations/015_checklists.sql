-- Preparation guidance only: never an eligibility rule or an application gate.
CREATE TABLE project_preparation_checklists (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), payload jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','revoked')),
 approved_by text, approved_at timestamptz,
 effective_from date NOT NULL, effective_to date,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR
   (status IN('approved','revoked') AND approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL)),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 UNIQUE(organization_id,project_id,version)
);
CREATE TRIGGER immutable_preparation_checklist BEFORE UPDATE OR DELETE ON project_preparation_checklists FOR EACH ROW EXECUTE FUNCTION identity_private.protect_form_release();
CREATE INDEX checklist_project_versions ON project_preparation_checklists(organization_id,project_id,version DESC);
ALTER TABLE project_preparation_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_preparation_checklists FORCE ROW LEVEL SECURITY;
-- Workforce mutations use the API's private service role, as do legal releases.
GRANT SELECT ON project_preparation_checklists TO noxh_runtime;
CREATE POLICY preparation_checklist_project ON project_preparation_checklists FOR SELECT TO noxh_runtime
 USING(organization_id::text=current_setting('app.organization_id',true) AND EXISTS(
   SELECT 1 FROM projects p WHERE p.id=project_id AND p.organization_id=project_preparation_checklists.organization_id));
