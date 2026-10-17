-- 024: indexes for list/claim/rate-limit queries that the 2026-10-17 ECC review found running as
-- sequential scans (or as organization-only prefix scans) under the noxh_app role. Indexes only:
-- no grants, no data change, no RLS or trigger change, so 022 privilege derivation is unaffected.
-- Column order follows the predicates in apps/api/src (equality first, then the ORDER BY key).
-- Applications: staff queue per project, citizen history, lottery eligibility by round.
CREATE INDEX applications_submitted ON applications(organization_id,submitted_at DESC);
CREATE INDEX applications_project_submitted ON applications(organization_id,project_id,submitted_at DESC);
CREATE INDEX applications_owner_submitted ON applications(organization_id,owner_user_id,submitted_at DESC);
CREATE INDEX applications_round_status ON applications(organization_id,round_id,status);
CREATE INDEX application_supplements_application ON application_supplements(application_id,created_at,id);
CREATE INDEX application_reviews_application ON application_reviews(application_id,created_at,id);
CREATE INDEX application_appeals_application ON application_appeals(application_id,created_at DESC);
-- Dossier workspace: forms, documents (upload rate limit by owner), extractions, support cases.
CREATE INDEX generated_forms_dossier ON generated_forms(organization_id,dossier_id,owner_user_id,created_at DESC);
CREATE INDEX documents_owner_created ON documents(organization_id,owner_user_id,created_at DESC);
CREATE INDEX document_extractions_dossier ON document_extractions(organization_id,dossier_id,created_at DESC);
CREATE INDEX online_cases_dossier ON online_cases(organization_id,dossier_id,owner_user_id,created_at DESC);
CREATE INDEX prep_dossiers_owner_created ON prep_dossiers(organization_id,owner_user_id,created_at DESC);
CREATE INDEX household_members_open ON household_members(organization_id,household_id) WHERE valid_to IS NULL;
-- Consent and privacy: active consents per user, request lists per citizen and per organization.
CREATE INDEX consent_records_active ON consent_records(organization_id,user_id,purpose) WHERE withdrawn_at IS NULL;
CREATE INDEX privacy_requests_owner_created ON privacy_requests(organization_id,owner_user_id,created_at DESC);
CREATE INDEX privacy_requests_created ON privacy_requests(organization_id,created_at DESC);
CREATE INDEX ai_proposals_open ON identity_private.ai_proposals(organization_id,owner_user_id) WHERE consumed_at IS NULL;
-- Investor operations: journals, record revisions and staff upload rate limit.
CREATE INDEX investor_journals_project_created ON identity_private.investor_journals(organization_id,project_id,created_at DESC);
CREATE INDEX investor_record_revisions_project_created ON identity_private.investor_record_revisions(organization_id,project_id,created_at DESC);
CREATE INDEX investor_files_uploader_created ON identity_private.investor_files(organization_id,created_by,created_at DESC);
-- Tenancy: contract lists per project/owner and payment sums per due/contract.
CREATE INDEX tenancy_contracts_project_created ON identity_private.tenancy_contracts(organization_id,project_id,created_at DESC,id);
CREATE INDEX tenancy_contracts_owner_created ON identity_private.tenancy_contracts(organization_id,owner_user_id,created_at DESC,id);
CREATE INDEX tenancy_payments_due ON identity_private.tenancy_payments(due_id,status);
CREATE INDEX tenancy_payments_contract ON identity_private.tenancy_payments(organization_id,contract_id,created_at,id);
-- Notifications: per-project event history/counters and per-application message lookup.
CREATE INDEX notification_automation_events_project_created ON identity_private.notification_automation_events(organization_id,project_id,created_at DESC,id);
CREATE INDEX notification_messages_application ON identity_private.notification_messages(organization_id,application_id);
-- Lottery and partners: cohorts by round, frozen workspaces, lead counts per campaign.
CREATE INDEX lottery_cohorts_round ON lottery_cohorts(organization_id,round_id,mode,kind);
CREATE INDEX lottery_workspaces_created ON lottery_workspaces(organization_id,created_at DESC);
CREATE INDEX partner_leads_campaign_status ON identity_private.partner_leads(organization_id,campaign_id,status);
