-- Synthetic in-app application notices only. No external transport or implicit consent.
CREATE TABLE identity_private.notification_automation_policies(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN('application.supplement-requested','application.approved','application.rejected')),
 template_id uuid NOT NULL,template_version integer NOT NULL CHECK(template_version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected','revoked')),
 created_by text NOT NULL,reviewed_by text,reviewed_employee_id uuid,reviewed_employee_version integer,review_cipher text,version integer NOT NULL DEFAULT 1,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,idempotency_key),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,template_id) REFERENCES identity_private.notification_templates(organization_id,project_id,id),
 FOREIGN KEY(organization_id,reviewed_employee_id) REFERENCES identity_private.investor_employees(organization_id,id),
 CHECK(status='draft' OR (reviewed_by IS NOT NULL AND reviewed_employee_id IS NOT NULL AND reviewed_employee_version>0)),
 CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE UNIQUE INDEX notification_automation_active_policy ON identity_private.notification_automation_policies(organization_id,project_id,event_type) WHERE status='approved';
CREATE TABLE identity_private.notification_automation_reviews(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,policy_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('approve','reject','revoke')),reviewed_by text NOT NULL,note_cipher text NOT NULL,version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(policy_id,version),
 FOREIGN KEY(organization_id,project_id,policy_id) REFERENCES identity_private.notification_automation_policies(organization_id,project_id,id)
);
CREATE TABLE identity_private.notification_automation_events(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL,application_id uuid NOT NULL,owner_user_id uuid NOT NULL,
 event_type text NOT NULL CHECK(event_type IN('application.supplement-requested','application.approved','application.rejected')),
 application_version integer NOT NULL CHECK(application_version>0),application_code text NOT NULL,source_ref uuid NOT NULL,
 policy_id uuid,policy_version integer,template_id uuid,template_version integer,
 notice_id uuid,notice_hash text,choice_id uuid,preference_version integer,
 status text NOT NULL CHECK(status IN('pending','processing','delivered','skipped','failed')),
 reason text CHECK(reason IN('no_policy','consent_unavailable','preference_unavailable','rule_unavailable','template_unavailable','application_stale','recipient_unavailable','processing_restricted','attempts_exhausted','idempotency_conflict','processing_failed')),
 attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),version integer NOT NULL DEFAULT 1,
 lease_token uuid,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),message_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,
 UNIQUE(organization_id,application_id,event_type,application_version),UNIQUE(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,application_id,owner_user_id) REFERENCES applications(organization_id,project_id,id,owner_user_id),
 FOREIGN KEY(organization_id,project_id,policy_id) REFERENCES identity_private.notification_automation_policies(organization_id,project_id,id),
 FOREIGN KEY(organization_id,project_id,template_id) REFERENCES identity_private.notification_templates(organization_id,project_id,id),
 FOREIGN KEY(organization_id,owner_user_id,choice_id) REFERENCES identity_private.privacy_choices(organization_id,user_id,id),
 FOREIGN KEY(organization_id,project_id,message_id) REFERENCES identity_private.notification_messages(organization_id,project_id,id),
 CHECK(status NOT IN('pending','processing','delivered') OR (policy_id IS NOT NULL AND policy_version IS NOT NULL AND template_id IS NOT NULL AND template_version IS NOT NULL AND notice_id IS NOT NULL AND notice_hash IS NOT NULL AND choice_id IS NOT NULL AND preference_version IS NOT NULL)),
 CHECK((status='processing')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status='delivered')=(message_id IS NOT NULL)),
 CHECK((status IN('delivered','skipped','failed'))=(processed_at IS NOT NULL))
);
CREATE INDEX notification_automation_due ON identity_private.notification_automation_events(organization_id,status,next_attempt_at,created_at);
CREATE FUNCTION identity_private.protect_notification_automation_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'automation policy evidence immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','reviewed_by','reviewed_employee_id','reviewed_employee_version','review_cipher','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','reviewed_employee_id','reviewed_employee_version','review_cipher','version']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'automation policy snapshot immutable'; END IF;
 IF NOT ((OLD.status='draft' AND NEW.status IN('approved','rejected')) OR (OLD.status='approved' AND NEW.status='revoked')) OR NEW.reviewed_by IS NULL OR NEW.review_cipher IS NULL THEN RAISE EXCEPTION 'invalid automation policy review'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_automation_policy_guard BEFORE UPDATE OR DELETE ON identity_private.notification_automation_policies FOR EACH ROW EXECUTE FUNCTION identity_private.protect_notification_automation_policy();
CREATE FUNCTION identity_private.protect_notification_automation_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'automation event evidence immutable'; END IF;
 IF OLD.status IN('delivered','skipped','failed') THEN RAISE EXCEPTION 'automation event terminal'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','reason','attempt_count','version','lease_token','lease_until','next_attempt_at','message_id','processed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reason','attempt_count','version','lease_token','lease_until','next_attempt_at','message_id','processed_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'automation event snapshot immutable'; END IF;
 IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 THEN RAISE EXCEPTION 'invalid automation attempt'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notification_automation_event_guard BEFORE UPDATE OR DELETE ON identity_private.notification_automation_events FOR EACH ROW EXECUTE FUNCTION identity_private.protect_notification_automation_event();
CREATE TRIGGER notification_automation_review_immutable BEFORE UPDATE OR DELETE ON identity_private.notification_automation_reviews FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['notification_automation_policies','notification_automation_reviews','notification_automation_events'] LOOP
 EXECUTE format('ALTER TABLE identity_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE identity_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY automation_org_scope ON identity_private.%I USING(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid) WITH CHECK(organization_id=nullif(current_setting(''app.organization_id'',true),'''')::uuid)',t);
 EXECUTE format('REVOKE ALL ON identity_private.%I FROM PUBLIC,noxh_runtime',t);
 END LOOP;
END $$;
