CREATE TABLE lottery_cohorts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,round_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN('buy','rent-buy','rent')),kind text NOT NULL CHECK(kind IN('selection','priority-overflow','allocation')),
 seats integer NOT NULL CHECK(seats BETWEEN 1 AND 500),entries jsonb NOT NULL,source_snapshot jsonb NOT NULL,
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),cohort_hash text NOT NULL CHECK(cohort_hash~'^[a-f0-9]{64}$'),membership_hash text NOT NULL CHECK(membership_hash~'^[a-f0-9]{64}$'),
 payload_cipher text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','reviewed','voided','superseded')),
 created_by text NOT NULL,reviewed_by text,reviewed_at timestamptz,voided_by text,void_reason_cipher text,
 supersedes_id uuid REFERENCES lottery_cohorts(id) UNIQUE,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,round_id) REFERENCES intake_rounds(organization_id,project_id,id),
 UNIQUE(organization_id,id),CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
ALTER TABLE lottery_workspaces ADD COLUMN cohort_id uuid NOT NULL REFERENCES lottery_cohorts(id) UNIQUE;
ALTER TABLE lottery_workspaces ADD FOREIGN KEY(organization_id,cohort_id) REFERENCES lottery_cohorts(organization_id,id);
CREATE FUNCTION identity_private.protect_lottery_cohort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'lottery cohort evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at','voided_by','void_reason_cipher','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at','voided_by','void_reason_cipher','version','updated_at']) THEN RAISE EXCEPTION 'lottery cohort definition is immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'cohort version must advance'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='reviewed' AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_by<>NEW.created_by AND NEW.reviewed_at IS NOT NULL) OR (OLD.status IN('draft','reviewed') AND NEW.status='voided' AND NEW.voided_by IS NOT NULL AND NEW.void_reason_cipher IS NOT NULL) OR (OLD.status IN('reviewed','voided') AND NEW.status='superseded')) THEN RAISE EXCEPTION 'invalid cohort transition'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER immutable_lottery_cohort BEFORE UPDATE OR DELETE ON lottery_cohorts FOR EACH ROW EXECUTE FUNCTION identity_private.protect_lottery_cohort();
CREATE FUNCTION identity_private.protect_lottery_cohort_binding() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.cohort_id IS DISTINCT FROM OLD.cohort_id THEN RAISE EXCEPTION 'lottery cohort binding is immutable'; END IF;RETURN NEW;END $$;
CREATE TRIGGER immutable_lottery_cohort_binding BEFORE UPDATE ON lottery_workspaces FOR EACH ROW EXECUTE FUNCTION identity_private.protect_lottery_cohort_binding();
ALTER TABLE lottery_cohorts ENABLE ROW LEVEL SECURITY;ALTER TABLE lottery_cohorts FORCE ROW LEVEL SECURITY;
-- Full population and exclusion reasons are private workforce evidence. Public API exposes hashes only.
