'use client';
import { useEffect, useState } from 'react';
import { Button } from '@noxh/ui';
import { calculateInventoryPrices, type InventoryUnit, type PriceQuote } from '@noxh/contracts';
interface Plan {
  id: string;
  title: string;
  status: string;
  version: number;
  snapshot_hash: string;
  quotes: PriceQuote[];
  config: { basis: string; baseVndPerM2: string };
  created_by: string;
  reviewed_by: string | null;
  review_note: string | null;
}
interface Sales {
  mode: string;
  status: string;
  version: number;
  activated_at: string | null;
  lottery_id: string;
  price_plan_id: string;
  config: { rules: string };
}
interface Queue {
  id: string;
  public_code: string;
  rank: number;
  status: string;
  version: number;
  allocated_unit: string | null;
  assigned_unit: string | null;
}
interface Board {
  boardVersion: number;
  units: (InventoryUnit & { allocated: boolean })[];
  plans: Plan[];
  sales: Sales | null;
  queue: Queue[];
}
export const money = (v: string) => BigInt(v).toLocaleString('vi-VN') + ' đ';
const salesModes: Record<string, string> = {
  disabled: 'Chưa mở chọn căn',
  'queue-choice': 'Chọn căn theo thứ tự',
  'published-random': 'Phân căn theo kết quả ngẫu nhiên',
};
const salesStates: Record<string, string> = {
  draft: 'Chờ rà soát',
  approved: 'Đã duyệt quy chế',
  active: 'Đang mở',
  paused: 'Tạm dừng',
};
async function api(project: string, suffix = '', method = 'GET', body?: unknown, version?: number) {
  const r = await fetch('/api/admin/inventory/projects/' + project + suffix, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail ?? 'Không thực hiện được');
  return b;
}
const sample =
  'A-101,A,1,1,60.00,2 phòng ngủ,Đông Nam,1000\nA-102,A,1,2,65.50,2 phòng ngủ,Tây Bắc,1050\nA-201,A,2,1,60.00,2 phòng ngủ,Đông Nam,1020\nA-202,A,2,2,65.50,2 phòng ngủ,Tây Bắc,1070';
function csv(source: string): InventoryUnit[] {
  return source
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map((line) => {
      const v = line.split(',').map((s) => s.trim());
      if (v.length !== 8 || !/^\d+(\.\d{1,2})?$/.test(v[4]!))
        throw new Error(
          'Mỗi dòng 8 cột; diện tích m² tối đa hai chữ số thập phân, không dùng dấu phẩy trong tên',
        );
      const [whole, fraction = ''] = v[4]!.split('.');
      return {
        code: v[0]!,
        building: v[1]!,
        floor: Number(v[2]),
        position: Number(v[3]),
        areaCm2: Number(whole) * 10000 + Number(fraction.padEnd(2, '0')) * 100,
        type: v[5]!,
        orientation: v[6]!,
        weight: Number(v[7]),
      };
    });
}
export default function InventoryAdmin({
  projects,
  staff,
}: {
  projects: { id: string; name: string }[];
  staff?: { role: string; permissions?: string[] };
}) {
  const canManage = !staff || staff.role === 'org_admin',
    canReview = !staff || Boolean(staff.permissions?.includes('price_approver'));
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [board, setBoard] = useState<Board>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<PriceQuote[]>();
  const load = async () => {
    if (project) setBoard(await api(project));
  };
  useEffect(() => {
    let live = true;
    if (project)
      api(project)
        .then((b) => {
          if (live) setBoard(b);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [project]);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      await load();
      setMessage('Đã lưu và ghi nhật ký.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xử lý được');
    } finally {
      setBusy(false);
    }
  }
  const groups = board ? [...new Set(board.units.map((u) => u.building))] : [];
  const activePlan =
    board?.plans.find((p) => p.id === board.sales?.price_plan_id) ??
    board?.plans.find((p) => p.status === 'approved');
  const quotes = new Map(activePlan?.quotes.map((q) => [q.code, q]) ?? []);
  return (
    <div className="stack inventory-workspace">
      <p className="workspace-lead">
        Quản lý căn hộ, phương án giá và thứ tự phân căn theo quy chế đã duyệt.
      </p>
      <div className="workspace-notice">
        <span className="status-badge">Dữ liệu diễn tập</span>
        <span>Chỉ áp dụng dự án giả lập; không giữ chỗ, thu tiền hoặc ký hợp đồng.</span>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      <div className="workspace-toolbar">
        <label>
          Dự án
          <select
            className="search-input"
            disabled={busy}
            value={project}
            onChange={(e) => {
              setProject(e.target.value);
              setBoard(undefined);
              setError('');
              setPreview(undefined);
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" disabled={busy || !project} onClick={() => run(load)}>
          Tải lại bảng hàng
        </Button>
      </div>
      {!board ? (
        <p>{project ? 'Đang tải bảng hàng…' : 'Chưa có dự án được cấp quyền.'}</p>
      ) : (
        <>
          <ol className="workspace-step-strip" aria-label="Quy trình mở chọn căn">
            {[
              { label: 'Bảng căn hộ', done: board.units.length > 0 },
              { label: 'Duyệt phương án giá', done: Boolean(activePlan) },
              {
                label: 'Duyệt quy chế',
                done: Boolean(board.sales && board.sales.status !== 'draft'),
              },
              { label: 'Mở chọn căn', done: Boolean(board.sales?.activated_at) },
            ].map((step, i) => (
              <li key={step.label} data-complete={step.done}>
                <span>{step.done ? '✓' : i + 1}</span>
                <div>
                  <strong>{step.label}</strong>
                  <small>{step.done ? 'Đã ghi nhận' : 'Chưa hoàn tất'}</small>
                </div>
              </li>
            ))}
          </ol>
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>Bảng căn hộ</h2>
                <p className="section-subtitle">Sơ đồ theo tòa, tầng và vị trí đã khai báo</p>
              </div>
              <span className="status-badge">Phiên bản {board.boardVersion}</span>
            </div>
            <div className="surface-body stack">
              <div className="metric-grid">
                <div className="metric">
                  <span>Tổng căn</span>
                  <strong>{board.units.length}</strong>
                </div>
                <div className="metric">
                  <span>Đã phân diễn tập</span>
                  <strong>{board.units.filter((u) => u.allocated).length}</strong>
                </div>
                <div className="metric">
                  <span>Chưa phân căn</span>
                  <strong>{board.units.filter((u) => !u.allocated).length}</strong>
                </div>
              </div>
              <div className="workspace-board-caption">
                <p>
                  {activePlan
                    ? `Giá tham chiếu: ${activePlan.title}`
                    : 'Chưa có phương án giá được duyệt.'}
                </p>
                <span>Sơ đồ khai báo · {groups.length} tòa · Không thay bản vẽ kỹ thuật</span>
              </div>
              {groups.map((building) => (
                <div key={building} className="inventory-building">
                  <h3>Tòa {building}</h3>
                  {[
                    ...new Set(
                      board.units.filter((u) => u.building === building).map((u) => u.floor),
                    ),
                  ]
                    .sort((a, b) => b - a)
                    .map((floor) => (
                      <div key={floor} className="inventory-floor-row">
                        <strong>Tầng {floor}</strong>
                        <div className="inventory-unit-grid">
                          {board.units
                            .filter((u) => u.building === building && u.floor === floor)
                            .sort((a, b) => a.position - b.position)
                            .map((u) => (
                              <article
                                key={u.code}
                                className="inventory-unit"
                                data-state={u.allocated ? 'allocated' : 'available'}
                              >
                                <strong>{u.code}</strong>
                                <p>
                                  {(u.areaCm2 / 10000).toLocaleString('vi-VN')} m² · {u.orientation}
                                </p>
                                <small>
                                  {u.type} · {u.allocated ? 'Đã phân căn' : 'Chưa phân căn'}
                                </small>
                                {quotes.get(u.code) && (
                                  <div className="inventory-unit-price">
                                    {money(quotes.get(u.code)!.totalVnd)}
                                  </div>
                                )}
                              </article>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              ))}
              {!board.plans.length && canManage && (
                <details className="workspace-disclosure">
                  <summary>Nhập hoặc cập nhật bảng căn hộ</summary>
                  <div className="workspace-disclosure-body">
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            project,
                            '/units',
                            'PUT',
                            { units: csv(String(f.get('csv'))), synthetic: true },
                            board.boardVersion,
                          ),
                        );
                      }}
                    >
                      <label>
                        Nhập bảng CSV (mã căn, tòa, tầng, vị trí, m², loại, hướng, trọng số)
                        <textarea
                          name="csv"
                          className="search-input"
                          rows={7}
                          required
                          defaultValue={sample}
                        />
                      </label>
                      <p>
                        Trọng số là tỷ lệ tương đối do dự án đề xuất. Hệ thống chuẩn hóa riêng từng
                        tòa để bình quân gia quyền theo diện tích bằng 1. Bảng hàng khóa sau khi lập
                        phương án giá đầu tiên để giữ chứng cứ.
                      </p>
                      <Button disabled={busy}>Lưu bảng hàng giả lập</Button>
                    </form>
                  </div>
                </details>
              )}
            </div>
          </section>
          <section className="surface">
            <div className="surface-head">
              <h2 id="phuong-an-gia">Phương án giá</h2>
              <a
                href="https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/24-vbhn-bxd.pdf"
                target="_blank"
                rel="noopener noreferrer"
              >
                Điều 32, 35 VBHN 24/BXD ↗
              </a>
            </div>
            <div className="surface-body stack">
              <div className="workspace-state-group">
                <span className="status-badge">{board.plans.length} phiên bản</span>
                <span className="status-badge green">
                  {board.plans.filter((p) => p.status === 'approved').length} đã duyệt nội bộ
                </span>
                <span className="status-badge">
                  {board.plans.filter((p) => p.status === 'draft').length} chờ duyệt
                </span>
              </div>
              <details className="workspace-disclosure">
                <summary>Nguyên tắc tính giá và căn cứ áp dụng</summary>
                <div className="workspace-disclosure-body">
                  <p>
                    Giá bình quân đã gồm thuế GTGT, chưa gồm kinh phí bảo trì. Hệ số được chuẩn hóa
                    theo diện tích riêng từng tòa để bình quân gia quyền bằng 1.
                  </p>
                  <p>
                    Phương án cần căn cứ và người kiểm tra độc lập. Công cụ áp dụng mô hình giá bán
                    theo Điều 32, không suy ra giá thuê, thuê mua, trần giá hoặc mức phí được phép
                    thu.
                  </p>
                </div>
              </details>
              {board.units.length > 0 && !board.sales?.activated_at && canManage && (
                <details className="workspace-disclosure">
                  <summary>Lập phương án giá mới</summary>
                  <div className="workspace-disclosure-body">
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            project,
                            '/price-plans',
                            'POST',
                            {
                              title: f.get('title'),
                              baseVndPerM2: f.get('base'),
                              basis: f.get('basis'),
                              evidenceHash: f.get('hash'),
                              effectiveFrom: new Date(String(f.get('effective'))).toISOString(),
                              rounding: 'half-up-vnd',
                              taxIncluded: true,
                              maintenanceExcluded: true,
                              synthetic: true,
                            },
                            board.boardVersion,
                          ),
                        );
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          Tên phương án
                          <input
                            name="title"
                            className="search-input"
                            minLength={5}
                            maxLength={150}
                            required
                          />
                        </label>
                        <label>
                          Giá bình quân đã gồm GTGT (đồng/m²)
                          <input
                            name="base"
                            className="search-input"
                            inputMode="numeric"
                            pattern="[1-9][0-9]{0,10}"
                            required
                            onInput={(e) => {
                              try {
                                setPreview(
                                  calculateInventoryPrices(board.units, e.currentTarget.value),
                                );
                              } catch {
                                setPreview(undefined);
                              }
                            }}
                          />
                        </label>
                        <label>
                          Hiệu lực từ
                          <input
                            type="datetime-local"
                            name="effective"
                            className="search-input"
                            required
                          />
                        </label>
                        <label>
                          SHA-256 tài liệu căn cứ giá
                          <input
                            name="hash"
                            className="search-input"
                            pattern="[a-f0-9]{64}"
                            required
                          />
                        </label>
                      </div>
                      <label>
                        Căn cứ dự án, thẩm định hoặc trường hợp áp dụng và nội dung giá
                        <textarea
                          name="basis"
                          className="search-input"
                          rows={4}
                          minLength={20}
                          maxLength={2000}
                          required
                        />
                      </label>
                      <p>
                        Làm tròn tổng giá từng căn đến đồng gần nhất; phần đúng nửa đồng làm tròn
                        lên. Phân số hệ số và đơn giá được lưu nguyên vẹn; sai số làm tròn thể hiện
                        khi đối soát.
                      </p>
                      {preview && (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th scope="col">Căn</th>
                                <th scope="col">Hệ số (xấp xỉ)</th>
                                <th scope="col">Tổng giá dự kiến</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.map((q) => (
                                <tr key={q.code}>
                                  <td>{q.code}</td>
                                  <td>
                                    {(
                                      Number(q.coefficientNumerator) /
                                      Number(q.coefficientDenominator)
                                    ).toFixed(6)}
                                  </td>
                                  <td>{money(q.totalVnd)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <Button disabled={busy}>Lập phiên bản chờ người độc lập duyệt</Button>
                    </form>
                  </div>
                </details>
              )}
              {board.plans.map((p) => (
                <details key={p.id} className="workspace-disclosure price-plan-card">
                  <summary>
                    <span>
                      <strong>{p.title}</strong>
                      <small>
                        {p.status === 'approved'
                          ? 'Đã duyệt nội bộ'
                          : p.status === 'rejected'
                            ? 'Từ chối'
                            : 'Chờ duyệt'}{' '}
                        · Phiên bản {p.version} · {p.quotes.length} căn hộ
                      </small>
                    </span>
                  </summary>
                  <p>{p.config.basis}</p>
                  <p>Giá nền: {money(p.config.baseVndPerM2)}/m²</p>
                  <details>
                    <summary>Kiểm tra mã toàn vẹn phương án</summary>
                    <p className="workspace-code">SHA-256: {p.snapshot_hash}</p>
                  </details>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Căn</th>
                          <th scope="col">Diện tích</th>
                          <th scope="col">Hệ số chính xác</th>
                          <th scope="col">Tổng giá</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.quotes.map((q) => (
                          <tr key={q.code}>
                            <td>{q.code}</td>
                            <td>{q.areaCm2 / 10000} m²</td>
                            <td>
                              {q.coefficientNumerator}/{q.coefficientDenominator}
                            </td>
                            <td>{money(q.totalVnd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {p.status === 'draft' && canReview ? (
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            project,
                            '/price-plans/' + p.id + '/review',
                            'POST',
                            { accepted: true, decision: f.get('decision'), note: f.get('note') },
                            p.version,
                          ),
                        );
                      }}
                    >
                      <label>
                        Quyết định
                        <select name="decision" className="search-input">
                          <option value="approved">Duyệt nội bộ</option>
                          <option value="rejected">Từ chối</option>
                        </select>
                      </label>
                      <label>
                        Nhận xét kiểm tra
                        <textarea name="note" className="search-input" required maxLength={2000} />
                      </label>
                      <label className="checkbox-label">
                        <input type="checkbox" required />
                        Tôi được giao quyền duyệt giá, đã kiểm tra căn cứ và không là người lập.
                      </label>
                      <Button disabled={busy}>Ghi quyết định</Button>
                    </form>
                  ) : (
                    <p>
                      {p.status === 'draft'
                        ? 'Chờ người có quyền rà soát giá kiểm tra và ghi quyết định.'
                        : `Người duyệt: ${p.reviewed_by} · ${p.review_note ?? ''}`}
                    </p>
                  )}
                </details>
              ))}
            </div>
          </section>
          <section className="surface">
            <div className="surface-head">
              <h2>Quy chế chọn căn minh bạch</h2>
            </div>
            <div className="surface-body stack">
              <details className="workspace-disclosure">
                <summary>Điều kiện mở và nguyên tắc chọn căn</summary>
                <div className="workspace-disclosure-body">
                  <p>
                    Chọn theo lượt: chỉ hồ sơ có thứ tự nhỏ nhất còn hiệu lực được chọn căn. Phân
                    ngẫu nhiên: dùng đúng căn đã gán trong kết quả công bố, không quay lại khi xác
                    nhận.
                  </p>
                  <p>
                    Giá, danh sách và quy chế phải được kiểm tra trước khi mở. Phương thức khóa sau
                    lần kích hoạt đầu tiên; chỉ được tạm dừng hoặc tiếp tục. Không có giữ chỗ hay tự
                    hết hạn ngầm.
                  </p>
                </div>
              </details>
              {!board.sales?.activated_at && !board.queue.length && canManage && (
                <details className="workspace-disclosure">
                  <summary>Thiết lập phương thức và quy chế</summary>
                  <div className="workspace-disclosure-body">
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          api(
                            project,
                            '/sales',
                            'PUT',
                            {
                              pricePlanId: f.get('price'),
                              mode: f.get('mode'),
                              lotteryId: f.get('lottery') || null,
                              rules: f.get('rules'),
                              basis: f.get('basis'),
                              rulesHash: f.get('hash'),
                              synthetic: true,
                            },
                            board.sales?.version ?? 0,
                          ),
                        );
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          Phương án giá đã duyệt
                          <select name="price" className="search-input" required>
                            <option value="">Chọn phương án</option>
                            {board.plans
                              .filter((p) => p.status === 'approved')
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Cách phân căn
                          <select name="mode" className="search-input">
                            <option value="disabled">Tắt</option>
                            <option value="queue-choice">
                              Chọn căn theo thứ tự kết quả công bố
                            </option>
                            <option value="published-random">
                              Căn ngẫu nhiên từ kết quả công bố
                            </option>
                          </select>
                        </label>
                        <label>
                          Mã phiên bốc thăm đã công bố
                          <input
                            name="lottery"
                            className="search-input"
                            placeholder="Mã định danh của phiên"
                          />
                        </label>
                        <label>
                          SHA-256 biên bản quy chế đã kiểm tra
                          <input
                            name="hash"
                            className="search-input"
                            pattern="[a-f0-9]{64}"
                            required
                          />
                        </label>
                      </div>
                      <label>
                        Quy chế lượt, vắng mặt, thu hồi và giải quyết tranh chấp
                        <textarea
                          name="rules"
                          className="search-input"
                          minLength={30}
                          maxLength={4000}
                          required
                        />
                      </label>
                      <label>
                        Căn cứ áp dụng
                        <textarea
                          name="basis"
                          className="search-input"
                          minLength={20}
                          maxLength={2000}
                          required
                        />
                      </label>
                      <Button disabled={busy}>Lưu quy chế chờ duyệt độc lập</Button>
                    </form>
                  </div>
                </details>
              )}
              {board.sales && (
                <>
                  <div className="workspace-state-group">
                    <strong>{salesModes[board.sales.mode] ?? 'Cần rà soát phương thức'}</strong>
                    <span className="status-badge">
                      {salesStates[board.sales.status] ?? 'Cần rà soát'}
                    </span>
                    <small>Phiên bản {board.sales.version}</small>
                  </div>
                  <details className="workspace-disclosure">
                    <summary>Quy chế đã lưu</summary>
                    <div className="workspace-disclosure-body">
                      <p>{board.sales.config.rules}</p>
                    </div>
                  </details>
                  <div className="action-row">
                    {(board.sales.status === 'draft'
                      ? ['review']
                      : board.sales.status === 'approved' || board.sales.status === 'paused'
                        ? ['activate']
                        : board.sales.status === 'active'
                          ? ['pause']
                          : []
                    )
                      .filter((action) => (action === 'review' ? canReview : canManage))
                      .map((action) => (
                        <Button
                          key={action}
                          disabled={busy}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Xác nhận ' +
                                  (
                                    {
                                      review: 'duyệt quy chế bằng người độc lập',
                                      activate: 'mở diễn tập theo quy chế đã khóa',
                                      pause: 'tạm dừng chọn căn',
                                    } as Record<string, string>
                                  )[action] +
                                  '?',
                              )
                            )
                              void run(() =>
                                api(
                                  project,
                                  '/sales/' + action,
                                  'POST',
                                  { accepted: true },
                                  board.sales!.version,
                                ),
                              );
                          }}
                        >
                          {
                            (
                              {
                                review: 'Duyệt quy chế',
                                activate: 'Mở diễn tập',
                                pause: 'Tạm dừng',
                              } as Record<string, string>
                            )[action]
                          }
                        </Button>
                      ))}
                  </div>
                  {!board.sales.activated_at && canManage && (
                    <details className="workspace-disclosure">
                      <summary>Thêm hồ sơ vào danh sách chọn căn</summary>
                      <div className="workspace-disclosure-body">
                        <form
                          className="stack"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(() =>
                              api(
                                project,
                                '/queue',
                                'POST',
                                {
                                  code: f.get('code'),
                                  dossierId: f.get('dossier'),
                                  applicationId: f.get('application'),
                                  synthetic: true,
                                },
                                board.sales!.version,
                              ),
                            );
                          }}
                        >
                          <h3>Xác nhận liên kết hồ sơ</h3>
                          <p>
                            Hệ thống chỉ nhận mã được chọn trong phiên công bố và hồ sơ mua đã được
                            phê duyệt đúng dự án/chủ sở hữu. Mã công khai không cho phép khách tự
                            nhận quyền của người khác. Chưa sử dụng giấy tờ hoặc quyết định thật.
                          </p>
                          <div className="form-grid">
                            <label>
                              Mã hồ sơ DEMO
                              <input
                                name="code"
                                className="search-input"
                                pattern="DEMO-[A-Z0-9-]{4,32}"
                                required
                              />
                            </label>
                            <label>
                              Mã hồ sơ chuẩn bị
                              <input name="dossier" className="search-input" required />
                            </label>
                            <label>
                              Mã đơn mua đã được phê duyệt
                              <input name="application" className="search-input" required />
                            </label>
                          </div>
                          <Button disabled={busy}>Gắn mã và lấy thứ tự từ kết quả công bố</Button>
                        </form>
                      </div>
                    </details>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Mã hồ sơ</th>
                          <th scope="col">Thứ tự</th>
                          <th scope="col">Căn</th>
                          <th scope="col">Trạng thái</th>
                          <th scope="col">Rà soát lượt</th>
                        </tr>
                      </thead>
                      <tbody>
                        {board.queue.map((q) => (
                          <tr key={q.id}>
                            <td>{q.public_code}</td>
                            <td>{q.rank}</td>
                            <td>{q.allocated_unit ?? q.assigned_unit ?? 'Chờ chọn'}</td>
                            <td>
                              {q.status === 'revoked'
                                ? 'Đã thu hồi'
                                : q.allocated_unit
                                  ? 'Đã phân căn'
                                  : 'Chờ diễn tập'}
                            </td>
                            <td>
                              {q.status === 'active' && !q.allocated_unit && canReview && (
                                <details>
                                  <summary>Thu hồi có căn cứ</summary>
                                  <form
                                    className="stack"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const f = new FormData(e.currentTarget);
                                      void run(() =>
                                        api(
                                          project,
                                          '/queue/' + q.id + '/revoke',
                                          'POST',
                                          { accepted: true, reason: f.get('reason') },
                                          q.version,
                                        ),
                                      );
                                    }}
                                  >
                                    <label>
                                      Lý do, căn cứ rà soát
                                      <textarea
                                        name="reason"
                                        className="search-input"
                                        required
                                        minLength={20}
                                        maxLength={2000}
                                      />
                                    </label>
                                    <label className="checkbox-label">
                                      <input type="checkbox" required />
                                      Tôi có quyền duyệt và không là người gắn lượt này.
                                    </label>
                                    <Button variant="outline" disabled={busy}>
                                      Thu hồi và giữ chứng cứ
                                    </Button>
                                  </form>
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!board.queue.length && (
                    <p className="workspace-empty">
                      Chưa có hồ sơ trong danh sách chọn căn. Cần liên kết đủ các mã được chọn trong
                      kết quả công bố trước khi mở.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
