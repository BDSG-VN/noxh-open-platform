import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Database, type Sql } from './database';
import { event, uuid } from './admin-service';
import type { Staff } from './workforce';
import { runRustKernel } from './native-kernel';
import {
  CHECKPOINT_VERSION,
  AuditCheckpointError,
  auditDecimal,
  checkpointBytes,
  checkpointHash,
  exactObject,
  genesisCursor,
  parseAuditCursor,
  parseAuditProposal,
  parseAuditTrustedKeys,
  verifyCheckpointSignature,
  type AuditCursor,
  type SignedAuditCheckpoint,
} from './audit-checkpoint-protocol';

const PAGE_SIZE = 500;
const MAX_ONLINE_EVENTS = 100_000;
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const actorRef = (s: Staff) => hash('audit-checkpoint:' + s.organizationId + ':' + s.subject);
const json = (value: unknown) =>
  typeof value === 'string' ? (JSON.parse(value) as unknown) : value;

@Injectable()
export class AuditCheckpointService {
  kernel = runRustKernel;
  constructor(@Inject(Database) readonly db: Database) {}
  private authorize(s: Staff) {
    if (s.role !== 'org_admin' || s.projectIds?.length)
      throw new ForbiddenException(
        'Cần quyền quản trị toàn tổ chức để xuất và kiểm tra checkpoint.',
      );
  }
  private async context(q: Sql, s: Staff) {
    this.authorize(s);
    await q.query("SELECT set_config('app.organization_id',$1,true)", [uuid(s.organizationId)]);
  }
  private keys() {
    try {
      const raw = process.env.AUDIT_CHECKPOINT_TRUSTED_KEYS ?? '';
      if (Buffer.byteLength(raw) > 65_536) throw new Error();
      return parseAuditTrustedKeys(JSON.parse(raw) as unknown);
    } catch {
      throw new ServiceUnavailableException('Chưa cấu hình bộ khóa công khai Ed25519 tin cậy.');
    }
  }
  private signature(value: unknown, s: Staff) {
    const keys = this.keys();
    try {
      return verifyCheckpointSignature(value, keys, s.organizationId);
    } catch (e) {
      if (e instanceof AuditCheckpointError)
        throw new BadRequestException(
          'Checkpoint không có chữ ký, phạm vi hoặc khóa tin cậy hợp lệ: ' + e.code,
        );
      throw new BadRequestException('Không xác minh được chữ ký checkpoint.');
    }
  }
  private async latest(q: Sql, org: string) {
    return (
      await q.query(
        'SELECT * FROM identity_private.audit_checkpoints WHERE organization_id=$1 ORDER BY sequence DESC LIMIT 1',
        [org],
      )
    ).rows[0];
  }
  private async head(q: Sql, org: string) {
    const r = (
      await q.query(
        'SELECT a.sequence::text,a.event_hash FROM identity_private.audit_chain a WHERE a.organization_id=$1 ORDER BY a.sequence DESC LIMIT 1',
        [org],
      )
    ).rows[0];
    return {
      sequence: r ? String(r.sequence) : '0',
      head: r ? String(r.event_hash) : genesisCursor().head,
    };
  }
  private async events(q: Sql, org: string, after: string, until: string) {
    const rows = (
      await q.query(
        'SELECT a.id,a.organization_id,a.actor_ref,a.action,a.resource_ref,a.occurred_at,a.prev_hash,a.event_hash,a.sequence::text FROM identity_private.audit_chain a WHERE a.organization_id=$1 AND a.sequence>$2::bigint AND a.sequence<=$3::bigint ORDER BY a.sequence LIMIT 500',
        [org, after, until],
      )
    ).rows;
    return rows.map((r) => ({
      id: String(r.id),
      organization_id: String(r.organization_id),
      actor_ref: String(r.actor_ref),
      action: String(r.action),
      resource_ref: String(r.resource_ref),
      occurred_at: String(r.occurred_at),
      prev_hash: String(r.prev_hash),
      event_hash: String(r.event_hash),
      sequence: String(r.sequence),
    }));
  }
  /** Every page uses Rust. Sequence digest additionally authenticates legacy sequence metadata. */
  private async scan(
    q: Sql,
    org: string,
    end: { sequence: string; head: string },
    expected?: AuditCursor,
  ) {
    if (expected && BigInt(expected.eventCount) > BigInt(MAX_ONLINE_EVENTS))
      throw new ServiceUnavailableException(
        'Vượt giới hạn kiểm chứng trực tuyến 100.000 sự kiện; cần kiểm chứng ngoại tuyến.',
      );
    let cursor = genesisCursor(),
      checked = 0;
    while (BigInt(cursor.sequence) < BigInt(end.sequence)) {
      const events = await this.events(q, org, cursor.sequence, end.sequence);
      if (!events.length)
        throw new ConflictException('Nhật ký bị thiếu trước checkpoint được yêu cầu.');
      if (checked + events.length > MAX_ONLINE_EVENTS)
        throw new ServiceUnavailableException(
          'Vượt giới hạn kiểm chứng trực tuyến 100.000 sự kiện.',
        );
      const raw = await this.kernel('audit', {
        expectedOrganizationId: org,
        events,
        anchor: cursor,
      });
      const r = (raw ?? {}) as {
        valid?: unknown;
        checked?: unknown;
        cursor?: unknown;
        head?: unknown;
      };
      if (r.valid === false) throw new ConflictException('Nhật ký không khớp chuỗi bằng chứng.');
      let next: AuditCursor;
      try {
        next = parseAuditCursor(r.cursor);
      } catch {
        throw new ServiceUnavailableException('Bộ kiểm chứng Rust trả kết quả không hợp lệ.');
      }
      if (
        r.valid !== true ||
        r.checked !== events.length ||
        r.head !== next.head ||
        next.sequence !== events.at(-1)!.sequence ||
        BigInt(next.eventCount) !== BigInt(cursor.eventCount) + BigInt(events.length)
      )
        throw new ServiceUnavailableException('Bộ kiểm chứng Rust trả kết quả không hợp lệ.');
      cursor = next;
      checked += events.length;
    }
    if (cursor.sequence !== end.sequence || cursor.head !== end.head)
      throw new ConflictException('Nhật ký không đạt đúng đầu cuối checkpoint.');
    if (expected) {
      const raw = await this.kernel('audit', {
        expectedOrganizationId: org,
        events: [],
        anchor: cursor,
        expectedEnd: expected,
      });
      const r = (raw ?? {}) as {
        valid?: unknown;
        completeToExpected?: unknown;
        checked?: unknown;
        cursor?: unknown;
      };
      if (r.valid === false)
        throw new ConflictException('Đầu cuối hoặc dấu vết thứ tự không khớp checkpoint.');
      let verifiedCursor: AuditCursor;
      try {
        verifiedCursor = parseAuditCursor(r.cursor);
      } catch {
        throw new ServiceUnavailableException('Bộ kiểm chứng Rust trả kết quả không hợp lệ.');
      }
      if (
        r.valid !== true ||
        r.completeToExpected !== true ||
        r.checked !== 0 ||
        JSON.stringify(verifiedCursor) !== JSON.stringify(expected)
      )
        throw new ConflictException(
          'Đầu cuối, số sự kiện hoặc dấu vết thứ tự không khớp checkpoint.',
        );
    }
    return cursor;
  }
  async status(s: Staff) {
    this.authorize(s);
    return this.db.tx(async (q) => {
      await this.context(q, s);
      const latest = await this.latest(q, s.organizationId);
      let trustedSignerIds: string[] = [];
      try {
        trustedSignerIds = this.keys()
          .filter((k) => k.organizationId === s.organizationId)
          .map((k) => k.signerId);
      } catch {
        // Read-only status remains available while signing has not been configured.
      }
      return {
        trustedKeysConfigured: trustedSignerIds.length > 0,
        trustedSignerIds,
        databaseHead: await this.head(q, s.organizationId),
        latestStoredCheckpoint: latest ? json(latest.envelope) : null,
        notice:
          'Bản lưu trên cùng máy không chứng minh đây là checkpoint mới nhất. Đối chiếu bản có chữ ký từ kho độc lập; kiểm chứng chỉ tới mốc đã chọn.',
        pageSize: PAGE_SIZE,
        maxOnlineEvents: MAX_ONLINE_EVENTS,
      };
    });
  }
  async propose(s: Staff, body: unknown) {
    this.authorize(s);
    let requestId: string, signerId: string;
    try {
      const b = exactObject(body, ['requestId', 'signerId']);
      requestId = uuid(b.requestId);
      if (typeof b.signerId !== 'string') throw new Error();
      signerId = b.signerId;
      if (
        !this.keys().some((k) => k.organizationId === s.organizationId && k.signerId === signerId)
      )
        throw new Error();
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new BadRequestException('Cần mã yêu cầu và định danh khóa đã được cấu hình tin cậy.');
    }
    return this.db.tx(async (q) => {
      await this.context(q, s);
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'checkpoint:' + s.organizationId,
      ]);
      const existing = (
        await q.query(
          'SELECT * FROM identity_private.audit_checkpoint_proposals WHERE organization_id=$1 AND request_ref=$2',
          [s.organizationId, requestId],
        )
      ).rows[0];
      if (existing) {
        const p = parseAuditProposal(json(existing.proposal));
        if (p.requestedBy !== actorRef(s) || p.signerId !== signerId)
          throw new ConflictException('Mã yêu cầu đã được dùng với nội dung khác.');
        return { proposal: p, duplicate: true, signatureRequired: true };
      }
      const latest = await this.latest(q, s.organizationId),
        end = await this.head(q, s.organizationId);
      const cursor = await this.scan(q, s.organizationId, end);
      const proposal = parseAuditProposal({
        version: CHECKPOINT_VERSION,
        id: randomUUID(),
        organizationId: s.organizationId,
        signerId,
        requestedBy: actorRef(s),
        createdAt: new Date().toISOString(),
        previousCheckpointHash: latest ? String(latest.envelope_hash) : null,
        cursor,
      });
      await q.query(
        'INSERT INTO identity_private.audit_checkpoint_proposals(id,organization_id,request_ref,requested_by,proposal,proposal_hash) VALUES($1,$2,$3,$4,$5,$6)',
        [
          proposal.id,
          s.organizationId,
          requestId,
          actorRef(s),
          JSON.stringify(proposal),
          hash(checkpointBytes(proposal)),
        ],
      );
      await event(q, s, 'audit.checkpoint.proposed', proposal.id);
      return { proposal, duplicate: false, signatureRequired: true };
    });
  }
  async evidence(s: Staff, id: string, afterValue: unknown = '0') {
    this.authorize(s);
    let after: string;
    try {
      after = auditDecimal(afterValue);
    } catch {
      throw new BadRequestException('Con trỏ sự kiện không hợp lệ.');
    }
    return this.db.tx(async (q) => {
      await this.context(q, s);
      const p = (
        await q.query(
          'SELECT proposal FROM identity_private.audit_checkpoint_proposals WHERE organization_id=$1 AND id=$2',
          [s.organizationId, uuid(id)],
        )
      ).rows[0];
      if (!p) throw new NotFoundException('Không có đề nghị checkpoint trong tổ chức.');
      const proposal = parseAuditProposal(json(p.proposal));
      if (BigInt(after) > BigInt(proposal.cursor.sequence))
        throw new BadRequestException('Con trỏ vượt checkpoint.');
      const events = await this.events(q, s.organizationId, after, proposal.cursor.sequence);
      return {
        proposal,
        events,
        nextAfterSequence:
          events.length && events.at(-1)!.sequence !== proposal.cursor.sequence
            ? events.at(-1)!.sequence
            : null,
        segmentOnly: true,
        notice:
          'Trang riêng lẻ không chứng minh nhật ký đầy đủ. Kiểm các trang từ genesis tới đúng checkpoint có chữ ký được tin cậy.',
      };
    });
  }
  async import(s: Staff, body: unknown) {
    this.authorize(s);
    const envelope = this.signature(body, s),
      p = envelope.proposal,
      envelopeHash = checkpointHash(envelope);
    if (p.requestedBy === actorRef(s))
      throw new ForbiddenException('Người tạo đề nghị không được tự nhập checkpoint của mình.');
    return this.db.tx(async (q) => {
      await this.context(q, s);
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'checkpoint:' + s.organizationId,
      ]);
      const proposal = (
        await q.query(
          'SELECT * FROM identity_private.audit_checkpoint_proposals WHERE organization_id=$1 AND id=$2',
          [s.organizationId, p.id],
        )
      ).rows[0];
      if (!proposal) throw new NotFoundException('Không có đề nghị checkpoint trong tổ chức.');
      if (
        String(proposal.proposal_hash) !== hash(checkpointBytes(p)) ||
        String(proposal.requested_by) !== p.requestedBy
      )
        throw new ConflictException('Checkpoint khác đề nghị bất biến.');
      const saved = (
        await q.query(
          'SELECT envelope_hash FROM identity_private.audit_checkpoints WHERE organization_id=$1 AND id=$2',
          [s.organizationId, p.id],
        )
      ).rows[0];
      if (saved) {
        if (saved.envelope_hash !== envelopeHash)
          throw new ConflictException('Checkpoint đã được nhập với chữ ký khác.');
        return { id: p.id, checkpointHash: envelopeHash, duplicate: true, custody: 'not-attested' };
      }
      const latest = await this.latest(q, s.organizationId);
      if (
        (latest ? String(latest.envelope_hash) : null) !== p.previousCheckpointHash ||
        (latest && BigInt(p.cursor.sequence) <= BigInt(String(latest.sequence)))
      )
        throw new ConflictException('Checkpoint cũ, sai nhánh hoặc đã có checkpoint mới hơn.');
      await this.scan(q, s.organizationId, p.cursor, p.cursor);
      await q.query(
        'INSERT INTO identity_private.audit_checkpoints(id,organization_id,sequence,event_count,head,envelope,envelope_hash,previous_hash,proposed_by,imported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          p.id,
          s.organizationId,
          p.cursor.sequence,
          p.cursor.eventCount,
          p.cursor.head,
          JSON.stringify(envelope),
          envelopeHash,
          p.previousCheckpointHash,
          p.requestedBy,
          actorRef(s),
        ],
      );
      await event(q, s, 'audit.checkpoint.imported', p.id);
      return { id: p.id, checkpointHash: envelopeHash, duplicate: false, custody: 'not-attested' };
    });
  }
  async verify(s: Staff, body: unknown) {
    this.authorize(s);
    const envelope: SignedAuditCheckpoint = this.signature(body, s),
      p = envelope.proposal;
    return this.db.tx(async (q) => {
      await this.context(q, s);
      const cursor = await this.scan(q, s.organizationId, p.cursor, p.cursor);
      const current = await this.head(q, s.organizationId);
      return {
        valid: true,
        engine: 'rust',
        completeToCheckpoint: true,
        coversGenesis: true,
        checkpointHash: checkpointHash(envelope),
        verified: cursor,
        databaseHead: current,
        currentHeadMatches: current.sequence === cursor.sequence && current.head === cursor.head,
        custody: 'not-attested',
        notice:
          'Đã kiểm đầy đủ tới checkpoint được cung cấp, không chứng minh checkpoint này là mốc mới nhất bên ngoài hoặc nhật ký không có sự kiện mới hơn.',
      };
    });
  }
}
