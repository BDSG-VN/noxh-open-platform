import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  LotteryConfigSchema,
  LotteryCohortSchema,
  PriorityInputSchema,
  calculatePriority,
  type LotteryConfig,
  type LotteryResult,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, record, text, uuid } from './admin-service';
import { seal, unseal } from './identity-crypto';
import type { Staff } from './workforce';
import { organizationId } from './workforce';
import { algorithm, commitment, snapshotHash } from './lottery-engine';
import { runRustKernel } from './native-kernel';
export interface LotteryKernelInput {
  id: string;
  config: LotteryConfig;
  secret: string;
  entropy: string;
}
@Injectable()
export class LotteryService {
  constructor(@Inject(Database) readonly db: Database) {}
  kernel: (kind: 'lottery', payload: LotteryKernelInput) => Promise<unknown> = runRustKernel;
  private async nativeDraw(input: LotteryKernelInput): Promise<LotteryResult> {
    const raw = await this.kernel('lottery', input);
    const object = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v);
    const exact = (v: Record<string, unknown>, keys: string[]) =>
      Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
    const fail = () => new ServiceUnavailableException('Bộ máy bốc thăm chưa trả kết quả hợp lệ');
    if (
      !object(raw) ||
      !exact(raw, ['ranking', 'algorithm', 'snapshotHash', 'commitment', 'secret', 'entropy']) ||
      raw.algorithm !== algorithm ||
      raw.secret !== input.secret ||
      raw.entropy !== input.entropy ||
      raw.snapshotHash !== snapshotHash(input.config, input.id) ||
      raw.commitment !== commitment(input.secret, String(raw.snapshotHash)) ||
      !Array.isArray(raw.ranking) ||
      raw.ranking.length !== input.config.entries.length
    )
      throw fail();
    const seen = new Set<string>(),
      units = [...input.config.units].sort();
    for (const [index, entry] of raw.ranking.entries()) {
      if (
        !object(entry) ||
        !exact(entry, ['code', 'rank', 'selected', 'unit']) ||
        typeof entry.code !== 'string' ||
        !input.config.entries.includes(entry.code) ||
        seen.has(entry.code) ||
        entry.rank !== index + 1 ||
        entry.selected !== index < input.config.seats ||
        entry.unit !== (input.config.kind === 'allocation' ? units[index] : null)
      )
        throw fail();
      seen.add(entry.code);
    }
    return raw as unknown as LotteryResult;
  }
  private require(s: Staff, permission: string) {
    if (s.role !== 'org_admin' || !s.permissions?.includes(permission))
      throw new ForbiddenException('Cần quyền ' + permission + ' và MFA của nhân sự');
  }
  async list(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức đọc phân hệ bốc thăm');
    return {
      items: await this.db.query(
        'SELECT * FROM lottery_workspaces WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 100',
        [s.organizationId],
      ),
      productionEnabled: false,
      cohorts: await this.cohorts(s),
      rounds: await this.db.query(
        'SELECT r.id,r.project_id,r.name,r.status,r.closes_at FROM intake_rounds r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND p.is_synthetic AND p.archived_at IS NULL ORDER BY r.closes_at DESC LIMIT 200',
        [s.organizationId],
      ),
    };
  }
  calculate(body: unknown) {
    const p = PriorityInputSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException('Kiểm tra số hồ sơ, số căn và nhóm ưu tiên đã loại trùng');
    try {
      return calculatePriority(p.data);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Sai số liệu');
    }
  }
  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private payload(r: Row) {
    return record(
      JSON.parse(
        unseal(String(r.payload_cipher), 'lottery-cohort:' + r.organization_id + ':' + r.id),
      ),
    );
  }
  private async round(q: Sql, s: Staff, id: string, closed = true) {
    const r = (
      await q.query(
        'SELECT r.id,r.project_id,r.name,r.status,r.closes_at,p.is_synthetic,p.archived_at FROM intake_rounds r JOIN projects p ON p.id=r.project_id AND p.organization_id=r.organization_id WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE OF p,r',
        [s.organizationId, uuid(id)],
      )
    ).rows[0];
    if (!r || r.archived_at) throw new NotFoundException('Không có đợt tiếp nhận trong dự án');
    if (!r.is_synthetic) throw new ForbiddenException('Chỉ diễn tập trên dự án giả lập');
    if (closed && (r.status !== 'closed' || new Date(String(r.closes_at)).getTime() > Date.now()))
      throw new ConflictException('Cần đóng đợt tiếp nhận và hết lịch trước khi chốt danh sách');
    return r;
  }
  private async source(q: Sql, s: Staff, roundId: string, mode: string) {
    if (!['buy', 'rent-buy', 'rent'].includes(mode))
      throw new BadRequestException('Chọn hình thức mua, thuê mua hoặc thuê');
    const round = await this.round(q, s, roundId),
      rows = (
        await q.query(
          "SELECT id,public_code,version,snapshot_hash,snapshot_cipher,status,synthetic FROM applications WHERE organization_id=$1 AND round_id=$2 AND status IN('submitted','under_review','supplement','recommended','approved') ORDER BY public_code LIMIT 1501",
          [s.organizationId, uuid(roundId)],
        )
      ).rows;
    if (rows.length > 1500)
      throw new ConflictException(
        'Đợt diễn tập vượt giới hạn 1.500 hồ sơ, cần chia quy trình được rà soát',
      );
    const matching = rows.filter(
      (r) =>
        record(
          JSON.parse(
            unseal(String(r.snapshot_cipher), 'application:' + s.organizationId + ':' + r.id),
          ),
        ).mode === mode,
    );
    if (matching.some((r) => r.status !== 'approved'))
      throw new ConflictException(
        'Còn hồ sơ chưa có quyết định cuối cùng trong đợt và hình thức này',
      );
    if (!matching.length || matching.length > 500)
      throw new ConflictException('Danh sách cần từ 1 đến 500 hồ sơ đã được phê duyệt');
    if (matching.some((r) => !r.synthetic || !/^DEMO-[A-Z0-9-]{4,32}$/.test(String(r.public_code))))
      throw new ForbiddenException('Nguồn danh sách phải hoàn toàn giả lập');
    const entries = matching
        .map((r) => ({
          code: String(r.public_code),
          version: Number(r.version),
          snapshotHash: String(r.snapshot_hash),
        }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
      snapshot = entries.map((r) => [r.code, r.version, r.snapshotHash]),
      hash = this.hash([
        'cohort-source-v1',
        s.organizationId,
        String(round.project_id),
        uuid(roundId),
        mode,
        snapshot,
      ]);
    return {
      projectId: String(round.project_id),
      roundId: uuid(roundId),
      roundName: String(round.name),
      mode,
      entries,
      snapshot,
      hash,
    };
  }
  async cohortSource(s: Staff, round: string, mode: string) {
    if (
      s.role !== 'org_admin' ||
      !s.permissions?.some((p) => ['lottery_operator', 'lottery_supervisor'].includes(p))
    )
      throw new ForbiddenException('Cần quyền vận hành hoặc giám sát');
    return this.db.tx((q) => this.source(q, s, round, mode));
  }
  private cohortView(r: Row) {
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      roundId: String(r.round_id),
      roundName: String(r.round_name ?? ''),
      mode: r.mode,
      kind: r.kind,
      seats: Number(r.seats),
      entries: r.entries,
      sourceSnapshot: r.source_snapshot,
      sourceHash: r.source_hash,
      hash: r.cohort_hash,
      status: r.status,
      version: Number(r.version),
      createdBy: r.created_by,
      reviewedBy: r.reviewed_by,
      supersedesId: r.supersedes_id,
      attemptId: r.attempt_id ?? null,
      attemptStatus: r.attempt_status ?? null,
      ...this.payload(r),
    };
  }
  async cohorts(s: Staff) {
    if (s.role !== 'org_admin') throw new ForbiddenException();
    return (
      await this.db.query(
        'SELECT c.*,r.name AS round_name,w.id AS attempt_id,w.status AS attempt_status FROM lottery_cohorts c JOIN intake_rounds r ON r.id=c.round_id AND r.organization_id=c.organization_id LEFT JOIN lottery_workspaces w ON w.cohort_id=c.id WHERE c.organization_id=$1 ORDER BY c.created_at DESC LIMIT 200',
        [s.organizationId],
      )
    ).map((r) => this.cohortView(r));
  }
  private async ancestry(q: Sql, s: Staff, id: string) {
    const chain: string[] = [];
    let cursor: string | null = id;
    for (let depth = 0; cursor && depth < 100; depth++) {
      const row: Row | undefined = (
        await q.query(
          'SELECT id,supersedes_id FROM lottery_cohorts WHERE id=$1 AND organization_id=$2',
          [cursor, s.organizationId],
        )
      ).rows[0];
      if (!row) throw new NotFoundException('Không có nhóm nguồn cần thay thế');
      chain.push(String(row.id));
      cursor = row.supersedes_id ? String(row.supersedes_id) : null;
    }
    if (cursor) throw new ConflictException('Chuỗi thay thế quá dài');
    return chain;
  }
  private async replacement(
    q: Sql,
    s: Staff,
    oldId: string,
    roundId: string,
    mode: string,
    kind: string,
  ) {
    const old = (
      await q.query(
        'SELECT c.*,w.status AS attempt_status FROM lottery_cohorts c LEFT JOIN lottery_workspaces w ON w.cohort_id=c.id WHERE c.id=$1 AND c.organization_id=$2 FOR UPDATE OF c',
        [uuid(oldId), s.organizationId],
      )
    ).rows[0];
    if (!old) throw new NotFoundException('Không có nhóm nguồn cũ');
    if (
      old.round_id !== roundId ||
      old.mode !== mode ||
      old.kind !== kind ||
      !['reviewed', 'voided'].includes(String(old.status)) ||
      (old.attempt_status && old.attempt_status !== 'voided') ||
      (!old.attempt_status && old.status !== 'voided')
    )
      throw new ConflictException(
        'Phải hủy rõ ràng nhóm/phiên trước, giữ cùng đợt, hình thức và mục đích để thay thế',
      );
    return old;
  }
  private async overlap(
    q: Sql,
    s: Staff,
    round: string,
    mode: string,
    kind: string,
    entries: string[],
    ignore: string[] = [],
  ) {
    const rows = (
      await q.query(
        'SELECT id FROM lottery_cohorts WHERE organization_id=$1 AND round_id=$2 AND mode=$3 AND kind=$4 AND entries ?| $5::text[]',
        [s.organizationId, round, mode, kind, entries],
      )
    ).rows;
    if (rows.some((r) => !ignore.includes(String(r.id))))
      throw new ConflictException(
        'Hồ sơ đã nằm trong nhóm cùng mục đích; phải hủy và lập chuỗi thay thế có lý do, không chạy thử nhiều phiên',
      );
  }
  async draftCohort(s: Staff, body: unknown) {
    this.require(s, 'lottery_operator');
    const parsed = LotteryCohortSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Cần đợt, hình thức, số suất, phạm vi, căn cứ và lý do/chứng cứ cho từng mã loại',
      );
    const b = parsed.data;
    return this.db.tx(async (q) => {
      const source = await this.source(q, s, b.roundId, b.mode),
        all = new Set(source.entries.map((r) => r.code));
      if (b.exclusions.some((e) => !all.has(e.code)))
        throw new BadRequestException(
          'Mã loại không thuộc toàn bộ danh sách đã phê duyệt của đúng đợt và hình thức',
        );
      const excluded = new Set(b.exclusions.map((e) => e.code)),
        entries = source.entries.map((e) => e.code).filter((code) => !excluded.has(code));
      if (
        !entries.length ||
        (b.kind === 'allocation' ? entries.length !== b.seats : entries.length <= b.seats)
      )
        throw new BadRequestException(
          'Phạm vi không cần bốc thăm hoặc số căn không khớp số người gán căn',
        );
      let ancestors: string[] = [];
      if (b.supersedesId) {
        await this.replacement(q, s, b.supersedesId, source.roundId, b.mode, b.kind);
        ancestors = await this.ancestry(q, s, b.supersedesId);
        if (
          (await q.query('SELECT id FROM lottery_cohorts WHERE supersedes_id=$1', [b.supersedesId]))
            .rows.length
        )
          throw new ConflictException('Nhóm này đã có phiên bản thay thế; tiếp tục từ cuối chuỗi');
      }
      await this.overlap(q, s, source.roundId, b.mode, b.kind, entries, ancestors);
      const id = randomUUID(),
        payload = {
          description: b.description,
          legalBasis: b.legalBasis,
          exclusions: [...b.exclusions].sort((a, b) => (a.code < b.code ? -1 : 1)),
          replacementReason: b.replacementReason,
        },
        membershipHash = this.hash(['cohort-members-v1', source.roundId, b.mode, b.kind, entries]),
        hash = this.hash([
          'cohort-v1',
          id,
          source.roundId,
          b.mode,
          b.kind,
          b.seats,
          source.hash,
          entries,
          payload,
          b.supersedesId,
        ]);
      await q.query(
        'INSERT INTO lottery_cohorts(id,organization_id,project_id,round_id,mode,kind,seats,entries,source_snapshot,source_hash,cohort_hash,membership_hash,payload_cipher,created_by,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
        [
          id,
          s.organizationId,
          source.projectId,
          source.roundId,
          b.mode,
          b.kind,
          b.seats,
          JSON.stringify(entries),
          JSON.stringify(source.snapshot),
          source.hash,
          hash,
          membershipHash,
          seal(JSON.stringify(payload), 'lottery-cohort:' + s.organizationId + ':' + id),
          s.subject,
          b.supersedesId,
        ],
      );
      await event(q, s, 'lottery.cohort.drafted', id);
      return {
        id,
        version: 1,
        projectId: source.projectId,
        roundId: source.roundId,
        mode: b.mode,
        kind: b.kind,
        seats: b.seats,
        entries,
        sourceHash: source.hash,
        hash,
      };
    });
  }
  private async checkedCohort(q: Sql, s: Staff, id: string, config?: LotteryConfig) {
    const first = (
      await q.query(
        'SELECT round_id,mode FROM lottery_cohorts WHERE id=$1 AND organization_id=$2',
        [uuid(id), s.organizationId],
      )
    ).rows[0];
    if (!first) throw new NotFoundException('Không có nhóm nguồn');
    const source = await this.source(q, s, String(first.round_id), String(first.mode)),
      cohort = (
        await q.query(
          'SELECT * FROM lottery_cohorts WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [uuid(id), s.organizationId],
        )
      ).rows[0]!;
    if (cohort.status !== 'reviewed' || cohort.source_hash !== source.hash)
      throw new ConflictException(
        'Nhóm nguồn chưa được người khác duyệt hoặc nguồn quyết định đã thay đổi',
      );
    if (
      config &&
      (config.projectId !== cohort.project_id ||
        config.kind !== cohort.kind ||
        config.seats !== Number(cohort.seats) ||
        config.eligibilityEvidenceHash !== cohort.cohort_hash ||
        JSON.stringify([...config.entries].sort()) !== JSON.stringify(cohort.entries))
    )
      throw new ConflictException(
        'Mã dự thăm, số suất, mục đích hoặc chứng cứ không đúng nhóm nguồn đã duyệt; không được bỏ/thêm mã thủ công',
      );
    return { cohort, source };
  }
  async reviewCohort(s: Staff, id: string, body: unknown, expected = 1) {
    this.require(s, 'lottery_supervisor');
    const b = record(body);
    if (b.accepted !== true || Object.keys(b).some((k) => k !== 'accepted'))
      throw new BadRequestException('Cần xác nhận rà soát toàn bộ nguồn và từng lý do loại');
    return this.db.tx(async (q) => {
      const first = (
        await q.query('SELECT * FROM lottery_cohorts WHERE id=$1 AND organization_id=$2', [
          uuid(id),
          s.organizationId,
        ])
      ).rows[0];
      if (!first) throw new NotFoundException();
      const source = await this.source(q, s, String(first.round_id), String(first.mode)),
        r = (await q.query('SELECT * FROM lottery_cohorts WHERE id=$1 FOR UPDATE', [uuid(id)]))
          .rows[0]!;
      if (r.status !== 'draft' || r.version !== expected || r.source_hash !== source.hash)
        throw new ConflictException(
          'Nguồn hoặc nhóm đã thay đổi; phải hủy và lập bản thay thế có căn cứ',
        );
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người tạo không tự duyệt nhóm và các mã loại');
      let ignore = [String(r.id)];
      if (r.supersedes_id) {
        await this.replacement(
          q,
          s,
          String(r.supersedes_id),
          String(r.round_id),
          String(r.mode),
          String(r.kind),
        );
        ignore = ignore.concat(await this.ancestry(q, s, String(r.supersedes_id)));
      }
      await this.overlap(
        q,
        s,
        String(r.round_id),
        String(r.mode),
        String(r.kind),
        r.entries as string[],
        ignore,
      );
      if (r.supersedes_id)
        await q.query(
          "UPDATE lottery_cohorts SET status='superseded',version=version+1,updated_at=now() WHERE id=$1",
          [r.supersedes_id],
        );
      await q.query(
        "UPDATE lottery_cohorts SET status='reviewed',reviewed_by=$2,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1",
        [uuid(id), s.subject],
      );
      await event(q, s, 'lottery.cohort.reviewed', uuid(id));
      return { saved: true, version: expected + 1 };
    });
  }
  async voidCohort(s: Staff, id: string, body: unknown, expected: number) {
    this.require(s, 'lottery_supervisor');
    const b = record(body);
    if (b.accepted !== true || Object.keys(b).some((k) => !['accepted', 'reason'].includes(k)))
      throw new BadRequestException('Cần xác nhận và lý do hủy nhóm nguồn');
    const reason = text(b.reason, 2000);
    if (reason.length < 20) throw new BadRequestException('Cần lý do hủy cụ thể');
    return this.db.tx(async (q) => {
      const first = (
        await q.query('SELECT round_id FROM lottery_cohorts WHERE id=$1 AND organization_id=$2', [
          uuid(id),
          s.organizationId,
        ])
      ).rows[0];
      if (!first) throw new NotFoundException();
      await this.round(q, s, String(first.round_id), false);
      const r = (
        await q.query(
          'SELECT c.*,w.status AS attempt_status FROM lottery_cohorts c LEFT JOIN lottery_workspaces w ON w.cohort_id=c.id WHERE c.id=$1 AND c.organization_id=$2 FOR UPDATE OF c',
          [uuid(id), s.organizationId],
        )
      ).rows[0]!;
      if (!['draft', 'reviewed'].includes(String(r.status)) || r.version !== expected)
        throw new ConflictException('Nhóm nguồn đã thay đổi');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người khác người tạo mới được hủy nhóm nguồn');
      if (r.attempt_status && r.attempt_status !== 'voided')
        throw new ConflictException('Phải hủy phiên bốc thăm trước để giữ nguyên chuỗi bằng chứng');
      await q.query(
        "UPDATE lottery_cohorts SET status='voided',voided_by=$2,void_reason_cipher=$3,version=version+1,updated_at=now() WHERE id=$1",
        [
          uuid(id),
          s.subject,
          seal(reason, 'lottery-cohort-void:' + s.organizationId + ':' + uuid(id)),
        ],
      );
      await event(q, s, 'lottery.cohort.voided', uuid(id));
      return { saved: true };
    });
  }
  async eligibilityEvidence(s: Staff, body: unknown) {
    this.require(s, 'lottery_operator');
    const b = record(body);
    if (Object.keys(b).some((k) => k !== 'cohortId'))
      throw new BadRequestException(
        'Chỉ chọn nhóm nguồn đã duyệt; không băm một danh sách tự nhập',
      );
    return this.db.tx(async (q) => {
      const { cohort, source } = await this.checkedCohort(q, s, uuid(b.cohortId));
      return {
        hash: cohort.cohort_hash,
        sourceHash: source.hash,
        entries: cohort.entries,
        seats: cohort.seats,
        kind: cohort.kind,
        roundId: cohort.round_id,
        mode: cohort.mode,
      };
    });
  }
  async create(s: Staff, body: unknown) {
    this.require(s, 'lottery_operator');
    const p = LotteryConfigSchema.safeParse(body);
    if (!p.success)
      throw new BadRequestException(
        'Kiểm tra mã DEMO, suất/căn hộ, quy chế, chứng cứ và nguồn ngẫu nhiên',
      );
    const b = p.data;
    if (new Date(b.scheduledAt).getTime() <= Date.now())
      throw new BadRequestException(
        'Lịch lấy ngẫu nhiên phải ở tương lai để công bố cam kết trước',
      );
    return this.db.tx(async (q) => {
      const { cohort } = await this.checkedCohort(q, s, b.cohortId, b);
      if (
        (await q.query('SELECT id FROM lottery_workspaces WHERE cohort_id=$1', [cohort.id])).rows
          .length
      )
        throw new ConflictException(
          'Nhóm nguồn đã có một lượt bốc thăm; không chạy lại hoặc tạo phiên song song',
        );
      const id = randomUUID(),
        hash = createHash('sha256').update(JSON.stringify(b)).digest('hex');
      await q.query(
        'INSERT INTO lottery_workspaces(id,organization_id,project_id,title,config,config_hash,created_by,eligibility_snapshot,cohort_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          id,
          s.organizationId,
          b.projectId,
          b.title,
          JSON.stringify(b),
          hash,
          s.subject,
          JSON.stringify(cohort.source_snapshot),
          cohort.id,
        ],
      );
      await event(q, s, 'lottery.drafted', id);
      return { id, version: 1 };
    });
  }
  async transition(s: Staff, id: string, action: string, body: unknown, expected: number) {
    id = uuid(id);
    const b = record(body);
    if (
      b.accepted !== true ||
      Object.keys(b).some(
        (k) => !['accepted', 'entropy', 'record', 'minutesHash', 'reason'].includes(k),
      )
    )
      throw new BadRequestException('Cần xem và xác nhận riêng thao tác');
    const supervisor = ['review', 'entropy', 'certify', 'void'].includes(action);
    this.require(s, supervisor ? 'lottery_supervisor' : 'lottery_operator');
    return this.db.tx(async (q) => {
      // Lock project/round/cohort before the attempt, consistent with inventory's project-first locks.
      if (action !== 'void') {
        const first = (
          await q.query(
            'SELECT config FROM lottery_workspaces WHERE id=$1 AND organization_id=$2',
            [id, s.organizationId],
          )
        ).rows[0];
        if (!first) throw new NotFoundException('Không có phiên');
        const original = LotteryConfigSchema.parse(first.config);
        await this.checkedCohort(q, s, original.cohortId, original);
      }
      const r = (
        await q.query(
          'SELECT * FROM lottery_workspaces WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [id, s.organizationId],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có phiên');
      if (Number(r.version) !== expected) throw new ConflictException('Phiên đã thay đổi, tải lại');
      const config = LotteryConfigSchema.parse(r.config);
      const required: Record<string, string> = {
        review: 'draft',
        freeze: 'reviewed',
        entropy: 'frozen',
        execute: 'seeded',
        certify: 'drawn',
        publish: 'certified',
      };
      if (action !== 'void' && r.status !== required[action])
        throw new ConflictException('Sai giai đoạn hoặc thao tác đã thực hiện');
      if (action === 'review') {
        if (s.subject === r.created_by)
          throw new ForbiddenException('Người soạn không được tự duyệt quy chế và danh sách');
        await q.query(
          "UPDATE lottery_workspaces SET status='reviewed',reviewed_by=$2,version=version+1,updated_at=now() WHERE id=$1",
          [id, s.subject],
        );
      } else if (action === 'freeze') {
        if (new Date(config.scheduledAt).getTime() <= Date.now())
          throw new ConflictException(
            'Đã quá lịch cam kết, tạo phiên mới; không dùng nguồn ngẫu nhiên đã biết',
          );
        const secret = randomBytes(32).toString('hex'),
          hash = snapshotHash(config, id),
          commit = commitment(secret, hash);
        await q.query(
          'INSERT INTO identity_private.lottery_secrets(id,organization_id,secret_cipher) VALUES($1,$2,$3)',
          [id, s.organizationId, seal(secret, 'lottery-secret:' + s.organizationId + ':' + id)],
        );
        await q.query(
          "UPDATE lottery_workspaces SET status='frozen',snapshot_hash=$2,commitment=$3,frozen_at=now(),version=version+1,updated_at=now() WHERE id=$1",
          [id, hash, commit],
        );
      } else if (action === 'entropy') {
        if (new Date(config.scheduledAt).getTime() > Date.now())
          throw new ConflictException('Chưa đến lịch nguồn ngẫu nhiên đã cam kết');
        if (typeof b.entropy !== 'string' || !/^[a-f0-9]{64}$/.test(b.entropy))
          throw new BadRequestException('Cần đúng 32 byte ngẫu nhiên dạng hex');
        const sourceRecord = text(b.record, 1000);
        await q.query(
          "UPDATE lottery_workspaces SET status='seeded',entropy=$2,entropy_record=$3,version=version+1,updated_at=now() WHERE id=$1",
          [id, b.entropy, sourceRecord],
        );
      } else if (action === 'execute') {
        const material = (
          await q.query(
            'SELECT secret_cipher FROM identity_private.lottery_secrets WHERE id=$1 AND organization_id=$2',
            [id, s.organizationId],
          )
        ).rows[0];
        if (!material) throw new ConflictException('Thiếu bí mật đã cam kết');
        const result = await this.nativeDraw({
          config,
          id,
          secret: unseal(
            String(material.secret_cipher),
            'lottery-secret:' + s.organizationId + ':' + id,
          ),
          entropy: String(r.entropy),
        });
        if (result.commitment !== r.commitment || result.snapshotHash !== r.snapshot_hash)
          throw new ConflictException('Cam kết không khớp, không chạy');
        await q.query(
          "UPDATE lottery_workspaces SET status='drawn',result=$2,executed_by=$3,version=version+1,updated_at=now() WHERE id=$1",
          [id, JSON.stringify(result), s.subject],
        );
      } else if (action === 'certify') {
        if (s.subject === r.executed_by || s.subject === r.created_by)
          throw new ForbiddenException(
            'Người vận hành hoặc người soạn không được xác nhận kết quả của mình',
          );
        if (typeof b.minutesHash !== 'string' || !/^[a-f0-9]{64}$/.test(b.minutesHash))
          throw new BadRequestException('Cần mã SHA-256 biên bản diễn tập đã kiểm tra');
        const result = record(r.result) as unknown as LotteryResult,
          verified = await this.nativeDraw({
            config,
            id,
            secret: result.secret,
            entropy: result.entropy,
          });
        const tuple = (v: LotteryResult) =>
          v.ranking.map((x) => [x.code, x.rank, x.selected, x.unit]);
        if (
          verified.algorithm !== result.algorithm ||
          verified.snapshotHash !== result.snapshotHash ||
          verified.commitment !== result.commitment ||
          JSON.stringify(tuple(verified)) !== JSON.stringify(tuple(result))
        )
          throw new ConflictException('Kết quả không tái lập được');
        await q.query(
          "UPDATE lottery_workspaces SET status='certified',certified_by=$2,minutes_hash=$3,version=version+1,updated_at=now() WHERE id=$1",
          [id, s.subject, b.minutesHash],
        );
      } else if (action === 'publish')
        await q.query(
          "UPDATE lottery_workspaces SET status='published',published_at=now(),version=version+1,updated_at=now() WHERE id=$1",
          [id],
        );
      else if (action === 'void') {
        if (r.status === 'voided') throw new ConflictException('Phiên đã hủy');
        const reason = text(b.reason, 1000);
        if (reason.length < 10) throw new BadRequestException('Cần nêu rõ lý do hủy');
        await q.query(
          "UPDATE lottery_workspaces SET status='voided',void_reason=$2,version=version+1,updated_at=now() WHERE id=$1",
          [id, reason],
        );
      } else throw new BadRequestException('Không có thao tác');
      await event(q, s, 'lottery.' + action, id);
      return { id, saved: true, version: expected + 1 };
    });
  }
  private publicView(r: Row) {
    const config = LotteryConfigSchema.parse(r.config);
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      version: r.version,
      synthetic: true,
      productionEnabled: false,
      cohort: { id: r.cohort_id, hash: config.eligibilityEvidenceHash },
      config,
      commitment: r.commitment,
      snapshotHash: r.snapshot_hash,
      frozenAt: r.frozen_at,
      publishedAt: r.published_at,
      entropyRecord: ['published', 'voided'].includes(String(r.status)) ? r.entropy_record : null,
      minutesHash: ['published', 'voided'].includes(String(r.status)) ? r.minutes_hash : null,
      result: ['published', 'voided'].includes(String(r.status)) ? r.result : null,
      voidReason: r.status === 'voided' ? r.void_reason : null,
    };
  }
  async publicList() {
    return {
      items: (
        await this.db.query(
          'SELECT * FROM lottery_workspaces WHERE organization_id=$1 AND frozen_at IS NOT NULL ORDER BY created_at DESC LIMIT 100',
          [organizationId()],
        )
      ).map((r) => this.publicView(r)),
    };
  }
  async publicOne(id: string) {
    const [r] = await this.db.query(
      'SELECT * FROM lottery_workspaces WHERE id=$1 AND organization_id=$2 AND frozen_at IS NOT NULL',
      [uuid(id), organizationId()],
    );
    if (!r) throw new NotFoundException('Phiên chưa công bố cam kết hoặc không tồn tại');
    return this.publicView(r);
  }
}
