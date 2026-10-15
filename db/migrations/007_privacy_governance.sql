CREATE TABLE privacy_notices (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 version integer NOT NULL CHECK(version>0), payload jsonb NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','revoked')),
 created_by text NOT NULL, approved_by text, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,version), UNIQUE(organization_id,id),
 CHECK((status='draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status IN('approved','revoked') AND approved_by IS NOT NULL AND approved_by<>created_by AND approved_at IS NOT NULL))
);
CREATE TRIGGER immutable_privacy_notice BEFORE UPDATE OR DELETE ON privacy_notices FOR EACH ROW EXECUTE FUNCTION identity_private.protect_form_release();
CREATE TABLE identity_private.privacy_choices (
 sequence bigserial UNIQUE, id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, notice_id uuid NOT NULL,
 notice_hash text NOT NULL, action text NOT NULL CHECK(action IN('grant','withdraw')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 FOREIGN KEY(organization_id,notice_id) REFERENCES privacy_notices(organization_id,id)
);
CREATE INDEX privacy_choice_latest ON identity_private.privacy_choices(organization_id,user_id,created_at DESC);
CREATE TRIGGER immutable_privacy_choice BEFORE UPDATE OR DELETE ON identity_private.privacy_choices FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TABLE identity_private.privacy_preferences (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, restricted boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,user_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id)
);
CREATE TABLE privacy_requests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, owner_user_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('access','rectify','erase','restrict','object','complaint')),
 message_cipher text NOT NULL, reply_cipher text, status text NOT NULL DEFAULT 'new' CHECK(status IN('new','processing','responded')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id)
);
ALTER TABLE privacy_notices ENABLE ROW LEVEL SECURITY; ALTER TABLE privacy_notices FORCE ROW LEVEL SECURITY;
GRANT SELECT ON privacy_notices TO noxh_runtime;
CREATE POLICY notice_org ON privacy_notices FOR SELECT TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND status='approved');
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON privacy_requests TO noxh_runtime;
CREATE POLICY privacy_request_owner ON privacy_requests TO noxh_runtime USING(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true) AND owner_user_id::text=current_setting('app.user_id',true));
