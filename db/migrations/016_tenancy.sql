-- Synthetic contract lifecycle. No signature, statutory ledger or live collection.
ALTER TABLE applications ADD CONSTRAINT applications_tenancy_owner UNIQUE(organization_id,project_id,id,owner_user_id);
CREATE TABLE identity_private.tenancy_contracts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,application_id uuid NOT NULL,dossier_id uuid NOT NULL,owner_user_id uuid NOT NULL,unit_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN('buy','rent','rent-buy')),payload_cipher text NOT NULL,snapshot_hash text NOT NULL,
 starts_on date NOT NULL,ends_on date NOT NULL,total_vnd numeric(30,0) NOT NULL CHECK(total_vnd>0),handover_required_vnd numeric(30,0) NOT NULL CHECK(handover_required_vnd>=0 AND handover_required_vnd<=total_vnd),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected','acknowledged_demo','handed_over_demo','terminated_demo','released_demo')),
 created_by text NOT NULL,reviewed_by text,review_cipher text,version integer NOT NULL DEFAULT 1,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,id),UNIQUE(organization_id,idempotency_key),
 FOREIGN KEY(organization_id,project_id,dossier_id,application_id) REFERENCES applications(organization_id,project_id,dossier_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,project_id,application_id,owner_user_id) REFERENCES applications(organization_id,project_id,id,owner_user_id),
 FOREIGN KEY(organization_id,project_id,unit_id) REFERENCES inventory_units(organization_id,project_id,id),
 CHECK(ends_on>=starts_on),CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE UNIQUE INDEX tenancy_one_live_unit ON identity_private.tenancy_contracts(organization_id,unit_id) WHERE status NOT IN('rejected','released_demo');
CREATE UNIQUE INDEX tenancy_one_live_application ON identity_private.tenancy_contracts(organization_id,application_id) WHERE status NOT IN('rejected','released_demo');
CREATE TABLE identity_private.tenancy_dues (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,contract_id uuid NOT NULL,due_on date NOT NULL,amount_vnd numeric(30,0) NOT NULL CHECK(amount_vnd>0),label_cipher text NOT NULL,action_id uuid,
 UNIQUE(organization_id,project_id,contract_id,id),FOREIGN KEY(organization_id,project_id,contract_id) REFERENCES identity_private.tenancy_contracts(organization_id,project_id,id)
);
CREATE TABLE identity_private.tenancy_payments (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,contract_id uuid NOT NULL,due_id uuid NOT NULL,
 amount_vnd numeric(30,0) NOT NULL CHECK(amount_vnd>0),reference_hash text NOT NULL,reference_cipher text NOT NULL,evidence_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','reconciled_demo','rejected')),created_by text NOT NULL,reviewed_by text,review_cipher text,version integer NOT NULL DEFAULT 1,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,reference_hash),UNIQUE(organization_id,idempotency_key),
 FOREIGN KEY(organization_id,project_id,contract_id,due_id) REFERENCES identity_private.tenancy_dues(organization_id,project_id,contract_id,id),CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE TABLE identity_private.tenancy_actions (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,contract_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('handover','extend','terminate','return')),payload_cipher text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected')),created_by text NOT NULL,reviewed_by text,review_cipher text,owner_confirmed boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key),UNIQUE(organization_id,project_id,contract_id,id),FOREIGN KEY(organization_id,project_id,contract_id) REFERENCES identity_private.tenancy_contracts(organization_id,project_id,id),CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE UNIQUE INDEX tenancy_one_pending_action ON identity_private.tenancy_actions(contract_id) WHERE status='pending';
ALTER TABLE identity_private.tenancy_dues ADD FOREIGN KEY(organization_id,project_id,contract_id,action_id) REFERENCES identity_private.tenancy_actions(organization_id,project_id,contract_id,id);
CREATE FUNCTION identity_private.protect_tenancy_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'tenancy evidence cannot be deleted'; END IF;
 IF TG_TABLE_NAME='tenancy_contracts' THEN
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.application_id,NEW.dossier_id,NEW.owner_user_id,NEW.unit_id,NEW.mode,NEW.payload_cipher,NEW.snapshot_hash,NEW.starts_on,NEW.handover_required_vnd,NEW.created_by,NEW.idempotency_key,NEW.request_hash,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.application_id,OLD.dossier_id,OLD.owner_user_id,OLD.unit_id,OLD.mode,OLD.payload_cipher,OLD.snapshot_hash,OLD.starts_on,OLD.handover_required_vnd,OLD.created_by,OLD.idempotency_key,OLD.request_hash,OLD.created_at) THEN RAISE EXCEPTION 'contract snapshot is immutable'; END IF;
 ELSE
  IF OLD.status<>'pending' THEN RAISE EXCEPTION 'tenancy review is final'; END IF;
  IF TG_TABLE_NAME='tenancy_payments' AND (NEW.status NOT IN('reconciled_demo','rejected') OR NEW.reviewed_by IS NULL OR NEW.review_cipher IS NULL) THEN RAISE EXCEPTION 'payment review evidence required'; END IF;
  IF TG_TABLE_NAME='tenancy_actions' THEN
   IF NOT ((NEW.status='pending' AND OLD.owner_confirmed=false AND NEW.owner_confirmed=true AND NEW.reviewed_by IS NULL) OR (NEW.status IN('approved','rejected') AND NEW.reviewed_by IS NOT NULL AND NEW.review_cipher IS NOT NULL)) THEN RAISE EXCEPTION 'action transition evidence required'; END IF;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_cipher','version','owner_confirmed']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_cipher','version','owner_confirmed']) THEN RAISE EXCEPTION 'tenancy evidence is immutable'; END IF;
 END IF;
 IF NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'tenancy version must advance'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tenancy_contract_guard BEFORE UPDATE OR DELETE ON identity_private.tenancy_contracts FOR EACH ROW EXECUTE FUNCTION identity_private.protect_tenancy_evidence();
CREATE TRIGGER tenancy_payment_guard BEFORE UPDATE OR DELETE ON identity_private.tenancy_payments FOR EACH ROW EXECUTE FUNCTION identity_private.protect_tenancy_evidence();
CREATE TRIGGER tenancy_action_guard BEFORE UPDATE OR DELETE ON identity_private.tenancy_actions FOR EACH ROW EXECUTE FUNCTION identity_private.protect_tenancy_evidence();
CREATE TRIGGER tenancy_due_guard BEFORE UPDATE OR DELETE ON identity_private.tenancy_dues FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
-- Serialize old allocation entry points with new tenant reservations.
CREATE FUNCTION identity_private.check_tenancy_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM inventory_units WHERE id=NEW.unit_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM identity_private.tenancy_contracts c WHERE c.organization_id=NEW.organization_id AND c.unit_id=NEW.unit_id AND c.status NOT IN('rejected','released_demo') AND (c.mode<>'buy' OR c.application_id<>(SELECT application_id FROM identity_private.inventory_queue WHERE id=NEW.queue_id))) THEN RAISE EXCEPTION 'unit reserved by tenancy contract'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_tenancy_reservation BEFORE INSERT ON inventory_allocations FOR EACH ROW EXECUTE FUNCTION identity_private.check_tenancy_allocation();
ALTER TABLE identity_private.tenancy_contracts ENABLE ROW LEVEL SECURITY;ALTER TABLE identity_private.tenancy_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_private.tenancy_dues ENABLE ROW LEVEL SECURITY;ALTER TABLE identity_private.tenancy_dues FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_private.tenancy_payments ENABLE ROW LEVEL SECURITY;ALTER TABLE identity_private.tenancy_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_private.tenancy_actions ENABLE ROW LEVEL SECURITY;ALTER TABLE identity_private.tenancy_actions FORCE ROW LEVEL SECURITY;
-- No direct citizen/partner grants; scoped service projections only. Production runtime role remains a separate release gate.
