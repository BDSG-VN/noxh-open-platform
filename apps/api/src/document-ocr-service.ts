/**
 * Self-hosted OCR queue (migration 024, ADR 020). The citizen requests OCR for one clean-scanned
 * private document with purpose-specific consent; the worker claims jobs under a fenced lease,
 * sends the decrypted bytes to the local ai-worker only, stores the recognised text encrypted and
 * records it as a `local-ocr:*` extraction proposal that still needs field-by-field acceptance.
 * Never auto-applies to the declaration. Logs and views carry identifiers and reason codes only.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ExtractionSchema,
  OcrAcceptedSchema,
  OcrConsentSchema,
  OcrResultSchema,
  type OcrJobDetail,
  type OcrJobReason,
  type OcrJobStatus,
  type OcrJobView,
  type OcrQueueHealth,
  type OcrResult,
  type OcrWorkspace,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { AssistanceService } from './assistance-service';
import { DocumentStorage, decryptObject, hashBytes } from './document-storage';
import { PrivacyService } from './privacy-service';
import { event, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Citizen } from './phone-service';
import type { Staff } from './workforce';

export interface OcrClaim {
  jobId: string;
  organizationId: string;
  leaseToken: string;
}
export type OcrOutcome = 'succeeded' | 'retry' | 'failed' | 'cancelled' | 'lost';
export interface OcrMetrics {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  cancelled: number;
  lowQuality: number;
  workerFailures: number;
}
export const emptyOcrMetrics = (): OcrMetrics => ({
  claimed: 0,
  succeeded: 0,
  retried: 0,
  failed: 0,
  cancelled: 0,
  lowQuality: 0,
  workerFailures: 0,
});
/** Worker reply classification; only the class and an HTTP status reach logs or the job row. */
export class OcrWorkerError extends Error {
  constructor(
    readonly kind: 'retryable' | 'rejected' | 'invalid' | 'timeout',
    readonly code: string,
  ) {
    super(code);
    this.name = 'OcrWorkerError';
  }
}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const LEASE = "interval '60 seconds'";
const MAX_REPLY_BYTES = 2 * 1024 * 1024;
const MAX_FIELDS = 80;
const notice =
  'OCR nội bộ chạy trên máy chủ của tổ chức, không gửi giấy tờ ra ngoài. Kết quả chỉ là gợi ý để bạn đối chiếu và xác nhận từng trường; chưa đánh giá chất lượng trên giấy tờ thật và chưa có bộ dữ liệu tiếng Việt được nghiệm thu.';

@Injectable()
export class DocumentOcrService {
  readonly metrics = emptyOcrMetrics();
  /** Hard deadline per worker call (ADR 020: 8–30 s); the request is aborted when it elapses. */
  ocrDeadlineMs = 30000;
  /** Structured, identifier-only log sink; tests capture it. */
  log: (entry: Record<string, string | number | boolean | null>) => void = (entry) =>
    console.log(JSON.stringify({ at: new Date().toISOString(), ...entry }));
  /** Exponential backoff with jitter: 15s, 30s (+0–50%). Tests shorten it. */
  backoffMs = (attempt: number) => {
    const base = 15000 * 2 ** Math.max(0, attempt - 1);
    return Math.round(base * (1 + Math.random() * 0.5));
  };
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(AssistanceService) readonly assistance: AssistanceService,
    @Inject(DocumentStorage) readonly storage: DocumentStorage,
    @Inject(PrivacyService) readonly privacy: PrivacyService,
  ) {}
  enabled() {
    const flag = process.env.LOCAL_OCR_ENABLED;
    if (flag === undefined || flag === 'false') return false;
    if (flag !== 'true')
      throw new ServiceUnavailableException('Cờ OCR nội bộ phải là true hoặc false');
    return true;
  }
  /** Deployment-configured local worker only: http(s), no credentials, never from requests. */
  workerUrl() {
    const raw = process.env.OCR_WORKER_URL ?? '';
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new ServiceUnavailableException('OCR_WORKER_URL chưa hợp lệ');
    }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      throw new ServiceUnavailableException('OCR_WORKER_URL chưa hợp lệ');
    return new URL('ocr', u.href.endsWith('/') ? u.href : u.href + '/').href;
  }
  workerConfigured() {
    try {
      this.workerUrl();
      return true;
    } catch {
      return false;
    }
  }
  qualityThreshold() {
    const raw = process.env.OCR_QUALITY_THRESHOLD;
    if (raw === undefined || raw === '') return 0.6;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > 1)
      throw new ServiceUnavailableException('OCR_QUALITY_THRESHOLD phải trong [0,1]');
    return v;
  }
  private resultContext(r: Row) {
    return 'ocr-result:' + r.organization_id + ':' + r.owner_user_id + ':' + r.id;
  }
  private view(r: Row): OcrJobView {
    return {
      id: String(r.id),
      documentId: String(r.document_id),
      status: r.status as OcrJobStatus,
      reason: (r.reason as OcrJobReason | null) ?? null,
      attemptCount: Number(r.attempt_count),
      attemptBudget: Number(r.attempt_budget),
      requeueCount: Number(r.requeue_count),
      nextAttemptAt: r.status === 'pending' ? iso(r.next_attempt_at) : null,
      qualityScore: r.quality_score === null ? null : Number(r.quality_score),
      lowQuality: r.low_quality === null ? null : Boolean(r.low_quality),
      engine: r.engine === null ? null : String(r.engine),
      extractionId: r.extraction_id === null ? null : String(r.extraction_id),
      version: Number(r.version),
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }
  private async own(q: Sql, c: Citizen, dossier: string, id: string, lock = false) {
    await this.assistance.owner(q, c, dossier);
    const r = (
      await q.query(
        `SELECT * FROM identity_private.document_ocr_jobs WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 ${lock ? 'FOR UPDATE' : ''}`,
        [uuid(id), c.organizationId, uuid(dossier), c.userId],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Không có tác vụ OCR trong hồ sơ');
    return r;
  }
  async workspace(c: Citizen, dossier: string): Promise<OcrWorkspace> {
    const rows = await this.db.tx(async (q) => {
      await this.assistance.owner(q, c, dossier);
      return (
        await q.query(
          'SELECT * FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND dossier_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC LIMIT 100',
          [c.organizationId, uuid(dossier), c.userId],
        )
      ).rows;
    });
    return {
      enabled: this.enabled(),
      items: rows.map((r) => this.view(r)),
      qualityThreshold: this.qualityThreshold(),
      notice,
    };
  }
  async detail(c: Citizen, dossier: string, id: string): Promise<OcrJobDetail> {
    const r = await this.db.tx((q) => this.own(q, c, dossier, id));
    return {
      ...this.view(r),
      qualityThreshold: this.qualityThreshold(),
      result: r.result_cipher
        ? OcrResultSchema.parse(JSON.parse(unseal(String(r.result_cipher), this.resultContext(r))))
        : null,
    };
  }
  /** Citizen requests OCR for one clean-scanned document with explicit purpose-specific consent. */
  async request(c: Citizen, dossier: string, document: string, body: unknown): Promise<OcrJobView> {
    if (!OcrConsentSchema.safeParse(body).success)
      throw new BadRequestException(
        'Cần đồng ý riêng cho việc đọc chữ giấy tờ này bằng OCR nội bộ',
      );
    if (!this.enabled()) throw new ServiceUnavailableException('OCR nội bộ chưa được bật');
    await this.privacy.assertProcessing(c);
    const id = randomUUID(),
      consentId = randomUUID();
    const saved = await this.db.tx(async (q) => {
      await this.privacy.assertProcessing(c, q);
      await this.assistance.owner(q, c, dossier);
      const d = (
        await q.query(
          'SELECT * FROM documents WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND deleted_at IS NULL FOR UPDATE',
          [uuid(document), c.organizationId, uuid(dossier), c.userId],
        )
      ).rows[0];
      if (!d) throw new NotFoundException('Không có giấy tờ trong hồ sơ');
      if (d.scan_status !== 'clean')
        throw new ForbiddenException('Chỉ đọc chữ sau khi giấy tờ đã quét an toàn');
      const active = (
        await q.query(
          "SELECT id FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND document_id=$2 AND status IN('pending','running') LIMIT 1",
          [c.organizationId, d.id],
        )
      ).rows[0];
      if (active) throw new ConflictException('Giấy tờ này đang có tác vụ OCR chờ xử lý');
      const recent = Number(
        (
          await q.query(
            "SELECT count(*)::int AS n FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND owner_user_id=$2 AND created_at>now()-interval '1 hour'",
            [c.organizationId, c.userId],
          )
        ).rows[0]!.n,
      );
      if (recent >= 20) throw new ConflictException('Tối đa 20 yêu cầu OCR mỗi giờ');
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,$4,'document-ocr-v1',now())",
        [consentId, c.organizationId, c.userId, 'local-ocr:' + d.id + ':' + d.sha256],
      );
      const r = (
        await q.query(
          'INSERT INTO identity_private.document_ocr_jobs(id,organization_id,dossier_id,document_id,owner_user_id,source_hash,consent_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
          [id, c.organizationId, uuid(dossier), d.id, c.userId, d.sha256, consentId],
        )
      ).rows[0]!;
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.ocr-requested',
        id,
      );
      return r;
    });
    return this.view(saved);
  }
  /** Owner cancels: a pending job never runs; a running job loses its lease so the result is dropped. */
  async cancel(c: Citizen, dossier: string, id: string, v: number): Promise<OcrJobView> {
    return this.db.tx(async (q) => {
      const r = await this.own(q, c, dossier, id, true);
      if (Number(r.version) !== v)
        throw new ConflictException('Phiên bản đã thay đổi; tải lại trước khi thao tác');
      if (r.status !== 'pending' && r.status !== 'running')
        throw new ConflictException('Tác vụ OCR đã kết thúc');
      const saved = (
        await q.query(
          "UPDATE identity_private.document_ocr_jobs SET status='cancelled',reason='cancelled_by_owner',lease_token=NULL,lease_until=NULL,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [r.id],
        )
      ).rows[0]!;
      await q.query(
        'UPDATE consent_records SET withdrawn_at=now() WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND withdrawn_at IS NULL',
        [r.consent_id, c.organizationId, c.userId],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'document.ocr-cancelled',
        String(r.id),
      );
      return this.view(saved);
    });
  }
  private operator(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức xem hàng đợi OCR');
  }
  /** Operator view: counters and reason codes only; never document or text content. */
  async health(s: Staff): Promise<OcrQueueHealth> {
    this.operator(s);
    return this.db.tx(async (q) => {
      await q.query("SELECT set_config('app.organization_id',$1,true)", [s.organizationId]);
      const counts = (
        await q.query(
          'SELECT status,count(*)::int AS n FROM identity_private.document_ocr_jobs WHERE organization_id=$1 GROUP BY status',
          [s.organizationId],
        )
      ).rows;
      const [oldest] = (
        await q.query(
          "SELECT EXTRACT(EPOCH FROM (now()-min(created_at)))::int AS seconds FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND status='pending'",
          [s.organizationId],
        )
      ).rows;
      const [stale] = (
        await q.query(
          "SELECT count(*)::int AS n FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND status='running' AND lease_until<=now()",
          [s.organizationId],
        )
      ).rows;
      const failures = (
        await q.query(
          "SELECT id,reason,updated_at,version FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND status='failed' ORDER BY updated_at DESC LIMIT 20",
          [s.organizationId],
        )
      ).rows;
      const c: OcrQueueHealth['counts'] = {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      };
      for (const r of counts) c[r.status as OcrJobStatus] = Number(r.n);
      return {
        enabled: this.enabled(),
        workerConfigured: this.workerConfigured(),
        counts: c,
        oldestPendingSeconds:
          oldest?.seconds === null || oldest?.seconds === undefined ? null : Number(oldest.seconds),
        staleLeases: Number(stale?.n ?? 0),
        recentFailures: failures.map((r) => ({
          id: String(r.id),
          reason: (r.reason as OcrJobReason | null) ?? null,
          updatedAt: iso(r.updated_at),
          version: Number(r.version),
        })),
        notice,
      };
    });
  }
  /** Operator-confirmed, version-bound, bounded requeue of one failed job (at most 3 attempts, 2 requeues). */
  async requeue(s: Staff, id: string, body: unknown, v: number): Promise<OcrJobView> {
    this.operator(s);
    if (!OcrAcceptedSchema.safeParse(body).success)
      throw new BadRequestException('Cần xác nhận rõ thao tác xử lý lại');
    if (!this.enabled()) throw new ServiceUnavailableException('OCR nội bộ chưa được bật');
    return this.db.tx(async (q) => {
      await q.query("SELECT set_config('app.organization_id',$1,true)", [s.organizationId]);
      const r = (
        await q.query(
          'SELECT * FROM identity_private.document_ocr_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [uuid(id), s.organizationId],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có tác vụ OCR trong phạm vi');
      if (Number(r.version) !== v)
        throw new ConflictException('Phiên bản đã thay đổi; tải lại trước khi thao tác');
      if (r.status !== 'failed') throw new ConflictException('Chỉ xử lý lại tác vụ đã thất bại');
      if (Number(r.requeue_count) >= 2 || Number(r.attempt_count) >= 3)
        throw new ConflictException('Đã hết ngân sách xử lý lại; người khai cần gửi yêu cầu mới');
      const saved = (
        await q.query(
          "UPDATE identity_private.document_ocr_jobs SET status='pending',reason='requeued',attempt_budget=$2,requeue_count=requeue_count+1,worker_failures=0,next_attempt_at=now(),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [r.id, Math.min(3, Number(r.attempt_count) + 1)],
        )
      ).rows[0]!;
      await event(q, s, 'document.ocr-requeued', String(r.id));
      return this.view(saved);
    });
  }
  private actor(org: string) {
    return { organizationId: org, subject: 'system:document-ocr' };
  }
  configuredOrganization() {
    if (!this.enabled()) return null;
    const org = process.env.AUTH_ORGANIZATION_ID;
    if (!org || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(org))
      throw new ServiceUnavailableException('Worker OCR cần tổ chức máy chủ được cấu hình rõ');
    this.workerUrl();
    return uuid(org);
  }
  private async context(q: Sql, org: string) {
    await q.query("SET LOCAL lock_timeout='2s'");
    await q.query("SET LOCAL statement_timeout='5s'");
    await q.query("SELECT set_config('app.organization_id',$1,true)", [org]);
  }
  /** Internal worker capability: bound by the configured organization, never by browser identity. */
  async claimNext(organizationId: string): Promise<OcrClaim | null> {
    const org = uuid(organizationId),
      configured = this.configuredOrganization();
    if (!configured) return null;
    if (configured !== org)
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    return this.db.tx(async (q) => {
      await this.context(q, org);
      const r = (
        await q.query(
          "SELECT id FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND ((status='pending' AND next_attempt_at<=now()) OR (status='running' AND lease_until<=now())) ORDER BY next_attempt_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
          [org],
        )
      ).rows[0];
      if (!r) return null;
      const leaseToken = randomUUID();
      await q.query(
        `UPDATE identity_private.document_ocr_jobs SET status='running',lease_token=$2,lease_until=now()+${LEASE},version=version+1,updated_at=now() WHERE id=$1`,
        [r.id, leaseToken],
      );
      return { jobId: String(r.id), organizationId: org, leaseToken };
    });
  }
  private async leased(q: Sql, claim: OcrClaim) {
    return (
      await q.query(
        "SELECT * FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND id=$2 AND status='running' AND lease_token=$3 AND lease_until>now() FOR UPDATE",
        [claim.organizationId, uuid(claim.jobId), uuid(claim.leaseToken)],
      )
    ).rows[0];
  }
  private async terminal(
    q: Sql,
    j: Row,
    status: 'failed' | 'cancelled',
    reason: OcrJobReason,
    attempt = false,
  ) {
    await q.query(
      'UPDATE identity_private.document_ocr_jobs SET status=$2,reason=$3,lease_token=NULL,lease_until=NULL,attempt_count=attempt_count+$4,version=version+1,updated_at=now() WHERE id=$1',
      [j.id, status, reason, attempt ? 1 : 0],
    );
    await event(q, this.actor(String(j.organization_id)), 'document.ocr-' + status, String(j.id));
    this.emit(j, status, reason);
    return status;
  }
  private async defer(q: Sql, j: Row, reason: OcrJobReason, untilMs: number) {
    await q.query(
      "UPDATE identity_private.document_ocr_jobs SET status='pending',reason=$2,lease_token=NULL,lease_until=NULL,attempt_count=attempt_count+1,next_attempt_at=now()+($3::int*interval '1 millisecond'),version=version+1,updated_at=now() WHERE id=$1",
      [j.id, reason, Math.max(0, Math.round(untilMs))],
    );
    this.emit(j, 'retry', reason);
  }
  private emit(
    j: Row,
    outcome: string,
    reason: string | null,
    extra: Record<string, number | boolean | string> = {},
  ) {
    this.log({
      event: 'document.ocr',
      jobId: String(j.id),
      organizationId: String(j.organization_id),
      documentId: String(j.document_id),
      outcome,
      reason,
      ...extra,
    });
  }
  /** Re-verifies, inside the caller's transaction, that the source and consent are still current. */
  private async stillValid(q: Sql, j: Row): Promise<{ document: Row } | OcrJobReason> {
    const document = (
      await q.query(
        'SELECT * FROM documents WHERE id=$1 AND organization_id=$2 AND dossier_id=$3 AND owner_user_id=$4 AND deleted_at IS NULL FOR SHARE',
        [j.document_id, j.organization_id, j.dossier_id, j.owner_user_id],
      )
    ).rows[0];
    if (!document || document.scan_status !== 'clean' || document.sha256 !== j.source_hash)
      return 'document_unavailable';
    const consent = (
      await q.query(
        'SELECT id FROM consent_records WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND withdrawn_at IS NULL',
        [j.consent_id, j.organization_id, j.owner_user_id],
      )
    ).rows[0];
    if (!consent) return 'consent_unavailable';
    try {
      await this.privacy.assertProcessing(
        { organizationId: String(j.organization_id), userId: String(j.owner_user_id) },
        q,
      );
    } catch (e) {
      if (e instanceof HttpException && e.getStatus() < 500) return 'consent_unavailable';
      throw e;
    }
    return { document };
  }
  /** One bounded HTTP call to the local worker; classifies every failure without content. */
  async recognise(bytes: Buffer, mime: string, jobId: string): Promise<OcrResult> {
    const url = this.workerUrl(),
      abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), this.ocrDeadlineMs);
    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: abort.signal,
          headers: { 'Content-Type': mime, 'X-Noxh-Ocr-Job': jobId },
          body: new Uint8Array(bytes),
        });
      } catch (e) {
        if (abort.signal.aborted) throw new OcrWorkerError('timeout', 'deadline');
        throw new OcrWorkerError('retryable', e instanceof Error ? e.name : 'network');
      }
      if (response.status >= 500 || response.status === 429) {
        await response.body?.cancel();
        throw new OcrWorkerError('retryable', 'http-' + response.status);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new OcrWorkerError('rejected', 'http-' + response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new OcrWorkerError('invalid', 'empty');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const value = await reader.read();
        if (value.done) break;
        size += value.value.byteLength;
        if (size > MAX_REPLY_BYTES) {
          await reader.cancel();
          throw new OcrWorkerError('invalid', 'oversize');
        }
        chunks.push(value.value);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new OcrWorkerError('invalid', 'invalid-json');
      }
      const result = OcrResultSchema.safeParse(parsed);
      if (!result.success) throw new OcrWorkerError('invalid', 'invalid-shape');
      return result.data;
    } catch (e) {
      if (e instanceof OcrWorkerError) throw e;
      if (abort.signal.aborted) throw new OcrWorkerError('timeout', 'deadline');
      throw new OcrWorkerError('retryable', e instanceof Error ? e.name : 'unknown');
    } finally {
      clearTimeout(timer);
    }
  }
  /** Maps OCR lines to the existing extraction proposal contract; the citizen still confirms each field. */
  proposal(result: OcrResult, lowQuality: boolean, threshold: number) {
    const warnings = [
      'Văn bản do OCR nội bộ nhận dạng tự động; hãy đối chiếu từng dòng với bản gốc. Không có trường nào được tự ghi vào bản khai.',
    ];
    if (lowQuality)
      warnings.push(
        `Chất lượng nhận dạng thấp (${Math.round(result.quality * 100)}% so với ngưỡng ${Math.round(threshold * 100)}%); kết quả có thể sai nhiều.`,
      );
    if (result.warnings.includes('no-text-detected'))
      warnings.push('Không phát hiện được chữ trên giấy tờ.');
    if (result.blocks.length > MAX_FIELDS)
      warnings.push(
        `Chỉ giữ ${MAX_FIELDS} dòng đầu trong ${result.blocks.length} dòng nhận dạng được.`,
      );
    const fields = result.blocks
      .filter((b) => b.text.trim().length > 0)
      .slice(0, MAX_FIELDS)
      .map((b, i) => ({
        key: 'line' + (i + 1),
        label: `Dòng ${i + 1} · trang ${b.page}`,
        value: b.text.slice(0, 1000),
        page: b.page,
        confidence: Math.round(b.confidence * 10000) / 10000,
        evidence: b.text.slice(0, 500),
      }));
    return ExtractionSchema.parse({ fields, warnings: warnings.slice(0, 20) });
  }
  async processClaim(claim: OcrClaim): Promise<OcrOutcome> {
    const org = this.configuredOrganization();
    if (!org) return 'lost';
    if (org !== uuid(claim.organizationId))
      throw new ForbiddenException('Worker chỉ xử lý tổ chức máy chủ được cấu hình');
    // Phase 1: verify the lease, source and consent; load what the download needs.
    const prepared = await this.db.tx(async (q) => {
      await this.context(q, org);
      const j = await this.leased(q, claim);
      if (!j) return { outcome: 'lost' as const };
      const check = await this.stillValid(q, j);
      if (typeof check === 'string')
        return { outcome: await this.terminal(q, j, 'cancelled', check) };
      return { outcome: null, job: j, document: check.document };
    });
    if (prepared.outcome) {
      if (prepared.outcome === 'cancelled') this.metrics.cancelled++;
      return prepared.outcome;
    }
    const { job, document } = prepared;
    // Phase 2: decrypt from the private store and call the local worker outside any transaction.
    const scope =
      'document:' + document.organization_id + ':' + document.owner_user_id + ':' + document.id;
    const bytes = decryptObject(
      await this.storage.get(String(document.object_key)),
      String(document.envelope_key_cipher),
      scope,
    );
    if (hashBytes(bytes) !== document.sha256)
      throw new ConflictException('Tệp không khớp dấu kiểm chứng');
    let result: OcrResult | undefined;
    let failure: OcrWorkerError | undefined;
    try {
      result = await this.recognise(bytes, String(document.mime), String(job.id));
    } catch (e) {
      if (!(e instanceof OcrWorkerError)) throw e;
      failure = e;
    }
    // Phase 3: fenced completion; a cancelled or re-leased job discards the result.
    const threshold = this.qualityThreshold();
    const outcome = await this.db.tx(async (q) => {
      await this.context(q, org);
      const j = await this.leased(q, claim);
      if (!j) return 'lost' as const;
      const check = await this.stillValid(q, j);
      if (typeof check === 'string') return this.terminal(q, j, 'cancelled', check);
      const number = Number(j.attempt_count) + 1;
      if (failure || !result) {
        const reason: OcrJobReason =
          failure?.kind === 'timeout'
            ? 'worker_timeout'
            : failure?.kind === 'retryable'
              ? 'worker_unavailable'
              : failure?.kind === 'rejected'
                ? 'worker_rejected'
                : 'invalid_result';
        const retryable = failure?.kind === 'timeout' || failure?.kind === 'retryable';
        // `code` is the worker's HTTP status or an error class name, never document content.
        this.emit(j, 'attempt', reason, { attempt: number, code: failure?.code ?? 'no-result' });
        if (retryable && number < Number(j.attempt_budget) && number < 3) {
          await this.defer(q, j, reason, this.backoffMs(number));
          return 'retry' as const;
        }
        return this.terminal(q, j, 'failed', retryable ? 'attempts_exhausted' : reason, true);
      }
      const lowQuality = result.quality < threshold;
      const payload = this.proposal(result, lowQuality, threshold);
      const extraction = randomUUID();
      const d = (
        await q.query(
          'SELECT version FROM prep_dossiers WHERE id=$1 AND organization_id=$2 FOR SHARE',
          [j.dossier_id, org],
        )
      ).rows[0];
      if (!d) return this.terminal(q, j, 'cancelled', 'document_unavailable');
      await q.query(
        'INSERT INTO document_extractions(id,organization_id,dossier_id,owner_user_id,document_id,source_hash,input_version,payload_cipher,model) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          extraction,
          org,
          j.dossier_id,
          j.owner_user_id,
          j.document_id,
          j.source_hash,
          d.version,
          seal(
            JSON.stringify(payload),
            'extraction:' + org + ':' + j.owner_user_id + ':' + extraction,
          ),
          'local-ocr:' + result.engine,
        ],
      );
      await q.query(
        "UPDATE identity_private.document_ocr_jobs SET status='succeeded',reason=NULL,lease_token=NULL,lease_until=NULL,attempt_count=attempt_count+1,quality_score=$2,low_quality=$3,engine=$4,processing_ms=$5,result_cipher=$6,extraction_id=$7,version=version+1,updated_at=now() WHERE id=$1",
        [
          j.id,
          result.quality,
          lowQuality,
          result.engine,
          result.processing_ms,
          seal(JSON.stringify(result), this.resultContext(j)),
          extraction,
        ],
      );
      await event(q, this.actor(org), 'document.extracted', extraction);
      await event(q, this.actor(org), 'document.ocr-succeeded', String(j.id));
      this.emit(j, 'succeeded', null, {
        attempt: number,
        lowQuality,
        blocks: result.blocks.length,
        processingMs: result.processing_ms,
      });
      if (lowQuality) this.metrics.lowQuality++;
      return 'succeeded' as const;
    });
    if (outcome === 'succeeded') this.metrics.succeeded++;
    else if (outcome === 'retry') this.metrics.retried++;
    else if (outcome === 'failed') this.metrics.failed++;
    else if (outcome === 'cancelled') this.metrics.cancelled++;
    return outcome;
  }
  /** Unexpected worker exception: bounded re-queue of the leased job, then final failure. */
  private async failure(claim: OcrClaim) {
    await this.db.tx(async (q) => {
      await this.context(q, claim.organizationId);
      const r = (
        await q.query(
          "SELECT * FROM identity_private.document_ocr_jobs WHERE organization_id=$1 AND id=$2 AND status='running' AND lease_token=$3 FOR UPDATE",
          [claim.organizationId, claim.jobId, claim.leaseToken],
        )
      ).rows[0];
      if (!r) return;
      const failures = Number(r.worker_failures) + 1;
      const dead = failures >= 5;
      await q.query(
        "UPDATE identity_private.document_ocr_jobs SET status=$2,reason='processing_failed',worker_failures=$3,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '30 seconds',version=version+1,updated_at=now() WHERE id=$1",
        [claim.jobId, dead ? 'failed' : 'pending', Math.min(5, failures)],
      );
      await event(
        q,
        this.actor(claim.organizationId),
        dead ? 'document.ocr-failed' : 'document.ocr-processing-failed',
        claim.jobId,
      );
      this.emit(r, dead ? 'failed' : 'retry', 'processing_failed', { workerFailures: failures });
    });
  }
  async runConfiguredBatch(shouldContinue: () => boolean = () => true) {
    const before = { ...this.metrics };
    const org = this.configuredOrganization();
    if (org)
      for (let i = 0; i < 5 && shouldContinue(); i++) {
        const claim = await this.claimNext(org);
        if (!claim) break;
        this.metrics.claimed++;
        try {
          await this.processClaim(claim);
        } catch (e) {
          // Error class only: messages could carry storage, connection or path details.
          this.metrics.workerFailures++;
          this.log({
            event: 'document.ocr-worker-failure',
            jobId: claim.jobId,
            organizationId: claim.organizationId,
            error: e instanceof Error ? e.name : 'unknown',
          });
          await this.failure(claim);
        }
      }
    const batch = emptyOcrMetrics();
    for (const k of Object.keys(batch) as (keyof OcrMetrics)[])
      batch[k] = this.metrics[k] - before[k];
    return batch;
  }
}
