CREATE TABLE identity_private.investor_employees (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),subject text NOT NULL,name text NOT NULL,
 department text NOT NULL CHECK(department IN('project_office','accounting','administration','legal','business')),
 status text NOT NULL CHECK(status IN('active','suspended')),permissions text[] NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,subject),UNIQUE(organization_id,id)
);
CREATE TABLE investor_employee_projects (
 organization_id uuid NOT NULL,employee_id uuid NOT NULL,project_id uuid NOT NULL,
 PRIMARY KEY(organization_id,employee_id,project_id),
 FOREIGN KEY(organization_id,employee_id) REFERENCES identity_private.investor_employees(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE investor_workflows (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','active')),
 template_version text NOT NULL DEFAULT 'investor-planning-v1',legal_note text NOT NULL DEFAULT '',created_by text NOT NULL,reviewed_by text,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),UNIQUE(organization_id,project_id),UNIQUE(organization_id,id)
);
CREATE TABLE investor_workflow_tasks (
 organization_id uuid NOT NULL,workflow_id uuid NOT NULL,code text NOT NULL,definition jsonb NOT NULL,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN('todo','in_progress','waiting_external','evidence_recorded','completed','not_applicable')),
 payload_cipher text NOT NULL,updated_by text,reviewed_by text,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,workflow_id,code),FOREIGN KEY(organization_id,workflow_id) REFERENCES investor_workflows(organization_id,id)
);
CREATE TABLE identity_private.investor_record_revisions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,record_id uuid NOT NULL,revision integer NOT NULL,
 title text NOT NULL,kind text NOT NULL CHECK(kind IN('wiki','record')),classification text NOT NULL CHECK(classification IN('internal','restricted')),
 payload_cipher text NOT NULL,content_hash text NOT NULL CHECK(length(content_hash)=64),status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','revoked')),
 created_by text NOT NULL,reviewed_by text,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),UNIQUE(organization_id,record_id,revision)
);
CREATE TABLE identity_private.investor_task_history (
 organization_id uuid NOT NULL,workflow_id uuid NOT NULL,code text NOT NULL,version integer NOT NULL,status text NOT NULL,
 payload_cipher text NOT NULL,updated_by text,reviewed_by text,recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,workflow_id,code,version),
 FOREIGN KEY(organization_id,workflow_id,code) REFERENCES investor_workflow_tasks(organization_id,workflow_id,code)
);
CREATE FUNCTION investor_task_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO identity_private.investor_task_history(organization_id,workflow_id,code,version,status,payload_cipher,updated_by,reviewed_by)
 VALUES(NEW.organization_id,NEW.workflow_id,NEW.code,NEW.version,NEW.status,NEW.payload_cipher,NEW.updated_by,NEW.reviewed_by);
 RETURN NEW;
END $$;
CREATE TRIGGER investor_task_snapshot AFTER INSERT OR UPDATE ON investor_workflow_tasks FOR EACH ROW EXECUTE FUNCTION investor_task_snapshot();
CREATE TRIGGER investor_task_history_immutable BEFORE UPDATE OR DELETE ON identity_private.investor_task_history FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TABLE identity_private.investor_journals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,journal_date date NOT NULL,
 payload_cipher text NOT NULL,content_hash text NOT NULL CHECK(length(content_hash)=64),debit_total bigint NOT NULL CHECK(debit_total>0),credit_total bigint NOT NULL CHECK(credit_total=debit_total),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','posted')),created_by text NOT NULL,posted_by text,version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),posted_at timestamptz,
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),CHECK(status<>'posted' OR (posted_by IS NOT NULL AND posted_by<>created_by AND posted_at IS NOT NULL))
);
CREATE FUNCTION investor_records_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.organization_id,NEW.project_id,NEW.record_id,NEW.revision,NEW.title,NEW.kind,NEW.classification,NEW.payload_cipher,NEW.content_hash,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.project_id,OLD.record_id,OLD.revision,OLD.title,OLD.kind,OLD.classification,OLD.payload_cipher,OLD.content_hash,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'immutable record revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER investor_records_immutable BEFORE UPDATE OR DELETE ON identity_private.investor_record_revisions FOR EACH ROW EXECUTE FUNCTION investor_records_immutable();
CREATE FUNCTION investor_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='posted' OR ROW(NEW.id,NEW.organization_id,NEW.project_id,NEW.journal_date,NEW.payload_cipher,NEW.content_hash,NEW.debit_total,NEW.credit_total,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.organization_id,OLD.project_id,OLD.journal_date,OLD.payload_cipher,OLD.content_hash,OLD.debit_total,OLD.credit_total,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'immutable journal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER investor_journal_immutable BEFORE UPDATE OR DELETE ON identity_private.investor_journals FOR EACH ROW EXECUTE FUNCTION investor_journal_immutable();
ALTER TABLE investor_employee_projects ENABLE ROW LEVEL SECURITY;ALTER TABLE investor_employee_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE investor_workflows ENABLE ROW LEVEL SECURITY;ALTER TABLE investor_workflows FORCE ROW LEVEL SECURITY;
ALTER TABLE investor_workflow_tasks ENABLE ROW LEVEL SECURITY;ALTER TABLE investor_workflow_tasks FORCE ROW LEVEL SECURITY;
-- Private workforce/content is deliberately not granted to citizen runtime roles.
