CREATE TABLE identity_private.project_knowledge_revisions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 record_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 title text NOT NULL, content_cipher text NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 source_url text NOT NULL, source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), legal_basis text NOT NULL,
 mode text NOT NULL CHECK(mode IN('all','buy','rent-buy','rent')), subject_group integer CHECK(subject_group BETWEEN 1 AND 13),
 effective_from date NOT NULL, effective_to date CHECK(effective_to>=effective_from),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','revoked')),
 created_by text NOT NULL, reviewed_by text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='draft' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR
       (status IN('approved','revoked') AND reviewed_by IS NOT NULL AND reviewed_by<>created_by AND reviewed_at IS NOT NULL)),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 UNIQUE(organization_id,project_id,record_id,revision)
);
CREATE FUNCTION identity_private.protect_knowledge_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'knowledge revision cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_at']) THEN RAISE EXCEPTION 'knowledge payload is immutable'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status='approved') OR
         (OLD.status='approved' AND NEW.status='revoked' AND NEW.reviewed_by=OLD.reviewed_by AND NEW.reviewed_at=OLD.reviewed_at)) THEN RAISE EXCEPTION 'invalid knowledge transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_knowledge_revision BEFORE UPDATE OR DELETE ON identity_private.project_knowledge_revisions FOR EACH ROW EXECUTE FUNCTION identity_private.protect_knowledge_revision();
-- This private table is accessed only through scoped, reviewed service operations.
-- Citizen DB roles must never read drafts, ciphertext, or records for other projects.
ALTER TABLE identity_private.ai_proposals DROP CONSTRAINT ai_proposals_kind_check;
ALTER TABLE identity_private.ai_proposals ADD CONSTRAINT ai_proposals_kind_check CHECK(kind IN('declaration','support','form'));
