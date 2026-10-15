import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import {
  AllocateUnitSchema,
  InventoryImportSchema,
  PricePlanSchema,
  QueueBindingSchema,
  QueueRevocationSchema,
  SalesRulesSchema,
  type InventoryUnit,
  type LotteryResult,
  type PriceQuote,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { event, uuid, record, text } from './admin-service';
import type { Staff } from './workforce';
import type { Citizen } from './phone-service';
import { seal, unseal } from './identity-crypto';
import { PrivacyService } from './privacy-service';
import { runRustKernel, type NativeKernelKind } from './native-kernel';

type PricingInput = { units: InventoryUnit[]; baseVndPerM2: string };
const quoteKeys = [
  'areaCm2',
  'building',
  'code',
  'coefficientDenominator',
  'coefficientNumerator',
  'totalVnd',
  'unitPriceDenominator',
  'unitPriceNumerator',
].sort();
/** Validate transport and arithmetic evidence; Rust alone produces the price proposal. */
function pricingResult(value: unknown, input: PricingInput): PriceQuote[] {
  const fail = () => {
    throw new ServiceUnavailableException('Bộ tính giá Rust trả bằng chứng không hợp lệ');
  };
  if (!Array.isArray(value) || value.length !== input.units.length) return fail();
  const totals = new Map<string, { area: bigint; weighted: bigint }>();
  for (const unit of input.units) {
    const total = totals.get(unit.building) ?? { area: 0n, weighted: 0n };
    total.area += BigInt(unit.areaCm2);
    total.weighted += BigInt(unit.areaCm2) * BigInt(unit.weight);
    totals.set(unit.building, total);
  }
  const sorted = [...input.units].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (let i = 0; i < value.length; i++) {
    const row: unknown = value[i],
      unit = sorted[i]!;
    if (!row || typeof row !== 'object' || Array.isArray(row)) return fail();
    const q = row as Record<string, unknown>;
    if (
      Object.keys(q).sort().join(',') !== quoteKeys.join(',') ||
      q.code !== unit.code ||
      q.building !== unit.building ||
      q.areaCm2 !== unit.areaCm2
    )
      return fail();
    for (const key of [
      'coefficientNumerator',
      'coefficientDenominator',
      'unitPriceNumerator',
      'unitPriceDenominator',
      'totalVnd',
    ]) {
      if (typeof q[key] !== 'string' || !/^(0|[1-9]\d{0,37})$/.test(q[key] as string))
        return fail();
    }
    const numerator = BigInt(q.coefficientNumerator as string),
      denominator = BigInt(q.coefficientDenominator as string),
      unitPrice = BigInt(q.unitPriceNumerator as string);
    const total = totals.get(unit.building)!;
    if (
      numerator < 1n ||
      numerator > 50000000000000000n ||
      denominator < 1n ||
      denominator > 50000000000000000n ||
      q.unitPriceDenominator !== q.coefficientDenominator ||
      numerator !== BigInt(unit.weight) * total.area ||
      denominator !== total.weighted ||
      unitPrice !== BigInt(input.baseVndPerM2) * numerator ||
      BigInt(q.totalVnd as string) !==
        (2n * unitPrice * BigInt(unit.areaCm2) + 10000n * denominator) / (20000n * denominator)
    )
      return fail();
  }
  return value as PriceQuote[];
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  body: unknown,
): T {
  const r = schema.safeParse(body);
  if (!r.success)
    throw new BadRequestException('Kiểm tra số liệu, quy chế, nguồn và xác nhận giả lập');
  return r.data!;
}
function unit(r: Row): InventoryUnit {
  return {
    code: String(r.code),
    building: String(r.building),
    floor: Number(r.floor),
    position: Number(r.position),
    areaCm2: Number(r.area_cm2),
    type: String(r.unit_type),
    orientation: String(r.orientation),
    weight: Number(r.weight),
  };
}
@Injectable()
export class InventoryService {
  /** Explicit reference injection is for isolated tests; deployed requests always use Rust. */
  kernel: (kind: NativeKernelKind, input: PricingInput) => Promise<unknown> = runRustKernel;
  constructor(@Inject(Database) readonly db: Database) {}
  private manager(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị chủ đầu tư quản lý bảng hàng');
  }
  private approver(s: Staff, id: string) {
    if (!s.permissions?.includes('price_approver'))
      throw new ForbiddenException('Cần quyền price_approver đã ký trong phiên nhân sự');
    if (s.role !== 'org_admin' && !s.projectIds?.includes(uuid(id)))
      throw new NotFoundException('Dự án ngoài phạm vi rà soát giá');
  }
  private async project(q: Sql, org: string, id: string) {
    const r = (
      await q.query(
        'SELECT id,is_synthetic,publication_status FROM projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE',
        [id, org],
      )
    ).rows[0];
    if (!r) throw new NotFoundException('Dự án ngoài phạm vi');
    if (r.is_synthetic !== true)
      throw new ForbiddenException(
        'Bảng hàng hiện chỉ diễn tập trên dự án giả lập, chưa mở giao dịch thật',
      );
    return r;
  }
  private async board(q: Sql, org: string, id: string) {
    return (
      await q.query(
        'SELECT * FROM inventory_boards WHERE organization_id=$1 AND project_id=$2 FOR UPDATE',
        [org, id],
      )
    ).rows[0];
  }
  private async sales(q: Sql, org: string, id: string) {
    return (
      await q.query(
        'SELECT * FROM inventory_sales WHERE organization_id=$1 AND project_id=$2 FOR UPDATE',
        [org, id],
      )
    ).rows[0];
  }
  async admin(s: Staff, id: string) {
    if (s.role !== 'org_admin') this.approver(s, id);
    id = uuid(id);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const units = (
        await q.query(
          'SELECT u.*,a.id AS allocation_id FROM inventory_units u LEFT JOIN inventory_allocations a ON a.unit_id=u.id AND a.organization_id=u.organization_id WHERE u.organization_id=$1 AND u.project_id=$2 ORDER BY building,floor,position',
          [s.organizationId, id],
        )
      ).rows.map((r) => ({ ...unit(r), allocated: Boolean(r.allocation_id) }));
      return {
        synthetic: true,
        productionEnabled: false,
        boardVersion: Number((await this.board(q, s.organizationId, id))?.version ?? 0),
        units,
        plans: (
          await q.query(
            'SELECT * FROM inventory_price_plans WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100',
            [s.organizationId, id],
          )
        ).rows,
        sales: (await this.sales(q, s.organizationId, id)) ?? null,
        queue: (
          await q.query(
            'SELECT q.id,q.public_code,q.rank,q.assigned_unit,q.status,q.version,a.id AS allocation_id,u.code AS allocated_unit FROM identity_private.inventory_queue q LEFT JOIN inventory_allocations a ON a.queue_id=q.id AND a.organization_id=q.organization_id LEFT JOIN inventory_units u ON u.id=a.unit_id AND u.organization_id=a.organization_id WHERE q.organization_id=$1 AND q.project_id=$2 ORDER BY q.rank',
            [s.organizationId, id],
          )
        ).rows,
      };
    });
  }
  async import(s: Staff, id: string, body: unknown, expected: number) {
    this.manager(s);
    id = uuid(id);
    const b = parse(InventoryImportSchema, body);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const old = await this.board(q, s.organizationId, id);
      if (Number(old?.version ?? 0) !== expected)
        throw new ConflictException('Bảng hàng đã thay đổi, tải lại');
      if (
        (
          await q.query(
            'SELECT id FROM inventory_price_plans WHERE organization_id=$1 AND project_id=$2 LIMIT 1',
            [s.organizationId, id],
          )
        ).rows.length
      )
        throw new ConflictException(
          'Bảng hàng đã có phương án giá; không sửa diện tích/hệ số của bằng chứng đã lập',
        );
      if (!old)
        await q.query('INSERT INTO inventory_boards(organization_id,project_id) VALUES($1,$2)', [
          s.organizationId,
          id,
        ]);
      else {
        await q.query('DELETE FROM inventory_units WHERE organization_id=$1 AND project_id=$2', [
          s.organizationId,
          id,
        ]);
        await q.query(
          'UPDATE inventory_boards SET version=version+1,updated_at=now() WHERE organization_id=$1 AND project_id=$2',
          [s.organizationId, id],
        );
      }
      for (const u of b.units)
        await q.query(
          'INSERT INTO inventory_units(id,organization_id,project_id,code,building,floor,position,area_cm2,unit_type,orientation,weight) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            randomUUID(),
            s.organizationId,
            id,
            u.code,
            u.building,
            u.floor,
            u.position,
            u.areaCm2,
            u.type,
            u.orientation,
            u.weight,
          ],
        );
      await event(q, s, 'inventory.imported', id);
      return { saved: true, version: expected + 1 };
    });
  }
  async createPrice(s: Staff, id: string, body: unknown, expected: number) {
    this.manager(s);
    id = uuid(id);
    const b = parse(PricePlanSchema, body);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const board = await this.board(q, s.organizationId, id);
      if (!board || Number(board.version) !== expected)
        throw new ConflictException('Cần bảng hàng hiện hành');
      if ((await this.sales(q, s.organizationId, id))?.activated_at)
        throw new ConflictException('Đã kích hoạt phương thức; không thay giá cho bảng phân căn');
      const units = (
          await q.query(
            'SELECT * FROM inventory_units WHERE organization_id=$1 AND project_id=$2 ORDER BY code',
            [s.organizationId, id],
          )
        ).rows.map(unit),
        pricingInput = { units, baseVndPerM2: b.baseVndPerM2 },
        quotes = pricingResult(await this.kernel('pricing', pricingInput), pricingInput),
        pid = randomUUID();
      const snapshotHash = hash({
        algorithm: 'area-weighted-per-building-v1',
        boardVersion: board.version,
        config: b,
        units,
        quotes,
      });
      await q.query(
        'INSERT INTO inventory_price_plans(id,organization_id,project_id,board_version,title,config,quotes,snapshot_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          pid,
          s.organizationId,
          id,
          board.version,
          b.title,
          JSON.stringify(b),
          JSON.stringify(quotes),
          snapshotHash,
          s.subject,
        ],
      );
      await event(q, s, 'inventory.price.drafted', pid);
      return { id: pid, version: 1, snapshotHash, quotes };
    });
  }
  async reviewPrice(s: Staff, id: string, plan: string, body: unknown, expected: number) {
    this.approver(s, id);
    id = uuid(id);
    plan = uuid(plan);
    const b = record(body);
    if (b.accepted !== true || !['approved', 'rejected'].includes(String(b.decision)))
      throw new BadRequestException('Cần quyết định và xác nhận riêng');
    const note = text(b.note, 2000);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const r = (
        await q.query(
          'SELECT * FROM inventory_price_plans WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [plan, s.organizationId, id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Không có phương án');
      if (r.status !== 'draft' || Number(r.version) !== expected)
        throw new ConflictException('Phương án đã thay đổi');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người lập không được tự duyệt giá');
      await q.query(
        'UPDATE inventory_price_plans SET status=$2,reviewed_by=$3,review_note=$4,reviewed_at=now(),version=version+1 WHERE id=$1',
        [plan, b.decision, s.subject, note],
      );
      await event(q, s, 'inventory.price.' + String(b.decision), plan);
      return { saved: true, version: expected + 1 };
    });
  }
  async configureSales(s: Staff, id: string, body: unknown, expected: number) {
    this.manager(s);
    id = uuid(id);
    const raw = record(body),
      pricePlanId = uuid(raw.pricePlanId);
    const { pricePlanId: _ignored, ...rules } = raw;
    void _ignored;
    const b = parse(SalesRulesSchema, rules);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const old = await this.sales(q, s.organizationId, id);
      if (Number(old?.version ?? 0) !== expected)
        throw new ConflictException('Quy chế đã thay đổi');
      if (old?.activated_at)
        throw new ConflictException(
          'Phương thức đã từng kích hoạt, chỉ được tạm dừng/tiếp tục; không đổi cách thức hay căn cứ',
        );
      if (
        (
          await q.query(
            'SELECT id FROM identity_private.inventory_queue WHERE organization_id=$1 AND project_id=$2 LIMIT 1',
            [s.organizationId, id],
          )
        ).rows.length
      )
        throw new ConflictException('Đã gắn danh sách; không thay quy chế');
      const p = (
        await q.query(
          "SELECT * FROM inventory_price_plans WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='approved'",
          [pricePlanId, s.organizationId, id],
        )
      ).rows[0];
      if (!p) throw new BadRequestException('Cần phương án giá được người độc lập duyệt');
      if (new Date(PricePlanSchema.parse(p.config).effectiveFrom).getTime() > Date.now())
        throw new BadRequestException('Giá chưa đến hiệu lực');
      if (b.mode !== 'disabled')
        await this.publishedLottery(q, s.organizationId, id, b.lotteryId!, b.mode);
      await q.query(
        "INSERT INTO inventory_sales(organization_id,project_id,mode,config,lottery_id,price_plan_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,project_id) DO UPDATE SET mode=$3,config=$4,lottery_id=$5,price_plan_id=$6,created_by=$7,reviewed_by=NULL,status='draft',version=inventory_sales.version+1",
        [s.organizationId, id, b.mode, JSON.stringify(b), b.lotteryId, pricePlanId, s.subject],
      );
      await event(q, s, 'inventory.sales.drafted', id);
      return { saved: true, version: expected + 1 };
    });
  }
  private async publishedLottery(q: Sql, org: string, project: string, id: string, mode: string) {
    const r = (
      await q.query(
        "SELECT * FROM lottery_workspaces WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='published' AND synthetic=true FOR SHARE",
        [id, org, project],
      )
    ).rows[0];
    if (!r || !r.result) throw new ConflictException('Phiên bốc thăm chưa công bố hoặc đã hủy');
    const kind = record(r.config).kind;
    if (
      mode === 'published-random'
        ? kind !== 'allocation'
        : !['selection', 'priority-overflow'].includes(String(kind))
    )
      throw new BadRequestException('Loại phiên không khớp phương thức bán hàng');
    return r;
  }
  async salesAction(s: Staff, id: string, action: string, body: unknown, expected: number) {
    id = uuid(id);
    if (action === 'review') this.approver(s, id);
    else this.manager(s);
    if (record(body).accepted !== true)
      throw new BadRequestException('Cần xem và xác nhận thao tác');
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const r = await this.sales(q, s.organizationId, id);
      if (!r) throw new NotFoundException('Chưa cấu hình');
      if (Number(r.version) !== expected) throw new ConflictException('Quy chế đã thay đổi');
      let status: string;
      if (action === 'review') {
        if (r.status !== 'draft') throw new ConflictException('Chỉ duyệt bản nháp');
        if (r.created_by === s.subject)
          throw new ForbiddenException('Không tự duyệt quy chế phân căn');
        status = 'approved';
      } else if (action === 'activate') {
        if (!['approved', 'paused'].includes(String(r.status)))
          throw new ConflictException('Cần quy chế đã duyệt hoặc đang tạm dừng');
        if (r.mode === 'disabled') throw new BadRequestException('Phương thức đang tắt');
        const draw = await this.publishedLottery(
          q,
          s.organizationId,
          id,
          String(r.lottery_id),
          String(r.mode),
        );
        const bindings = (
          await q.query(
            'SELECT * FROM identity_private.inventory_queue WHERE organization_id=$1 AND project_id=$2',
            [s.organizationId, id],
          )
        ).rows;
        const selected = (draw.result as unknown as LotteryResult).ranking.filter(
          (x) => x.selected,
        );
        if (
          selected.some(
            (x) => !bindings.some((b) => b.public_code === x.code && Number(b.rank) === x.rank),
          )
        )
          throw new ConflictException(
            'Phải gắn đủ toàn bộ mã được chọn; không bỏ qua người có thứ tự sớm hơn',
          );
        if (!bindings.some((b) => b.status === 'active'))
          throw new ConflictException('Chưa có khách diễn tập còn hiệu lực trong danh sách');
        for (const binding of bindings.filter((b) => b.status === 'active'))
          await this.approvedApplication(
            q,
            s.organizationId,
            id,
            String(binding.application_id),
            String(binding.dossier_id),
            String(binding.user_id),
          );
        status = 'active';
      } else if (action === 'pause') {
        if (r.status !== 'active') throw new ConflictException('Bảng phân căn chưa mở');
        status = 'paused';
      } else throw new BadRequestException('Không có thao tác');
      await q.query(
        "UPDATE inventory_sales SET status=$3,reviewed_by=CASE WHEN $4='review' THEN $5 ELSE reviewed_by END,activated_at=CASE WHEN $4='activate' THEN COALESCE(activated_at,now()) ELSE activated_at END,version=version+1 WHERE organization_id=$1 AND project_id=$2",
        [s.organizationId, id, status, action, s.subject],
      );
      await event(q, s, 'inventory.sales.' + action, id);
      return { saved: true, version: expected + 1 };
    });
  }
  async bind(s: Staff, id: string, body: unknown, expected: number) {
    this.manager(s);
    id = uuid(id);
    const b = parse(QueueBindingSchema, body);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      const sales = await this.sales(q, s.organizationId, id);
      if (!sales || Number(sales.version) !== expected || sales.activated_at)
        throw new ConflictException('Chỉ gắn danh sách trước kích hoạt với phiên bản hiện hành');
      const lottery = await this.publishedLottery(
          q,
          s.organizationId,
          id,
          String(sales.lottery_id),
          String(sales.mode),
        ),
        ranking = (lottery.result as unknown as LotteryResult).ranking,
        entry = ranking.find((x) => x.code === b.code && x.selected);
      if (!entry) throw new BadRequestException('Mã hồ sơ chưa được chọn trong kết quả đã công bố');
      const d = (
        await q.query(
          'SELECT owner_user_id FROM prep_dossiers WHERE id=$1 AND organization_id=$2 AND project_id=$3',
          [b.dossierId, s.organizationId, id],
        )
      ).rows[0];
      if (!d) throw new NotFoundException('Hồ sơ chuẩn bị ngoài dự án');
      const approved = await this.approvedApplication(
        q,
        s.organizationId,
        id,
        b.applicationId,
        b.dossierId,
        String(d.owner_user_id),
      );
      if (approved.public_code !== b.code)
        throw new BadRequestException(
          'Mã công khai không khớp hồ sơ đã được phê duyệt; không được gắn lại mã cho người khác',
        );
      if (
        sales.mode === 'published-random' &&
        !(
          await q.query(
            'SELECT id FROM inventory_units WHERE organization_id=$1 AND project_id=$2 AND code=$3',
            [s.organizationId, id, entry.unit],
          )
        ).rows.length
      )
        throw new BadRequestException('Căn trong kết quả không thuộc bảng hàng');
      const prior = (
        await q.query(
          'SELECT id FROM identity_private.inventory_queue WHERE organization_id=$1 AND project_id=$2 AND (user_id=$3 OR public_code=$4)',
          [s.organizationId, id, d.owner_user_id, b.code],
        )
      ).rows[0];
      if (prior)
        throw new ConflictException('Khách hoặc mã đã được gắn; không thay người sau công bố');
      const qid = randomUUID();
      await q.query(
        'INSERT INTO identity_private.inventory_queue(id,organization_id,project_id,user_id,dossier_id,application_id,public_code,rank,assigned_unit,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          qid,
          s.organizationId,
          id,
          d.owner_user_id,
          b.dossierId,
          b.applicationId,
          b.code,
          entry.rank,
          entry.unit,
          s.subject,
        ],
      );
      await q.query(
        'UPDATE inventory_sales SET version=version+1 WHERE organization_id=$1 AND project_id=$2',
        [s.organizationId, id],
      );
      await event(q, s, 'inventory.queue.bound', qid);
      return { id: qid, version: expected + 1 };
    });
  }
  async revoke(s: Staff, id: string, queueId: string, body: unknown, expected: number) {
    this.approver(s, id);
    id = uuid(id);
    queueId = uuid(queueId);
    const b = parse(QueueRevocationSchema, body);
    return this.db.tx(async (q) => {
      await this.project(q, s.organizationId, id);
      await this.sales(q, s.organizationId, id);
      const r = (
        await q.query(
          'SELECT * FROM identity_private.inventory_queue WHERE id=$1 AND organization_id=$2 AND project_id=$3 FOR UPDATE',
          [queueId, s.organizationId, id],
        )
      ).rows[0];
      if (!r) throw new NotFoundException('Ngoài phạm vi');
      if (Number(r.version) !== expected || r.status !== 'active')
        throw new ConflictException('Danh sách đã thay đổi');
      if (r.created_by === s.subject)
        throw new ForbiddenException('Người gắn danh sách không được tự thu hồi lượt');
      if (
        (await q.query('SELECT id FROM inventory_allocations WHERE queue_id=$1', [queueId])).rows
          .length
      )
        throw new ConflictException(
          'Đã phân căn, giữ nguyên bằng chứng; cần quy trình tranh chấp riêng',
        );
      await q.query(
        "UPDATE identity_private.inventory_queue SET status='revoked',revocation_reason_cipher=$2,revoked_by=$3,revoked_at=now(),version=version+1 WHERE id=$1",
        [
          queueId,
          seal(b.reason, 'inventory-revocation:' + s.organizationId + ':' + queueId),
          s.subject,
        ],
      );
      await event(q, s, 'inventory.queue.revoked', queueId);
      return { saved: true };
    });
  }
  async citizen(c: Citizen, id: string) {
    id = uuid(id);
    return this.db.tx(async (q) => {
      const p = await this.project(q, c.organizationId, id);
      if (p.publication_status !== 'published') throw new NotFoundException('Dự án chưa công bố');
      const sales = await this.sales(q, c.organizationId, id);
      if (!sales || !sales.activated_at)
        return { synthetic: true, enabled: false, notice: 'Chưa mở diễn tập chọn căn cho dự án.' };
      const me = (
        await q.query(
          'SELECT * FROM identity_private.inventory_queue WHERE organization_id=$1 AND project_id=$2 AND user_id=$3',
          [c.organizationId, id, c.userId],
        )
      ).rows[0];
      if (!me || me.status !== 'active')
        return {
          synthetic: true,
          enabled: false,
          notice:
            'Bạn chưa có quyền diễn tập phân căn trong danh sách. Đăng nhập điện thoại không xác định điều kiện mua NOXH.',
        };
      await this.approvedApplication(
        q,
        c.organizationId,
        id,
        String(me.application_id),
        String(me.dossier_id),
        c.userId,
      );
      const lottery = await this.publishedLottery(
        q,
        c.organizationId,
        id,
        String(sales.lottery_id),
        String(sales.mode),
      );
      void lottery;
      const plan = (
        await q.query(
          'SELECT quotes,title,snapshot_hash,config FROM inventory_price_plans WHERE id=$1 AND organization_id=$2 AND project_id=$3',
          [sales.price_plan_id, c.organizationId, id],
        )
      ).rows[0]!;
      const units = (
        await q.query(
          'SELECT u.*,a.id AS allocation_id FROM inventory_units u LEFT JOIN inventory_allocations a ON a.unit_id=u.id AND a.organization_id=u.organization_id WHERE u.organization_id=$1 AND u.project_id=$2 ORDER BY building,floor,position',
          [c.organizationId, id],
        )
      ).rows.map((r) => ({ ...unit(r), allocated: Boolean(r.allocation_id) }));
      const next = await this.next(q, c.organizationId, id),
        allocation =
          (
            await q.query(
              'SELECT a.id,a.quote,a.allocated_at,u.code FROM inventory_allocations a JOIN inventory_units u ON u.id=a.unit_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.queue_id=$3',
              [c.organizationId, id, me.id],
            )
          ).rows[0] ?? null;
      return {
        synthetic: true,
        enabled: sales.status === 'active',
        mode: sales.mode,
        version: sales.version,
        code: me.public_code,
        rank: me.rank,
        assignedUnit: me.assigned_unit,
        nextRank: next?.rank ?? null,
        myTurn: next?.id === me.id,
        rules: record(sales.config).rules,
        units,
        quotes: plan.quotes,
        priceTitle: plan.title,
        priceHash: plan.snapshot_hash,
        priceBasis: record(plan.config).basis,
        allocation,
        notice:
          'Diễn tập bằng hồ sơ giả lập, không phải đặt cọc, hợp đồng hay quyết định được mua nhà. Sơ đồ ô lưới được dựng từ vị trí khai báo, không thay mặt bằng kỹ thuật.',
      };
    });
  }
  private async next(q: Sql, org: string, id: string) {
    return (
      await q.query(
        "SELECT q.id,q.rank FROM identity_private.inventory_queue q WHERE q.organization_id=$1 AND q.project_id=$2 AND q.status='active' AND NOT EXISTS(SELECT 1 FROM inventory_allocations a WHERE a.queue_id=q.id) ORDER BY q.rank LIMIT 1",
        [org, id],
      )
    ).rows[0];
  }
  private async approvedApplication(
    q: Sql,
    org: string,
    project: string,
    application: string,
    dossier: string,
    owner: string,
  ) {
    const r = (
      await q.query(
        "SELECT snapshot_cipher,public_code FROM applications WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND dossier_id=$4 AND owner_user_id=$5 AND status='approved' AND synthetic=true FOR SHARE",
        [uuid(application), org, project, uuid(dossier), owner],
      )
    ).rows[0];
    if (!r)
      throw new ForbiddenException(
        'Cần hồ sơ giả lập đã được người có quyền phê duyệt đúng dự án và chủ sở hữu',
      );
    const snapshot = record(
      JSON.parse(
        unseal(String(r.snapshot_cipher), 'application:' + uuid(org) + ':' + uuid(application)),
      ),
    );
    if (snapshot.mode !== 'buy')
      throw new BadRequestException(
        'Bảng giá này chỉ áp dụng mô hình mua; thuê/thuê mua cần phương án và quy tắc riêng đã rà soát',
      );
    return r;
  }
  async allocate(c: Citizen, id: string, body: unknown, expected: number) {
    id = uuid(id);
    const b = parse(AllocateUnitSchema, body),
      requestHash = hash({ project: id, user: c.userId, unit: b.unitCode ?? null });
    return this.db.tx(async (q) => {
      await new PrivacyService(this.db).assertProcessing(c, q);
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'inventory-idempotency:' + c.organizationId + ':' + b.idempotencyKey,
      ]);
      if ((await this.project(q, c.organizationId, id)).publication_status !== 'published')
        throw new NotFoundException('Dự án chưa công bố');
      const sales = await this.sales(q, c.organizationId, id);
      const me = (
        await q.query(
          'SELECT * FROM identity_private.inventory_queue WHERE organization_id=$1 AND project_id=$2 AND user_id=$3 FOR UPDATE',
          [c.organizationId, id, c.userId],
        )
      ).rows[0];
      if (!me || me.status !== 'active')
        throw new ForbiddenException(
          'Danh sách đã bị thu hồi hoặc bạn chưa được cấp quyền diễn tập',
        );
      await this.approvedApplication(
        q,
        c.organizationId,
        id,
        String(me.application_id),
        String(me.dossier_id),
        c.userId,
      );
      const prior = (
        await q.query(
          'SELECT id,quote,request_hash FROM inventory_allocations WHERE organization_id=$1 AND idempotency_key=$2',
          [c.organizationId, b.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== requestHash)
          throw new ConflictException('Khóa chống lặp đã dùng với nội dung khác');
        return { id: prior.id, quote: prior.quote, replayed: true };
      }
      if (!sales || sales.status !== 'active' || Number(sales.version) !== expected)
        throw new ConflictException('Đợt chọn căn tạm dừng hoặc phiên bản đã thay đổi');
      await this.publishedLottery(
        q,
        c.organizationId,
        id,
        String(sales.lottery_id),
        String(sales.mode),
      );
      if (
        (await q.query('SELECT id FROM inventory_allocations WHERE queue_id=$1', [me.id])).rows
          .length
      )
        throw new ConflictException('Mỗi khách chỉ được phân một căn');
      const chosen = sales.mode === 'published-random' ? String(me.assigned_unit) : b.unitCode;
      if (sales.mode === 'queue-choice' && (await this.next(q, c.organizationId, id))?.id !== me.id)
        throw new ConflictException('Chưa đến lượt theo thứ tự đã công bố');
      if (sales.mode === 'published-random' && b.unitCode && b.unitCode !== chosen)
        throw new BadRequestException('Không được đổi căn do kết quả ngẫu nhiên đã công bố');
      if (!chosen) throw new BadRequestException('Cần chọn căn còn lại');
      const u = (
        await q.query(
          'SELECT * FROM inventory_units WHERE organization_id=$1 AND project_id=$2 AND code=$3 FOR UPDATE',
          [c.organizationId, id, chosen],
        )
      ).rows[0];
      if (!u) throw new NotFoundException('Không có căn trong bảng hàng');
      if (
        (await q.query('SELECT id FROM inventory_allocations WHERE unit_id=$1', [u.id])).rows.length
      )
        throw new ConflictException('Căn đã được phân; tải lại bảng hàng');
      const plan = (
        await q.query(
          "SELECT * FROM inventory_price_plans WHERE id=$1 AND organization_id=$2 AND project_id=$3 AND status='approved'",
          [sales.price_plan_id, c.organizationId, id],
        )
      ).rows[0];
      if (!plan) throw new ConflictException('Thiếu giá đã duyệt');
      const quote = (plan.quotes as PriceQuote[]).find((x) => x.code === chosen);
      if (!quote) throw new ConflictException('Không có giá trong phiên bản được duyệt');
      const allocationId = randomUUID(),
        snapshot = {
          ...quote,
          planId: plan.id,
          planHash: plan.snapshot_hash,
          planTitle: plan.title,
          algorithm: 'area-weighted-per-building-v1',
          synthetic: true,
        };
      await q.query(
        'INSERT INTO inventory_allocations(id,organization_id,project_id,unit_id,queue_id,idempotency_key,request_hash,price_plan_id,quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          allocationId,
          c.organizationId,
          id,
          u.id,
          me.id,
          b.idempotencyKey,
          requestHash,
          plan.id,
          JSON.stringify(snapshot),
        ],
      );
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'inventory.unit.allocated',
        allocationId,
      );
      return { id: allocationId, quote: snapshot, replayed: false };
    });
  }
}
