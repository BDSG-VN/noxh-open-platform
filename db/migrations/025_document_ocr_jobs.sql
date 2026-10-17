-- 024: self-hosted OCR queue (ADR 020). One job per clean-scanned private document, requested by
-- its owner with purpose-specific consent; the worker claims jobs with a fenced lease, calls the
-- local ai-worker and stores the recognised text encrypted (AES-GCM, AAD bound to the job). Only
-- reason codes are stored in clear. Default off; results feed document_extractions as model
-- 'local-ocr:*' and still need the citizen's explicit field-by-field acceptance.
CREATE TABLE identity_private.document_ocr_jobs(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,dossier_id uuid NOT NULL,document_id uuid NOT NULL,owner_user_id uuid NOT NULL,
 source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'),consent_id uuid NOT NULL REFERENCES consent_records(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','succeeded','failed','cancelled')),
 reason text CHECK(reason IN('worker_unavailable','worker_timeout','worker_rejected','invalid_result','document_unavailable','consent_unavailable','attempts_exhausted','processing_failed','cancelled_by_owner','requeued')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),attempt_budget integer NOT NULL DEFAULT 3 CHECK(attempt_budget BETWEEN 1 AND 3),
 requeue_count integer NOT NULL DEFAULT 0 CHECK(requeue_count BETWEEN 0 AND 2),worker_failures integer NOT NULL DEFAULT 0 CHECK(worker_failures BETWEEN 0 AND 5),
 lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 quality_score double precision CHECK(quality_score BETWEEN 0 AND 1),low_quality boolean,engine text CHECK(engine~'^[a-z][a-z0-9-]{0,39}$'),
 processing_ms integer CHECK(processing_ms>=0),result_cipher text,extraction_id uuid REFERENCES document_extractions(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,dossier_id,document_id) REFERENCES documents(organization_id,dossier_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id),
 CHECK((status='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status='succeeded')=(result_cipher IS NOT NULL AND quality_score IS NOT NULL AND low_quality IS NOT NULL AND engine IS NOT NULL AND extraction_id IS NOT NULL))
);
CREATE INDEX document_ocr_jobs_due ON identity_private.document_ocr_jobs(organization_id,status,next_attempt_at);
CREATE INDEX document_ocr_jobs_owner ON identity_private.document_ocr_jobs(organization_id,dossier_id,owner_user_id,created_at);
CREATE UNIQUE INDEX document_ocr_jobs_active ON identity_private.document_ocr_jobs(organization_id,document_id) WHERE status IN('pending','running');
CREATE FUNCTION identity_private.protect_document_ocr_job() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, identity_private, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ocr job evidence cannot be deleted'; END IF;
 IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.dossier_id<>OLD.dossier_id OR NEW.document_id<>OLD.document_id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.source_hash<>OLD.source_hash OR NEW.consent_id<>OLD.consent_id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'ocr job identity immutable'; END IF;
 IF OLD.status IN('succeeded','cancelled') THEN RAISE EXCEPTION 'ocr job is final'; END IF;
 IF OLD.result_cipher IS NOT NULL OR OLD.extraction_id IS NOT NULL THEN RAISE EXCEPTION 'ocr result immutable'; END IF;
 IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 THEN RAISE EXCEPTION 'invalid ocr attempt'; END IF;
 IF NEW.requeue_count<OLD.requeue_count OR NEW.requeue_count>OLD.requeue_count+1 THEN RAISE EXCEPTION 'invalid ocr requeue'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_ocr_job_guard BEFORE UPDATE OR DELETE ON identity_private.document_ocr_jobs FOR EACH ROW EXECUTE FUNCTION identity_private.protect_document_ocr_job();
ALTER TABLE identity_private.document_ocr_jobs ENABLE ROW LEVEL SECURITY; ALTER TABLE identity_private.document_ocr_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_private.document_ocr_jobs FROM PUBLIC,noxh_runtime;
-- Least-privilege runtime grants (ADR 018): derived from the API SQL inventory with
-- scripts/runtime-privileges.mjs and reviewed; runtime-privileges.test.ts recomputes them.
GRANT INSERT, SELECT ON "identity_private"."document_ocr_jobs" TO noxh_app;
GRANT UPDATE ("attempt_budget", "attempt_count", "engine", "extraction_id", "lease_token", "lease_until", "low_quality", "next_attempt_at", "processing_ms", "quality_score", "reason", "requeue_count", "result_cipher", "status", "updated_at", "version", "worker_failures") ON "identity_private"."document_ocr_jobs" TO noxh_app;
CREATE POLICY noxh_app_scope ON "identity_private"."document_ocr_jobs" TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
CREATE POLICY noxh_app_guard ON "identity_private"."document_ocr_jobs" AS RESTRICTIVE TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
