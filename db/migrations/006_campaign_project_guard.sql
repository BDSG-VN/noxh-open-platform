-- A consultation consent belongs to the original agency/project purpose.
-- Reassigning a campaign must never restore leads from a revoked project grant.
CREATE FUNCTION identity_private.protect_campaign_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.partner_id IS DISTINCT FROM OLD.partner_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
  RAISE EXCEPTION 'campaign scope and creation provenance are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_campaign_scope BEFORE UPDATE ON partner_campaigns FOR EACH ROW EXECUTE FUNCTION identity_private.protect_campaign_scope();
