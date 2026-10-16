import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

export const CHECKPOINT_VERSION = 'noxh-audit-checkpoint-v1';
export const AUDIT_GENESIS = '0'.repeat(64);
export const MAX_AUDIT_SEQUENCE = 9_223_372_036_854_775_807n;
export interface AuditCursor {
  sequence: string;
  head: string;
  eventCount: string;
  sequenceDigest: string;
}
export interface AuditCheckpointProposal {
  version: typeof CHECKPOINT_VERSION;
  id: string;
  organizationId: string;
  signerId: string;
  requestedBy: string;
  createdAt: string;
  previousCheckpointHash: string | null;
  cursor: AuditCursor;
}
export interface SignedAuditCheckpoint {
  proposal: AuditCheckpointProposal;
  signature: string;
}
export interface AuditTrustedKey {
  organizationId: string;
  signerId: string;
  publicKeyPem: string;
  notBefore: string;
  notAfter: string;
}
export const genesisCursor = (): AuditCursor => ({
  sequence: '0',
  head: AUDIT_GENESIS,
  eventCount: '0',
  sequenceDigest: AUDIT_GENESIS,
});
export class AuditCheckpointError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
const invalid = (code = 'INVALID_CHECKPOINT'): never => {
  throw new AuditCheckpointError(code);
};
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length || keys.some((k) => !Object.hasOwn(obj, k)))
    return invalid();
  return obj;
}
export function auditDecimal(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(0|[1-9][0-9]{0,18})$/.test(value) ||
    BigInt(value) > MAX_AUDIT_SEQUENCE
  )
    return invalid();
  return value;
}
function timestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return invalid();
  return value;
}
export function parseAuditCursor(value: unknown): AuditCursor {
  const r = exactObject(value, ['sequence', 'head', 'eventCount', 'sequenceDigest']);
  const sequence = auditDecimal(r.sequence),
    eventCount = auditDecimal(r.eventCount);
  if (!digest(r.head) || !digest(r.sequenceDigest) || BigInt(eventCount) > BigInt(sequence))
    return invalid();
  if (
    eventCount === '0' &&
    (sequence !== '0' || r.head !== AUDIT_GENESIS || r.sequenceDigest !== AUDIT_GENESIS)
  )
    return invalid();
  return { sequence, head: r.head, eventCount, sequenceDigest: r.sequenceDigest };
}
export function parseAuditProposal(value: unknown): AuditCheckpointProposal {
  const r = exactObject(value, [
    'version',
    'id',
    'organizationId',
    'signerId',
    'requestedBy',
    'createdAt',
    'previousCheckpointHash',
    'cursor',
  ]);
  if (
    r.version !== CHECKPOINT_VERSION ||
    !uuid(r.id) ||
    !uuid(r.organizationId) ||
    typeof r.signerId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/.test(r.signerId) ||
    !digest(r.requestedBy) ||
    (r.previousCheckpointHash !== null && !digest(r.previousCheckpointHash))
  )
    return invalid();
  return {
    version: CHECKPOINT_VERSION,
    id: r.id,
    organizationId: r.organizationId,
    signerId: r.signerId,
    requestedBy: r.requestedBy,
    createdAt: timestamp(r.createdAt),
    previousCheckpointHash: r.previousCheckpointHash as string | null,
    cursor: parseAuditCursor(r.cursor),
  };
}
export function parseSignedCheckpoint(value: unknown): SignedAuditCheckpoint {
  const r = exactObject(value, ['proposal', 'signature']);
  if (
    typeof r.signature !== 'string' ||
    !/^[A-Za-z0-9_-]{86}$/.test(r.signature) ||
    Buffer.from(r.signature, 'base64url').toString('base64url') !== r.signature
  )
    return invalid();
  return { proposal: parseAuditProposal(r.proposal), signature: r.signature };
}
export function checkpointBytes(value: unknown): Buffer {
  const p = parseAuditProposal(value),
    c = p.cursor;
  return Buffer.from(
    JSON.stringify([
      CHECKPOINT_VERSION,
      p.id,
      p.organizationId,
      p.signerId,
      p.requestedBy,
      p.createdAt,
      p.previousCheckpointHash,
      c.sequence,
      c.head,
      c.eventCount,
      c.sequenceDigest,
    ]),
  );
}
export function checkpointHash(value: unknown): string {
  const s = parseSignedCheckpoint(value);
  return createHash('sha256')
    .update(checkpointBytes(s.proposal))
    .update('\0')
    .update(s.signature)
    .digest('hex');
}
export function signAuditCheckpoint(value: unknown, privateKey: KeyObject): SignedAuditCheckpoint {
  const proposal = parseAuditProposal(value);
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519')
    return invalid('INVALID_SIGNING_KEY');
  return {
    proposal,
    signature: sign(null, checkpointBytes(proposal), privateKey).toString('base64url'),
  };
}
export function parseAuditTrustedKeys(value: unknown): AuditTrustedKey[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    return invalid('TRUST_NOT_CONFIGURED');
  const seen = new Set<string>();
  return value.map((item) => {
    const r = exactObject(item, [
      'organizationId',
      'signerId',
      'publicKeyPem',
      'notBefore',
      'notAfter',
    ]);
    if (
      !uuid(r.organizationId) ||
      typeof r.signerId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/.test(r.signerId) ||
      typeof r.publicKeyPem !== 'string' ||
      r.publicKeyPem.length > 4096 ||
      !r.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----') ||
      r.publicKeyPem.includes('PRIVATE KEY')
    )
      return invalid('INVALID_TRUST_KEY');
    const id = r.organizationId + ':' + r.signerId;
    if (seen.has(id)) return invalid('DUPLICATE_TRUST_KEY');
    seen.add(id);
    const notBefore = timestamp(r.notBefore),
      notAfter = timestamp(r.notAfter);
    if (notAfter <= notBefore) return invalid('INVALID_TRUST_WINDOW');
    let key: KeyObject;
    try {
      key = createPublicKey(r.publicKeyPem);
    } catch {
      return invalid('INVALID_TRUST_KEY');
    }
    if (key.asymmetricKeyType !== 'ed25519') return invalid('INVALID_TRUST_KEY');
    return {
      organizationId: r.organizationId,
      signerId: r.signerId,
      publicKeyPem: r.publicKeyPem,
      notBefore,
      notAfter,
    };
  });
}
export function verifyCheckpointSignature(
  value: unknown,
  trustedKeys: AuditTrustedKey[],
  organizationId: string,
): SignedAuditCheckpoint {
  const envelope = parseSignedCheckpoint(value),
    p = envelope.proposal;
  if (p.organizationId !== organizationId) return invalid('WRONG_ORGANIZATION');
  const key = trustedKeys.find(
    (k) => k.organizationId === organizationId && k.signerId === p.signerId,
  );
  if (!key) return invalid('UNTRUSTED_SIGNER');
  if (p.createdAt < key.notBefore || p.createdAt >= key.notAfter)
    return invalid('SIGNER_OUTSIDE_WINDOW');
  if (Date.parse(p.createdAt) > Date.now() + 5000) return invalid('FUTURE_CHECKPOINT');
  if (
    !verify(
      null,
      checkpointBytes(p),
      createPublicKey(key.publicKeyPem),
      Buffer.from(envelope.signature, 'base64url'),
    )
  )
    return invalid('INVALID_SIGNATURE');
  return envelope;
}
