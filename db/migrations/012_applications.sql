CREATE TABLE applications (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,round_id uuid NOT NULL,dossier_id uuid NOT NULL,owner_user_id uuid NOT NULL,
 receipt_code text NOT NULL UNIQUE,public_code text NOT NULL UNIQUE,status text NOT NULL DEFAULT 'submitted' CHECK(status IN('submitted','under_review','supplement','recommended','approved','rejected','withdrawn')),
 snapshot_cipher text NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
 input_version integer NOT NULL,consent_notice_id uuid NOT NULL,synthetic boolean NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,assigned_reviewer text,recommendation_id uuid,
 decision_reason_cipher text,decision_reference_cipher text,decided_by text,
 version integer NOT NULL DEFAULT 1,submitted_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,dossier_id) REFERENCES prep_dossiers(organization_id,project_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,consent_notice_id) REFERENCES privacy_notices(organization_id,id),
 FOREIGN KEY(organization_id,project_id,round_id) REFERENCES intake_rounds(organization_id,project_id,id),
 UNIQUE(organization_id,owner_user_id,idempotency_key),UNIQUE(organization_id,project_id,dossier_id,id)
);
ALTER TABLE identity_private.inventory_queue ADD FOREIGN KEY(organization_id,project_id,dossier_id,application_id) REFERENCES applications(organization_id,project_id,dossier_id,id);
CREATE UNIQUE INDEX one_active_household_account_application ON applications(organization_id,owner_user_id) WHERE status IN('submitted','under_review','supplement','recommended','approved');
ALTER TABLE documents ADD CONSTRAINT documents_application_scope UNIQUE(organization_id,project_id,dossier_id,id);
CREATE TABLE application_documents (
 application_id uuid NOT NULL,document_id uuid NOT NULL,organization_id uuid NOT NULL,project_id uuid NOT NULL,dossier_id uuid NOT NULL,
 sha256 text NOT NULL,added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,document_id),
 FOREIGN KEY(organization_id,project_id,dossier_id,application_id) REFERENCES applications(organization_id,project_id,dossier_id,id),
 FOREIGN KEY(organization_id,project_id,dossier_id,document_id) REFERENCES documents(organization_id,project_id,dossier_id,id)
);
CREATE TABLE application_generated_forms (
 application_id uuid NOT NULL REFERENCES applications(id),form_id uuid NOT NULL REFERENCES generated_forms(id),sha256 text NOT NULL,
 added_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(application_id,form_id)
);
CREATE TABLE application_supplements (
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES applications(id),organization_id uuid NOT NULL,
 payload_cipher text NOT NULL,payload_hash text NOT NULL,input_version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application_reviews (
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES applications(id),organization_id uuid NOT NULL,
 input_version integer NOT NULL,eligible boolean NOT NULL,reviewer text NOT NULL,payload_cipher text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE applications ADD FOREIGN KEY(recommendation_id) REFERENCES application_reviews(id);
CREATE TABLE application_decisions (
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES applications(id),organization_id uuid NOT NULL,
 recommendation_id uuid NOT NULL REFERENCES application_reviews(id),approved boolean NOT NULL,approver text NOT NULL,
 reference_cipher text NOT NULL,reason_cipher text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application_appeals (
 id uuid PRIMARY KEY,application_id uuid NOT NULL REFERENCES applications(id),organization_id uuid NOT NULL,owner_user_id uuid NOT NULL,
 message_cipher text NOT NULL,reply_cipher text,status text NOT NULL DEFAULT 'open' CHECK(status IN('open','responded')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_open_application_appeal ON application_appeals(application_id) WHERE status='open';
CREATE FUNCTION identity_private.protect_application_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'submitted application cannot be deleted'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.round_id,NEW.dossier_id,NEW.owner_user_id,NEW.receipt_code,NEW.public_code,NEW.snapshot_cipher,NEW.snapshot_hash,NEW.input_version,NEW.consent_notice_id,NEW.synthetic,NEW.idempotency_key,NEW.request_hash,NEW.submitted_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.round_id,OLD.dossier_id,OLD.owner_user_id,OLD.receipt_code,OLD.public_code,OLD.snapshot_cipher,OLD.snapshot_hash,OLD.input_version,OLD.consent_notice_id,OLD.synthetic,OLD.idempotency_key,OLD.request_hash,OLD.submitted_at) THEN RAISE EXCEPTION 'application snapshot is immutable'; END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'application version must advance'; END IF;
 IF NOT ((OLD.status='submitted' AND NEW.status IN('under_review','withdrawn')) OR (OLD.status='under_review' AND NEW.status IN('under_review','supplement','recommended','withdrawn')) OR (OLD.status='supplement' AND NEW.status IN('submitted','withdrawn')) OR (OLD.status='recommended' AND NEW.status IN('approved','rejected','under_review','withdrawn')) OR (OLD.status='rejected' AND NEW.status='under_review')) THEN RAISE EXCEPTION 'invalid application transition'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_application_snapshot BEFORE UPDATE OR DELETE ON applications FOR EACH ROW EXECUTE FUNCTION identity_private.protect_application_snapshot();
CREATE TRIGGER immutable_application_documents BEFORE UPDATE OR DELETE ON application_documents FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_application_forms BEFORE UPDATE OR DELETE ON application_generated_forms FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_application_supplements BEFORE UPDATE OR DELETE ON application_supplements FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_application_reviews BEFORE UPDATE OR DELETE ON application_reviews FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER immutable_application_decisions BEFORE UPDATE OR DELETE ON application_decisions FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;ALTER TABLE applications FORCE ROW LEVEL SECURITY;
GRANT SELECT ON applications TO noxh_runtime;
CREATE POLICY application_owner ON applications FOR SELECT TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true));
ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY; ALTER TABLE application_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE application_generated_forms ENABLE ROW LEVEL SECURITY; ALTER TABLE application_generated_forms FORCE ROW LEVEL SECURITY;
ALTER TABLE application_supplements ENABLE ROW LEVEL SECURITY; ALTER TABLE application_supplements FORCE ROW LEVEL SECURITY;
ALTER TABLE application_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE application_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE application_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE application_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE application_appeals ENABLE ROW LEVEL SECURITY; ALTER TABLE application_appeals FORCE ROW LEVEL SECURITY;
-- PII projections/decisions are granted only by application service authorization, never by a public runtime policy.
