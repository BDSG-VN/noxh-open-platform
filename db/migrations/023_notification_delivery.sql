-- 023: worker-driven external notification delivery (email SMTP / Zalo OA). Default off; synthetic
-- projects, drill sinks and OTP-verified phones only. Provider settings are encrypted per organization
-- and channel; delivery jobs carry bounded retry, lease fencing, dead-letter and requeue state; the
-- channel state row holds the token bucket and circuit breaker. No message content or address is
-- stored outside existing encrypted payloads.
CREATE TABLE identity_private.notification_provider_settings(
 organization_id uuid NOT NULL REFERENCES organizations(id),channel text NOT NULL CHECK(channel IN('email','zalo')),
 adapter_id text NOT NULL CHECK(adapter_id~'^[a-z][a-z0-9-]{2,60}$'),config_cipher text NOT NULL,
 rate_per_minute integer NOT NULL CHECK(rate_per_minute BETWEEN 1 AND 600),configured_by text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,channel)
);
CREATE TABLE identity_private.notification_channel_state(
 organization_id uuid NOT NULL REFERENCES organizations(id),channel text NOT NULL CHECK(channel IN('email','zalo')),
 tokens double precision NOT NULL CHECK(tokens>=0),refilled_at timestamptz NOT NULL DEFAULT now(),
 failure_streak integer NOT NULL DEFAULT 0 CHECK(failure_streak>=0),open_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,channel)
);
CREATE TABLE identity_private.notification_deliveries(
 message_id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN('email','zalo')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','processing','delivered','dead_letter','outcome_unknown','cancelled')),
 reason text CHECK(reason IN('provider_rejected','provider_unavailable','rate_limited','circuit_open','timeout','attempts_exhausted','consent_unavailable','transport_disabled','recipient_unavailable','processing_failed','requeued')),
 attempt_budget integer NOT NULL CHECK(attempt_budget BETWEEN 1 AND 3),requeue_count integer NOT NULL DEFAULT 0 CHECK(requeue_count BETWEEN 0 AND 2),
 worker_failures integer NOT NULL DEFAULT 0 CHECK(worker_failures BETWEEN 0 AND 5),
 lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 requested_by text NOT NULL,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,message_id) REFERENCES identity_private.notification_messages(organization_id,project_id,id),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE INDEX notification_delivery_due ON identity_private.notification_deliveries(organization_id,status,next_attempt_at);
CREATE FUNCTION identity_private.protect_notification_delivery() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, identity_private, pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'notification delivery evidence cannot be deleted'; END IF;
 IF NEW.message_id<>OLD.message_id OR NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id OR NEW.channel<>OLD.channel OR NEW.requested_by<>OLD.requested_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'notification delivery identity immutable'; END IF;
 IF OLD.status IN('delivered','outcome_unknown','cancelled') THEN RAISE EXCEPTION 'notification delivery is final'; END IF;
 IF NEW.requeue_count<OLD.requeue_count OR NEW.requeue_count>OLD.requeue_count+1 THEN RAISE EXCEPTION 'invalid notification requeue'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_delivery_guard BEFORE UPDATE OR DELETE ON identity_private.notification_deliveries FOR EACH ROW EXECUTE FUNCTION identity_private.protect_notification_delivery();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_provider_settings','notification_channel_state','notification_deliveries'] LOOP
 EXECUTE format('ALTER TABLE identity_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE identity_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY notification_org_scope ON identity_private.%I USING(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('REVOKE ALL ON identity_private.%I FROM PUBLIC,noxh_runtime',t);
 END LOOP;
END $$;
-- Least-privilege runtime grants (ADR 018): derived from the API SQL inventory with
-- scripts/runtime-privileges.mjs and reviewed; runtime-privileges.test.ts recomputes them.
GRANT INSERT, SELECT ON "identity_private"."notification_provider_settings" TO noxh_app;
GRANT UPDATE ("adapter_id", "config_cipher", "configured_by", "rate_per_minute", "updated_at", "version") ON "identity_private"."notification_provider_settings" TO noxh_app;
GRANT INSERT, SELECT ON "identity_private"."notification_channel_state" TO noxh_app;
GRANT UPDATE ("failure_streak", "open_until", "refilled_at", "tokens", "updated_at") ON "identity_private"."notification_channel_state" TO noxh_app;
GRANT INSERT, SELECT ON "identity_private"."notification_deliveries" TO noxh_app;
GRANT UPDATE ("attempt_budget", "lease_token", "lease_until", "next_attempt_at", "reason", "requeue_count", "status", "updated_at", "version", "worker_failures") ON "identity_private"."notification_deliveries" TO noxh_app;
ALTER TABLE "identity_private"."notification_provider_settings" ENABLE ROW LEVEL SECURITY; ALTER TABLE "identity_private"."notification_provider_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY noxh_app_scope ON "identity_private"."notification_provider_settings" TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
CREATE POLICY noxh_app_guard ON "identity_private"."notification_provider_settings" AS RESTRICTIVE TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
ALTER TABLE "identity_private"."notification_channel_state" ENABLE ROW LEVEL SECURITY; ALTER TABLE "identity_private"."notification_channel_state" FORCE ROW LEVEL SECURITY;
CREATE POLICY noxh_app_scope ON "identity_private"."notification_channel_state" TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
CREATE POLICY noxh_app_guard ON "identity_private"."notification_channel_state" AS RESTRICTIVE TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
ALTER TABLE "identity_private"."notification_deliveries" ENABLE ROW LEVEL SECURITY; ALTER TABLE "identity_private"."notification_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY noxh_app_scope ON "identity_private"."notification_deliveries" TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
CREATE POLICY noxh_app_guard ON "identity_private"."notification_deliveries" AS RESTRICTIVE TO noxh_app USING (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid)) WITH CHECK (organization_id IN (SELECT i.organization_id FROM identity_private.instance_organizations i WHERE i.runtime_role = CURRENT_USER) AND (NULLIF(pg_catalog.current_setting('app.organization_id', true), '') IS NULL OR organization_id = NULLIF(pg_catalog.current_setting('app.organization_id', true), '')::pg_catalog.uuid));
