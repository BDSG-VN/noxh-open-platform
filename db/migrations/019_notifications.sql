-- Purpose/channel-specific notification consent. Synthetic recipients only in this release.
ALTER TABLE identity_private.privacy_choices ADD CONSTRAINT privacy_choices_notification_owner UNIQUE(organization_id,user_id,id);
CREATE TABLE identity_private.notification_templates (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 name text NOT NULL, channel text NOT NULL CHECK(channel IN('in_app','email','zalo')),
 purpose text NOT NULL CHECK(purpose IN('transactional','marketing')), payload_cipher text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected','revoked')),
 created_by text NOT NULL, reviewed_by text, review_cipher text, version integer NOT NULL DEFAULT 1,
 idempotency_key uuid NOT NULL, request_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key), UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE TABLE identity_private.notification_template_reviews (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,template_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('approve','reject','revoke')),reviewed_by text NOT NULL,note_cipher text NOT NULL,version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_id,version),FOREIGN KEY(organization_id,project_id,template_id) REFERENCES identity_private.notification_templates(organization_id,project_id,id)
);
CREATE TABLE identity_private.notification_preferences (
 organization_id uuid NOT NULL,project_id uuid NOT NULL,user_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN('in_app','email','zalo')),purpose text NOT NULL CHECK(purpose IN('transactional','marketing')),
 enabled boolean NOT NULL,notice_id uuid,notice_hash text,choice_id uuid,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,project_id,user_id,channel,purpose),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,user_id,choice_id) REFERENCES identity_private.privacy_choices(organization_id,user_id,id),
 CHECK(NOT enabled OR (notice_id IS NOT NULL AND notice_hash IS NOT NULL AND choice_id IS NOT NULL))
);
CREATE TABLE identity_private.notification_preference_events (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,user_id uuid NOT NULL,
 channel text NOT NULL,purpose text NOT NULL,enabled boolean NOT NULL,version integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,project_id,user_id,channel,purpose) REFERENCES identity_private.notification_preferences(organization_id,project_id,user_id,channel,purpose)
);
CREATE TABLE identity_private.notification_transports (
 organization_id uuid NOT NULL,project_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN('email','zalo')),
 enabled boolean NOT NULL DEFAULT false,adapter_id text NOT NULL,max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 3),version integer NOT NULL DEFAULT 1,
 PRIMARY KEY(organization_id,project_id,channel),FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE identity_private.notification_messages (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,template_id uuid NOT NULL,
 application_id uuid NOT NULL,owner_user_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN('in_app','email','zalo')),
 purpose text NOT NULL CHECK(purpose IN('transactional','marketing')),payload_cipher text NOT NULL,
 notice_id uuid NOT NULL,notice_hash text NOT NULL,choice_id uuid NOT NULL,preference_version integer NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','delivered','failed','cancelled','outcome_unknown')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),version integer NOT NULL DEFAULT 1,read_at timestamptz,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,template_id) REFERENCES identity_private.notification_templates(organization_id,project_id,id),
 FOREIGN KEY(organization_id,owner_user_id,choice_id) REFERENCES identity_private.privacy_choices(organization_id,user_id,id),
 FOREIGN KEY(organization_id,project_id,application_id,owner_user_id) REFERENCES applications(organization_id,project_id,id,owner_user_id)
);
CREATE TABLE identity_private.notification_attempts (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,message_id uuid NOT NULL,
 number integer NOT NULL CHECK(number BETWEEN 1 AND 3),outcome text NOT NULL CHECK(outcome IN('delivered','failed','outcome_unknown')),
 receipt_cipher text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(message_id,number),
 FOREIGN KEY(organization_id,project_id,message_id) REFERENCES identity_private.notification_messages(organization_id,project_id,id)
);
CREATE INDEX notification_inbox ON identity_private.notification_messages(organization_id,owner_user_id,created_at DESC);
CREATE INDEX notification_queue ON identity_private.notification_messages(organization_id,project_id,status,created_at);
CREATE FUNCTION identity_private.protect_notification_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'notification template evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_cipher','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_cipher','version']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'notification template snapshot immutable'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status IN('approved','rejected')) OR (OLD.status='approved' AND NEW.status='revoked')) OR NEW.reviewed_by IS NULL OR NEW.review_cipher IS NULL THEN RAISE EXCEPTION 'invalid notification review'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_template_guard BEFORE UPDATE OR DELETE ON identity_private.notification_templates FOR EACH ROW EXECUTE FUNCTION identity_private.protect_notification_template();
CREATE FUNCTION identity_private.protect_notification_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'notification message evidence cannot be deleted'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','attempt_count','version','read_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','version','read_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'notification content snapshot immutable'; END IF;
 IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 THEN RAISE EXCEPTION 'invalid notification attempt'; END IF;
 IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN RAISE EXCEPTION 'read acknowledgement immutable'; END IF;
 IF NEW.read_at IS NOT NULL AND (NEW.channel<>'in_app' OR NEW.status<>'delivered') THEN RAISE EXCEPTION 'read acknowledgement requires delivered inbox'; END IF;
 IF OLD.status IN('queued','failed') AND NOT ((NEW.status='cancelled' AND NEW.attempt_count=OLD.attempt_count) OR (NEW.status IN('delivered','failed','outcome_unknown') AND NEW.attempt_count=OLD.attempt_count+1 AND EXISTS(SELECT 1 FROM identity_private.notification_attempts a WHERE a.organization_id=NEW.organization_id AND a.message_id=NEW.id AND a.number=NEW.attempt_count AND a.outcome=NEW.status))) THEN RAISE EXCEPTION 'notification attempt evidence required'; END IF;
 IF OLD.status IN('cancelled','outcome_unknown') OR (OLD.status='delivered' AND (NEW.status<>'delivered' OR NEW.attempt_count<>OLD.attempt_count)) THEN RAISE EXCEPTION 'notification delivery is final'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_message_guard BEFORE UPDATE OR DELETE ON identity_private.notification_messages FOR EACH ROW EXECUTE FUNCTION identity_private.protect_notification_message();
CREATE TRIGGER notification_template_review_immutable BEFORE UPDATE OR DELETE ON identity_private.notification_template_reviews FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER notification_attempt_immutable BEFORE UPDATE OR DELETE ON identity_private.notification_attempts FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TRIGGER notification_preference_event_immutable BEFORE UPDATE OR DELETE ON identity_private.notification_preference_events FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_templates','notification_template_reviews','notification_preferences','notification_preference_events','notification_transports','notification_messages','notification_attempts'] LOOP
 EXECUTE format('ALTER TABLE identity_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE identity_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY notification_org_scope ON identity_private.%I USING(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('REVOKE ALL ON identity_private.%I FROM PUBLIC,noxh_runtime',t);
 END LOOP;
END $$;
