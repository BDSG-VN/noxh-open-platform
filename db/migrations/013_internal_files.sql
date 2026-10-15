CREATE TABLE identity_private.investor_files(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,created_by text NOT NULL,
 department text NOT NULL CHECK(department IN('project_office','accounting','administration','legal','business')),
 classification text NOT NULL DEFAULT 'restricted' CHECK(classification='restricted'),metadata_cipher text NOT NULL,
 object_key text NOT NULL UNIQUE,envelope_key_cipher text NOT NULL,sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 mime text NOT NULL CHECK(mime IN('application/pdf','image/jpeg','image/png')),bytes integer NOT NULL CHECK(bytes BETWEEN 10 AND 5242880),
 scan_status text NOT NULL DEFAULT 'quarantined' CHECK(scan_status IN('quarantined','clean','rejected')),scan_details_cipher text,scanned_at timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),UNIQUE(organization_id,project_id,id)
);
CREATE TABLE identity_private.investor_record_files(
 record_revision_id uuid NOT NULL REFERENCES identity_private.investor_record_revisions(id),file_id uuid NOT NULL,
 organization_id uuid NOT NULL,project_id uuid NOT NULL,sha256 text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(record_revision_id,file_id),FOREIGN KEY(organization_id,project_id,file_id) REFERENCES identity_private.investor_files(organization_id,project_id,id)
);
CREATE FUNCTION identity_private.protect_internal_file() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'internal file source cannot be deleted'; END IF;
 IF OLD.scan_status='rejected' OR (to_jsonb(NEW)-ARRAY['scan_status','scan_details_cipher','scanned_at','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['scan_status','scan_details_cipher','scanned_at','version','updated_at']) THEN RAISE EXCEPTION 'internal file source is immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'internal file version must advance'; END IF;RETURN NEW; END $$;
CREATE TRIGGER immutable_internal_file BEFORE UPDATE OR DELETE ON identity_private.investor_files FOR EACH ROW EXECUTE FUNCTION identity_private.protect_internal_file();
CREATE TRIGGER immutable_internal_file_binding BEFORE UPDATE OR DELETE ON identity_private.investor_record_files FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE INDEX investor_files_project ON identity_private.investor_files(organization_id,project_id,created_at);
-- These private tables are intentionally not granted to the citizen runtime role.
