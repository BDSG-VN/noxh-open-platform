CREATE TABLE inventory_boards (
 organization_id uuid NOT NULL,project_id uuid NOT NULL,version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,project_id),FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE inventory_units (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,code text NOT NULL,
 building text NOT NULL,floor integer NOT NULL,position integer NOT NULL,area_cm2 integer NOT NULL CHECK(area_cm2>0),
 unit_type text NOT NULL,orientation text NOT NULL,weight integer NOT NULL CHECK(weight>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,code),UNIQUE(organization_id,project_id,building,floor,position),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES inventory_boards(organization_id,project_id)
);
CREATE TABLE inventory_price_plans (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,board_version integer NOT NULL,
 title text NOT NULL,config jsonb NOT NULL,quotes jsonb NOT NULL,snapshot_hash text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected')),
 version integer NOT NULL DEFAULT 1,created_by text NOT NULL,reviewed_by text,review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz,
 UNIQUE(organization_id,project_id,id),FOREIGN KEY(organization_id,project_id) REFERENCES inventory_boards(organization_id,project_id),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE TABLE inventory_sales (
 organization_id uuid NOT NULL,project_id uuid NOT NULL,mode text NOT NULL CHECK(mode IN('disabled','queue-choice','published-random')),
 config jsonb NOT NULL,lottery_id uuid,price_plan_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','active','paused')),
 version integer NOT NULL DEFAULT 1,created_by text NOT NULL,reviewed_by text,activated_at timestamptz,
 PRIMARY KEY(organization_id,project_id),FOREIGN KEY(organization_id,project_id) REFERENCES inventory_boards(organization_id,project_id),
 FOREIGN KEY(organization_id,project_id,price_plan_id) REFERENCES inventory_price_plans(organization_id,project_id,id),
 FOREIGN KEY(organization_id,lottery_id) REFERENCES lottery_workspaces(organization_id,id),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE TABLE identity_private.inventory_queue (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,user_id uuid NOT NULL,dossier_id uuid NOT NULL,application_id uuid NOT NULL,
 public_code text NOT NULL,rank integer NOT NULL CHECK(rank>0),assigned_unit text,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked')),created_by text NOT NULL,
 revocation_reason_cipher text,revoked_by text,revoked_at timestamptz,
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,user_id),UNIQUE(organization_id,project_id,public_code),UNIQUE(organization_id,project_id,rank),UNIQUE(organization_id,application_id),
 UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES inventory_sales(organization_id,project_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,project_id,dossier_id) REFERENCES prep_dossiers(organization_id,project_id,id)
);
CREATE TABLE inventory_allocations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,unit_id uuid NOT NULL,queue_id uuid NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,price_plan_id uuid NOT NULL,quote jsonb NOT NULL,
 allocated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,project_id,unit_id),UNIQUE(organization_id,project_id,queue_id),UNIQUE(organization_id,idempotency_key),
 FOREIGN KEY(organization_id,project_id,unit_id) REFERENCES inventory_units(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,queue_id) REFERENCES identity_private.inventory_queue(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,price_plan_id) REFERENCES inventory_price_plans(organization_id,project_id,id)
);
CREATE FUNCTION identity_private.protect_inventory_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'inventory evidence is immutable'; END IF;
 IF TG_TABLE_NAME='inventory_allocations' THEN RAISE EXCEPTION 'allocation and price snapshot are immutable'; END IF;
 IF TG_TABLE_NAME='inventory_price_plans' THEN
  IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.board_version,NEW.title,NEW.config,NEW.quotes,NEW.snapshot_hash,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.board_version,OLD.title,OLD.config,OLD.quotes,OLD.snapshot_hash,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'price snapshot is immutable'; END IF;
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'price review is final'; END IF;
 END IF;
 IF TG_TABLE_NAME='inventory_sales' THEN
  IF (NEW.organization_id,NEW.project_id) IS DISTINCT FROM (OLD.organization_id,OLD.project_id) THEN RAISE EXCEPTION 'sales scope is immutable'; END IF;
  IF OLD.activated_at IS NOT NULL AND (NEW.mode,NEW.config,NEW.lottery_id,NEW.price_plan_id,NEW.created_by,NEW.reviewed_by,NEW.activated_at) IS DISTINCT FROM (OLD.mode,OLD.config,OLD.lottery_id,OLD.price_plan_id,OLD.created_by,OLD.reviewed_by,OLD.activated_at) THEN RAISE EXCEPTION 'activated sales rules are immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_price_guard BEFORE UPDATE OR DELETE ON inventory_price_plans FOR EACH ROW EXECUTE FUNCTION identity_private.protect_inventory_evidence();
CREATE TRIGGER inventory_sales_guard BEFORE UPDATE OR DELETE ON inventory_sales FOR EACH ROW EXECUTE FUNCTION identity_private.protect_inventory_evidence();
CREATE TRIGGER inventory_allocation_guard BEFORE UPDATE OR DELETE ON inventory_allocations FOR EACH ROW EXECUTE FUNCTION identity_private.protect_inventory_evidence();
CREATE FUNCTION identity_private.protect_inventory_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'queue mapping is immutable'; END IF;
 IF (NEW.id,NEW.organization_id,NEW.project_id,NEW.user_id,NEW.dossier_id,NEW.application_id,NEW.public_code,NEW.rank,NEW.assigned_unit,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.project_id,OLD.user_id,OLD.dossier_id,OLD.application_id,OLD.public_code,OLD.rank,OLD.assigned_unit,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'queue mapping is immutable'; END IF;
 IF OLD.status<>'active' OR NEW.status<>'revoked' OR NEW.version<>OLD.version+1 OR NEW.revocation_reason_cipher IS NULL OR NEW.revoked_by IS NULL OR NEW.revoked_by=OLD.created_by OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'queue revocation needs independent evidence'; END IF;
 IF EXISTS(SELECT 1 FROM inventory_allocations WHERE queue_id=OLD.id) THEN RAISE EXCEPTION 'allocated queue evidence cannot be revoked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER inventory_queue_guard BEFORE UPDATE OR DELETE ON identity_private.inventory_queue FOR EACH ROW EXECUTE FUNCTION identity_private.protect_inventory_queue();
CREATE FUNCTION identity_private.protect_inventory_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF EXISTS(SELECT 1 FROM inventory_price_plans WHERE organization_id=OLD.organization_id AND project_id=OLD.project_id) THEN RAISE EXCEPTION 'priced inventory is immutable'; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF EXISTS(SELECT 1 FROM inventory_price_plans WHERE organization_id=NEW.organization_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'priced inventory is immutable'; END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER inventory_unit_guard BEFORE INSERT OR UPDATE OR DELETE ON inventory_units FOR EACH ROW EXECUTE FUNCTION identity_private.protect_inventory_unit();
ALTER TABLE inventory_boards ENABLE ROW LEVEL SECURITY;ALTER TABLE inventory_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_units ENABLE ROW LEVEL SECURITY;ALTER TABLE inventory_units FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_price_plans ENABLE ROW LEVEL SECURITY;ALTER TABLE inventory_price_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_sales ENABLE ROW LEVEL SECURITY;ALTER TABLE inventory_sales FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_private.inventory_queue ENABLE ROW LEVEL SECURITY;ALTER TABLE identity_private.inventory_queue FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_allocations ENABLE ROW LEVEL SECURITY;ALTER TABLE inventory_allocations FORCE ROW LEVEL SECURITY;
-- No direct citizen/partner table grants. API builds scoped projections.
