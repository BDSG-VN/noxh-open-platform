CREATE TABLE partners (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), name text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended')), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE partner_projects (
 organization_id uuid NOT NULL,partner_id uuid NOT NULL,project_id uuid NOT NULL,active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(organization_id,partner_id,project_id),
 FOREIGN KEY(organization_id,partner_id) REFERENCES partners(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
CREATE TABLE identity_private.partner_members (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL,partner_id uuid NOT NULL,name text NOT NULL,
 phone_ref text NOT NULL,phone_cipher text NOT NULL,role text NOT NULL CHECK(role IN('partner_admin','campaign_manager','consultant')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','suspended')),version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,partner_id) REFERENCES partners(organization_id,id),
 UNIQUE(organization_id,phone_ref),UNIQUE(organization_id,partner_id,id)
);
CREATE TABLE partner_campaigns (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,partner_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL,channel text NOT NULL CHECK(channel IN('facebook','zalo','web','other')),headline text NOT NULL,description text NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','pending','approved','rejected','paused')),
 review_note text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL,
 reviewed_by text,reviewed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,partner_id,project_id) REFERENCES partner_projects(organization_id,partner_id,project_id),
 FOREIGN KEY(organization_id,partner_id,created_by) REFERENCES identity_private.partner_members(organization_id,partner_id,id),
 UNIQUE(organization_id,partner_id,id)
);
CREATE TABLE identity_private.partner_leads (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,partner_id uuid NOT NULL,campaign_id uuid NOT NULL,owner_user_id uuid NOT NULL,
 details_cipher text,assignee_id uuid,status text NOT NULL DEFAULT 'new' CHECK(status IN('new','contacting','waiting','closed','withdrawn')),
 version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,partner_id,campaign_id) REFERENCES partner_campaigns(organization_id,partner_id,id),
 FOREIGN KEY(organization_id,partner_id,assignee_id) REFERENCES identity_private.partner_members(organization_id,partner_id,id),
 FOREIGN KEY(organization_id,owner_user_id) REFERENCES users(organization_id,id),
 CHECK((status='withdrawn' AND details_cipher IS NULL) OR (status<>'withdrawn' AND details_cipher IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_partner_consultation ON identity_private.partner_leads(organization_id,campaign_id,owner_user_id) WHERE status IN('new','contacting','waiting');
CREATE INDEX partner_lead_assignment ON identity_private.partner_leads(organization_id,partner_id,assignee_id,status);
ALTER TABLE partners ENABLE ROW LEVEL SECURITY; ALTER TABLE partners FORCE ROW LEVEL SECURITY;
ALTER TABLE partner_projects ENABLE ROW LEVEL SECURITY; ALTER TABLE partner_projects FORCE ROW LEVEL SECURITY;
ALTER TABLE partner_campaigns ENABLE ROW LEVEL SECURITY; ALTER TABLE partner_campaigns FORCE ROW LEVEL SECURITY;
-- Partner and PII tables are not granted to the citizen database role. API authorization is explicit on every route.
