import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as contracts from '../packages/contracts/dist/index.js';
const require = createRequire(new URL('../packages/contracts/package.json', import.meta.url));
const { z } = require('zod');
const doc = JSON.parse(await readFile('docs/openapi.json', 'utf8'));
doc.info.version = '0.6.0';
const uuid = { type: 'string', format: 'uuid' };
function schema(name) {
  const s = z.toJSONSchema(contracts[name], { unrepresentable: 'any' });
  delete s.$schema;
  doc.components.schemas[name] = s;
  return { $ref: '#/components/schemas/' + name };
}
for (const n of [
  'KnowledgeDraftSchema',
  'KnowledgeSearchSchema',
  'PreparationChecklistSchema',
  'TenancyDraftSchema',
  'TenancyReviewSchema',
  'TenancyPaymentSchema',
  'TenancyActionSchema',
  'TenancyConfirmationSchema',
  'AiMessageSchema',
  'AiFormProposalSchema',
  'ZaloIdentitySettingsSchema',
  'ZaloExchangeSchema',
  'ZaloLinkStartSchema',
  'NotificationTemplateSchema',
  'NotificationReviewSchema',
  'NotificationQueueSchema',
  'NotificationPreferenceSchema',
  'NotificationTransportSchema',
  'NotificationAcceptedSchema',
  'NotificationProviderSchema',
  'NotificationAutomationPolicySchema',
  'NotificationAutomationReviewSchema',
])
  schema(n);
function path(url, method, id, description, body, version = false) {
  const parameters = [...url.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: m[1] === 'channel' ? { type: 'string', enum: ['email', 'zalo'] } : uuid,
  }));
  if (version)
    parameters.push({
      name: 'If-Match',
      in: 'header',
      required: true,
      schema: { type: 'string', pattern: '^[0-9]+$' },
      description: 'Current version of the target resource; 0 for an absent initial configuration.',
    });
  doc.paths[url] ??= {};
  doc.paths[url][method] = {
    operationId: id,
    description,
    security: [{ [url.includes('/admin/') ? 'WorkforceBearer' : 'CitizenBearer']: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: typeof body === 'string' ? { $ref: '#/components/schemas/' + body } : body,
              },
            },
          },
        }
      : {}),
    responses: {
      [method === 'post' ? '201' : '200']: {
        description: 'Scoped result; development and synthetic gates still apply',
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      400: { description: 'Invalid input' },
      401: { description: 'Authentication required' },
      403: { description: 'Scope, grant, consent or separation of duties denied' },
      404: { description: 'Resource absent in caller scope' },
      409: { description: 'Stale, conflicting, inactive or replayed transition' },
      503: { description: 'Required provider, key, dependency or Rust kernel unavailable' },
    },
  };
}
const review = {
  type: 'object',
  properties: { action: { enum: ['approve', 'revoke'] }, accepted: { const: true } },
  required: ['action', 'accepted'],
  additionalProperties: false,
};
path(
  '/api/v1/admin/knowledge/projects/{project}',
  'get',
  'listProjectKnowledge',
  'Organization/project-scoped revision history. Private drafts are never exposed through citizen search.',
);
path(
  '/api/v1/admin/knowledge/projects/{project}',
  'post',
  'draftProjectKnowledge',
  'Immutable encrypted revision with official source URL/hash and effective applicability. Supplied source hash and legal interpretation require independent human review.',
  'KnowledgeDraftSchema',
);
path(
  '/api/v1/admin/knowledge/projects/{project}/{id}/review',
  'post',
  'reviewProjectKnowledge',
  'Active project legal grant required; author cannot approve or revoke own text. No fallback to older revision after revocation.',
  review,
);
path(
  '/api/v1/dossiers/{id}/knowledge/search',
  'post',
  'searchProjectKnowledge',
  'Owner-only deterministic lexical search in latest effective approved revisions. Missing scope includes general guidance only. No remote embeddings or public web search.',
  'KnowledgeSearchSchema',
);
path(
  '/api/v1/admin/projects/{project}/preparation-checklists',
  'get',
  'listPreparationChecklists',
  'Scoped checklist revision history; checklist measures preparation, not legal eligibility.',
);
path(
  '/api/v1/admin/projects/{project}/preparation-checklists',
  'post',
  'draftPreparationChecklist',
  'Create immutable project preparation checklist; explicit document types and source form IDs.',
  'PreparationChecklistSchema',
);
path(
  '/api/v1/admin/projects/{project}/preparation-checklists/{id}/review',
  'post',
  'reviewPreparationChecklist',
  'Independent project legal reviewer; obsolete or revoked checklist cannot fall back silently.',
  review,
);
const tenancy = '/api/v1/admin/tenancy/projects/{project}';
path(
  tenancy + '/options',
  'get',
  'getTenancyOptions',
  'Scoped synthetic approved application and unit options; never a sales/eligibility decision.',
);
path(
  tenancy + '/contracts',
  'get',
  'listTenancyContracts',
  'Project grants and active workforce membership required.',
);
path(
  tenancy + '/contracts',
  'post',
  'draftTenancyContract',
  'Synthetic draft only for matching approved application/mode/unit. Explicit integer VND installments and idempotency key; no invented legal rates or automatic signing.',
  'TenancyDraftSchema',
);
path(
  tenancy + '/contracts/{id}',
  'get',
  'getTenancyContract',
  'Scoped contract, manual reconciliation, installment and lifecycle history.',
);
path(
  tenancy + '/contracts/{id}/review',
  'post',
  'reviewTenancyContract',
  'Author-independent active legal reviewer approves/rejects the synthetic draft.',
  'TenancyReviewSchema',
  true,
);
path(
  tenancy + '/contracts/{id}/payments',
  'post',
  'recordTenancyPayment',
  'Record synthetic manual evidence; no payment-provider charge or statutory invoice.',
  'TenancyPaymentSchema',
  true,
);
path(
  tenancy + '/payments/{id}/review',
  'post',
  'reconcileTenancyPayment',
  'Independent finance_post grant; pending/reconciled sums cannot overpay one due.',
  'TenancyReviewSchema',
  true,
);
path(
  tenancy + '/contracts/{id}/actions',
  'post',
  'proposeTenancyAction',
  'Propose synthetic handover/extension/termination/return. Unit remains reserved until separately reviewed return.',
  'TenancyActionSchema',
  true,
);
path(
  tenancy + '/actions/{id}/review',
  'post',
  'reviewTenancyAction',
  'Independent records_review grant and owner-confirmed action; rejects stale lifecycle snapshots.',
  'TenancyReviewSchema',
  true,
);
path(
  '/api/v1/citizen/tenancy/contracts',
  'get',
  'listMyTenancyContracts',
  'Only current owner contracts; private preparation never grants access to another customer.',
);
path(
  '/api/v1/citizen/tenancy/contracts/{id}',
  'get',
  'getMyTenancyContract',
  'Owner-only synthetic contract and obligations.',
);
path(
  '/api/v1/citizen/tenancy/contracts/{id}/confirm',
  'post',
  'confirmMyTenancyContract',
  'Separate confirmation of reading a synthetic draft; not a digital or legally binding signature.',
  'TenancyConfirmationSchema',
  true,
);
path(
  '/api/v1/citizen/tenancy/actions/{id}/confirm',
  'post',
  'confirmMyTenancyAction',
  'Owner confirmation before independent lifecycle review.',
  'TenancyConfirmationSchema',
  true,
);
path(
  '/api/v1/admin/audit/checkpoints',
  'get',
  'getAuditCheckpoints',
  'Pinned public key status and locally stored checkpoint metadata; same-host storage is not evidence of independent custody.',
);
path(
  '/api/v1/admin/audit/checkpoints/proposals',
  'post',
  'proposeAuditCheckpoint',
  'Freeze exact organization cursor for offline Ed25519 signer. API never receives a signing private key.',
  {
    type: 'object',
    properties: { signerId: { type: 'string' }, requestId: uuid },
    required: ['signerId', 'requestId'],
    additionalProperties: false,
  },
);
path(
  '/api/v1/admin/audit/checkpoints/proposals/{id}/evidence',
  'get',
  'getAuditCheckpointEvidence',
  'Bounded ordered page. Verify all pages from genesis through the signed cursor; a valid prefix is insufficient.',
);
doc.paths['/api/v1/admin/audit/checkpoints/proposals/{id}/evidence'].get.parameters.push({
  name: 'afterSequence',
  in: 'query',
  required: false,
  schema: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
});
path(
  '/api/v1/admin/audit/checkpoints/imports',
  'post',
  'importAuditCheckpoint',
  'Import exact signed proposal after signature, active pinned organization signer and full Rust prefix verification; importer differs from proposer.',
  {
    type: 'object',
    description:
      'SignedAuditCheckpoint envelope (proposal and canonical Ed25519 base64url signature).',
  },
);
path(
  '/api/v1/admin/audit/checkpoints/verify',
  'post',
  'verifyAuditCheckpoint',
  'Verify full bounded segments to a supplied signed trusted cursor; never asserts this is the latest off-host checkpoint.',
  {
    type: 'object',
    description: 'SignedAuditCheckpoint envelope supplied from trusted external custody.',
  },
);
doc.paths['/health/ready'].get.description =
  'Checks PostgreSQL, Redis, migrations 001–024, executable Rust kernels and, when DATABASE_REQUIRE_LEAST_PRIVILEGE=true, that the API connects as a non-elevated noxh_app member. Does not certify legal approval, provider connectivity or production readiness.';
const assistant = doc.paths['/api/v1/dossiers/{id}/assistant'].post;
assistant.description =
  (assistant.description ?? '').split(' Project-approved lexical retrieval')[0] +
  ' Project-approved lexical retrieval returns revision/hash citations; reference ID validation does not verify semantic claims. Form proposal values are derived locally from saved declaration/current accepted clean extraction; conflicts and external attestations remain blank. Explicit single-use confirmation generates a draft PDF atomically with proposal consumption.';
const notifications = '/api/v1/admin/notifications/projects/{project}';
path(
  notifications + '/automation',
  'get',
  'getNotificationAutomation',
  'Scoped synthetic in-app policies and bounded event history. Automation is explicitly opt-in; no external send.',
);
path(
  notifications + '/automation/policies',
  'post',
  'draftNotificationAutomationPolicy',
  'Idempotent policy draft mapping one supported application event to an independently approved in-app transactional template.',
  'NotificationAutomationPolicySchema',
);
path(
  notifications + '/automation/policies/{id}/review',
  'post',
  'reviewNotificationAutomationPolicy',
  'Author-independent active project legal reviewer approves, rejects or revokes a version-bound policy. Event-time consent pins prevent retrospective delivery.',
  'NotificationAutomationReviewSchema',
  true,
);
path(
  notifications + '/workspace',
  'get',
  'getNotificationWorkspace',
  'Scoped templates, explicit channel configuration, synthetic approved application choices and delivery histories.',
);
path(
  notifications + '/templates',
  'post',
  'draftNotificationTemplate',
  'Immutable encrypted template; author differs from active project reviewer. No external send.',
  'NotificationTemplateSchema',
);
path(
  notifications + '/templates/{id}/review',
  'post',
  'reviewNotificationTemplate',
  'Append-only approval/rejection/revocation evidence; active records_review grant and separation of duties.',
  'NotificationReviewSchema',
  true,
);
path(
  notifications + '/queue',
  'post',
  'queueNotification',
  'Explicit target application, current customer and exact active purpose/channel/privacy consent are bound immutably. Regrant cannot revive a revoked queued message.',
  'NotificationQueueSchema',
);
path(
  notifications + '/messages/{id}/deliver',
  'post',
  'deliverNotification',
  'Explicit operator action with version. In-app delivery is local; external provider must be operator-installed, enabled and idempotent. Unknown outcome is terminal, no automatic retry.',
  'NotificationAcceptedSchema',
  true,
);
path(
  notifications + '/transports',
  'post',
  'configureNotificationTransport',
  'Operator-installed adapter selection only, no arbitrary endpoints/credentials accepted from browser; outside delivery defaults disabled.',
  'NotificationTransportSchema',
  true,
);
path(
  notifications + '/deliveries',
  'get',
  'getNotificationDeliveries',
  'Worker delivery jobs for the project: status, reason codes, attempt budget, requeue count, dead-letter count and channel rate-limit/circuit state. Identifiers only; no addresses, receipts or content.',
);
path(
  notifications + '/deliveries/{id}/requeue',
  'post',
  'requeueNotificationDelivery',
  'Operator-confirmed, version-bound requeue of one dead-lettered job while the message keeps attempt budget (at most 3 attempts and 2 requeues in total). Final outcomes are never reopened.',
  'NotificationAcceptedSchema',
  true,
);
path(
  '/api/v1/admin/notifications/providers',
  'get',
  'getNotificationProviders',
  'Organization administrator view of encrypted provider settings per channel: adapter, rate limit, non-secret summary and version. Credentials are never returned.',
);
path(
  '/api/v1/admin/notifications/providers/{channel}',
  'post',
  'configureNotificationProvider',
  'Organization administrator enters SMTP or Zalo OA settings for a registered adapter; stored encrypted server-side, validated against operator allowlists. A different privacy officer must still enable the channel per project. Default off.',
  'NotificationProviderSchema',
  true,
);
path(
  '/api/v1/citizen/notifications/workspace',
  'get',
  'getMyNotificationWorkspace',
  'Owner-only inbox/preferences. Still accessible for reading/withdrawal after general processing consent is withdrawn.',
);
path(
  '/api/v1/citizen/notifications/projects/{project}/preferences',
  'post',
  'changeMyNotificationPreference',
  'Explicit separate purpose/channel choice. Enabling requires current processing consent; withdrawal never requires re-consent.',
  'NotificationPreferenceSchema',
  true,
);
path(
  '/api/v1/citizen/notifications/messages/{id}/read',
  'post',
  'acknowledgeMyNotification',
  'Owner acknowledgment of reading, not proof of legal service.',
  'NotificationAcceptedSchema',
  true,
);
path(
  '/api/v1/admin/settings/zalo-miniapp',
  'get',
  'getZaloIdentitySettings',
  'Organization administrator only; key presence is returned but secret never is.',
);
path(
  '/api/v1/admin/settings/zalo-miniapp',
  'put',
  'configureZaloIdentity',
  'Organization-specific encrypted ZaloAppID/AppSecret configuration, disabled by default. Changes revoke all Mini App sessions and challenges; live AppID-secret pairing still needs provider-console acceptance.',
  'ZaloIdentitySettingsSchema',
  true,
);
path(
  '/api/v1/auth/zalo/status',
  'get',
  'getZaloIdentityStatus',
  'Configuration/deployment enabled state only, no secret or legal identity claim.',
);
path(
  '/api/v1/auth/zalo/challenges',
  'post',
  'createZaloExchangeChallenge',
  'Rate-limited random single-use login challenge, bound to organization and peer.',
  { type: 'object', additionalProperties: false },
);
path(
  '/api/v1/auth/zalo/exchange',
  'post',
  'exchangeZaloToken',
  'Challenge, provider token and separate consent required. Backend verifies graph.zalo.me/v2.0/me id with server HMAC appsecret_proof; client user ID/phone/name are rejected. Unlinked ID returns needsLink, never merges or creates a human account.',
  'ZaloExchangeSchema',
);
path(
  '/api/v1/auth/link/start',
  'post',
  'startZaloIdentityLink',
  'Requires the same fresh phone-OTP session (<=5min), verified provider token, exact app/config and explicit intent. No automatic matching by phone/name.',
  'ZaloLinkStartSchema',
);
path(
  '/api/v1/auth/link/confirm',
  'post',
  'confirmZaloIdentityLink',
  'Re-verifies provider proof and exact same phone session/challenge/token/config; conflict across accounts is rejected, never merged.',
  'ZaloExchangeSchema',
);
for (const url of [
  '/api/v1/auth/zalo/status',
  '/api/v1/auth/zalo/challenges',
  '/api/v1/auth/zalo/exchange',
])
  for (const operation of Object.values(doc.paths[url])) operation.security = [];
const capabilities =
  doc.paths['/api/v1/capabilities'].get.responses['200'].content['application/json'].schema
    .properties;
capabilities.zaloTokenExchange = {
  type: 'boolean',
  description: 'Deployment flag only; use auth/zalo/status for organization configuration.',
};
capabilities.zaloVerification = { const: 'server-appsecret-proof-organization-configurable' };
capabilities.officialForms = { const: 'reviewed-mappings-deterministic-pdf' };
capabilities.lottery = { const: 'synthetic-reviewed-cohorts' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
doc.components.schemas.AuditCursor = {
  type: 'object',
  properties: {
    sequence: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
    head: digest,
    eventCount: { type: 'string', pattern: '^(0|[1-9][0-9]{0,18})$' },
    sequenceDigest: digest,
  },
  required: ['sequence', 'head', 'eventCount', 'sequenceDigest'],
  additionalProperties: false,
};
doc.components.schemas.AuditCheckpointProposal = {
  type: 'object',
  properties: {
    version: { const: 'noxh-audit-checkpoint-v1' },
    id: uuid,
    organizationId: uuid,
    signerId: { type: 'string' },
    requestedBy: digest,
    createdAt: { type: 'string', format: 'date-time' },
    previousCheckpointHash: { oneOf: [digest, { type: 'null' }] },
    cursor: { $ref: '#/components/schemas/AuditCursor' },
  },
  required: [
    'version',
    'id',
    'organizationId',
    'signerId',
    'requestedBy',
    'createdAt',
    'previousCheckpointHash',
    'cursor',
  ],
  additionalProperties: false,
};
doc.components.schemas.SignedAuditCheckpoint = {
  type: 'object',
  properties: {
    proposal: { $ref: '#/components/schemas/AuditCheckpointProposal' },
    signature: { type: 'string', pattern: '^[A-Za-z0-9_-]{86}$' },
  },
  required: ['proposal', 'signature'],
  additionalProperties: false,
};
for (const method of ['imports', 'verify'])
  doc.paths['/api/v1/admin/audit/checkpoints/' + method].post.requestBody.content[
    'application/json'
  ].schema = { $ref: '#/components/schemas/SignedAuditCheckpoint' };
assistant.requestBody.content['application/json'].schema = {
  $ref: '#/components/schemas/AiMessageSchema',
};
await writeFile('docs/openapi.json', JSON.stringify(doc, null, 2) + '\n');
console.log('Completion API inputs and scoped routes updated. Regenerate typed contracts.');
