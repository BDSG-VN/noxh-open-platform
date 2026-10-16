-- Zalo Mini App identity is distinct from the OA/ZBS delivery credential.
CREATE TABLE identity_private.zalo_identity_settings(
 organization_id uuid PRIMARY KEY REFERENCES organizations(id),app_id text NOT NULL,
 secret_cipher text NOT NULL,enabled boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE identity_private.citizen_sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'phone-otp' CHECK(auth_method IN('phone-otp','zalo-miniapp')),
 ADD COLUMN channel_app_id text, ADD COLUMN channel_config_version integer;
ALTER TABLE identity_private.citizen_sessions ADD CHECK(
 (auth_method='phone-otp' AND channel_app_id IS NULL AND channel_config_version IS NULL) OR
 (auth_method='zalo-miniapp' AND channel_app_id IS NOT NULL AND channel_config_version>0));
CREATE TABLE identity_private.zalo_identity_links(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,app_id text NOT NULL,
 subject_ref text NOT NULL CHECK(subject_ref~'^[a-f0-9]{64}$'),user_id uuid NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 UNIQUE(organization_id,app_id,subject_ref),UNIQUE(organization_id,app_id,user_id)
);
-- Rebinding to another user is never a side effect of login or matching a phone/name.
CREATE TRIGGER immutable_zalo_identity_link BEFORE UPDATE ON identity_private.zalo_identity_links FOR EACH ROW EXECUTE FUNCTION identity_private.reject_event_change();
CREATE TABLE identity_private.zalo_identity_challenges(
 id uuid PRIMARY KEY,organization_id uuid NOT NULL REFERENCES organizations(id),
 purpose text NOT NULL CHECK(purpose IN('exchange','link')),app_id text NOT NULL,config_version integer NOT NULL,
 proof_hash text NOT NULL CHECK(proof_hash~'^[a-f0-9]{64}$'),
 user_id uuid,session_hash text,token_hash text,subject_ref text,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,user_id) REFERENCES users(organization_id,id),
 CHECK((purpose='exchange' AND user_id IS NULL AND session_hash IS NULL AND token_hash IS NULL AND subject_ref IS NULL) OR
 (purpose='link' AND user_id IS NOT NULL AND session_hash IS NOT NULL AND token_hash IS NOT NULL AND subject_ref IS NOT NULL))
);
CREATE INDEX zalo_challenge_expiry ON identity_private.zalo_identity_challenges(expires_at);
