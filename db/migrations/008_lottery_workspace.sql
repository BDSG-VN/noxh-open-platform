CREATE TABLE lottery_workspaces (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,title text NOT NULL,
 config jsonb NOT NULL,config_hash text NOT NULL,eligibility_snapshot jsonb NOT NULL DEFAULT '[]',status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','reviewed','frozen','seeded','drawn','certified','published','voided')),
 synthetic boolean NOT NULL DEFAULT true CHECK(synthetic),version integer NOT NULL DEFAULT 1,
 created_by text NOT NULL,reviewed_by text,executed_by text,certified_by text,
 commitment text,snapshot_hash text,entropy text,entropy_record text,result jsonb,minutes_hash text,void_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),frozen_at timestamptz,published_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),UNIQUE(organization_id,id),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by),CHECK(certified_by IS NULL OR (certified_by<>executed_by AND certified_by<>created_by))
);
CREATE TABLE identity_private.lottery_secrets (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,secret_cipher text NOT NULL,
 FOREIGN KEY(organization_id,id) REFERENCES lottery_workspaces(organization_id,id)
);
CREATE FUNCTION identity_private.protect_lottery_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'lottery evidence cannot be deleted'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.created_by,NEW.config,NEW.config_hash,NEW.eligibility_snapshot,NEW.title,NEW.synthetic,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.created_by,OLD.config,OLD.config_hash,OLD.eligibility_snapshot,OLD.title,OLD.synthetic,OLD.created_at) THEN RAISE EXCEPTION 'lottery configuration is immutable; create a replacement draft'; END IF;
 IF OLD.commitment IS NOT NULL AND (NEW.commitment,NEW.snapshot_hash,NEW.frozen_at) IS DISTINCT FROM (OLD.commitment,OLD.snapshot_hash,OLD.frozen_at) THEN RAISE EXCEPTION 'lottery commitment is immutable'; END IF;
 IF OLD.entropy IS NOT NULL AND (NEW.entropy,NEW.entropy_record) IS DISTINCT FROM (OLD.entropy,OLD.entropy_record) THEN RAISE EXCEPTION 'lottery entropy is immutable'; END IF;
 IF OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result THEN RAISE EXCEPTION 'lottery result is immutable'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='reviewed') OR (OLD.status='reviewed' AND NEW.status='frozen') OR (OLD.status='frozen' AND NEW.status='seeded') OR (OLD.status='seeded' AND NEW.status='drawn') OR (OLD.status='drawn' AND NEW.status='certified') OR (OLD.status='certified' AND NEW.status='published') OR (OLD.status<>'voided' AND NEW.status='voided' AND length(NEW.void_reason)>=10)) THEN RAISE EXCEPTION 'invalid lottery transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_lottery BEFORE UPDATE OR DELETE ON lottery_workspaces FOR EACH ROW EXECUTE FUNCTION identity_private.protect_lottery_workspace();
ALTER TABLE lottery_workspaces ENABLE ROW LEVEL SECURITY; ALTER TABLE lottery_workspaces FORCE ROW LEVEL SECURITY;
-- No citizen/partner runtime grants. Public projections are constructed explicitly by the API.
