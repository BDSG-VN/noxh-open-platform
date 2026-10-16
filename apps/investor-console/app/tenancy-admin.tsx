'use client';
import { useEffect, useState, useRef } from 'react';
import type { TenancyView } from '@noxh/contracts';
import { Button } from '@noxh/ui';
const modes = { buy: 'Mua', rent: 'Thuê', 'rent-buy': 'Thuê mua' };
const states: Record<string, string> = {
  draft: 'Chờ duyệt dự thảo',
  approved: 'Chờ khách kiểm tra',
  rejected: 'Đã từ chối',
  acknowledged_demo: 'Khách đã xác nhận bản diễn tập',
  handed_over_demo: 'Đã bàn giao diễn tập',
  terminated_demo: 'Đã chấm dứt — còn giữ căn',
  released_demo: 'Đã trả và giải phóng căn',
  pending: 'Chờ đối soát',
  reconciled_demo: 'Đã đối soát diễn tập',
};
const actions: Record<string, string> = {
  handover: 'Bàn giao',
  extend: 'Gia hạn',
  terminate: 'Chấm dứt',
  return: 'Nhận lại căn',
};
const money = (v: string) => BigInt(v).toLocaleString('vi-VN') + ' đ';
type Installment = { dueOn: string; label: string; amountVnd: string };
async function call(project: string, path: string, body?: unknown, v?: number) {
  const r = await fetch('/api/admin/tenancy/projects/' + project + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(v === undefined ? {} : { 'If-Match': String(v) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.detail ?? 'Không thực hiện được');
  return b;
}
function Schedule({ items, set }: { items: Installment[]; set: (v: Installment[]) => void }) {
  return (
    <fieldset>
      <legend>Lịch nghĩa vụ đã thỏa thuận — số nguyên đồng</legend>
      {items.map((d, i) => (
        <div className="form-grid" key={i}>
          <label>
            Ngày đến hạn
            <input
              type="date"
              required
              value={d.dueOn}
              onChange={(e) =>
                set(items.map((a, n) => (n === i ? { ...a, dueOn: e.target.value } : a)))
              }
            />
          </label>
          <label>
            Nội dung kỳ thu
            <input
              required
              value={d.label}
              onChange={(e) =>
                set(items.map((a, n) => (n === i ? { ...a, label: e.target.value } : a)))
              }
            />
          </label>
          <label>
            Số tiền (đồng)
            <input
              required
              inputMode="numeric"
              pattern="[0-9]+"
              value={d.amountVnd}
              onChange={(e) =>
                set(items.map((a, n) => (n === i ? { ...a, amountVnd: e.target.value } : a)))
              }
            />
          </label>
          {items.length > 1 && (
            <Button type="button" onClick={() => set(items.filter((_, n) => n !== i))}>
              Bỏ kỳ này
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        onClick={() => set([...items, { dueOn: '', label: '', amountVnd: '' }])}
      >
        Thêm kỳ thu
      </Button>
    </fieldset>
  );
}
export default function TenancyAdmin({
  projects,
  staff,
}: {
  projects: { id: string; name: string }[];
  staff?: { subject: string; permissions?: string[] };
}) {
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [list, setList] = useState<TenancyView[]>([]),
    [selected, setSelected] = useState(''),
    [options, setOptions] = useState<{
      applications: { id: string; public_code: string }[];
      units: { id: string; code: string; reserved: boolean }[];
    }>({ applications: [], units: [] }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(''),
    [schedule, setSchedule] = useState<Installment[]>([
      { dueOn: '2027-01-01', label: 'Kỳ thu đã thỏa thuận', amountVnd: '' },
    ]),
    [extension, setExtension] = useState<Installment[]>([
      { dueOn: '', label: 'Kỳ gia hạn', amountVnd: '' },
    ]);
  const [actionKind, setActionKind] = useState('handover');
  const attempts = useRef(new Map<string, string>());
  const loadSequence = useRef(0);
  const c = list.find((i) => i.id === selected);
  async function load() {
    if (!project) return;
    const sequence = ++loadSequence.current;
    const [b, o] = await Promise.all([call(project, '/contracts'), call(project, '/options')]);
    if (sequence !== loadSequence.current) return;
    setList(b.items);
    setOptions(o);
  }
  useEffect(() => {
    loadSequence.current++;
    setSelected('');
    setList([]);
    setOptions({ applications: [], units: [] });
    setError('');
    load().catch((e) => setError(e.message));
    return () => {
      loadSequence.current++;
    };
  }, [project]);
  async function write(path: string, body: unknown, v?: number) {
    let retryKey = '';
    if (body && typeof body === 'object' && 'idempotencyKey' in body) {
      const rest = { ...body } as Record<string, unknown>;
      delete rest.idempotencyKey;
      retryKey = path + ':' + String(v) + ':' + JSON.stringify(rest);
      const key = attempts.current.get(retryKey) ?? crypto.randomUUID();
      attempts.current.set(retryKey, key);
      body = { ...rest, idempotencyKey: key };
    }
    setBusy(true);
    setError('');
    try {
      const result = await call(project, path, body, v);
      await load();
      if (retryKey) attempts.current.delete(retryKey);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const review = (path: string, v: number, decision = 'approve') => {
    if (note.trim().length < 20) {
      setError('Cần ghi ít nhất 20 ký tự giải trình rà soát.');
      return;
    }
    void write(path, { decision, accepted: true, note }, v);
  };
  return (
    <section className="surface completion-panel">
      <div className="surface-head">
        <div>
          <h2>Hợp đồng, nghĩa vụ thu và bàn giao</h2>
          <p>
            Diễn tập ba hình thức. Xác nhận trên nền tảng không thay chữ ký, chứng từ ngân hàng hoặc
            kế toán pháp định.
          </p>
        </div>
        <label>
          Dự án
          <select value={project} disabled={busy} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="surface-body">
        {error && <p role="alert">{error}</p>}
        <p>
          {list.length} hợp đồng diễn tập · {list.filter((x) => x.status === 'draft').length} chờ
          duyệt · {list.filter((x) => x.status === 'handed_over_demo').length} đã bàn giao diễn tập
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mã hồ sơ</th>
                <th>Căn</th>
                <th>Hình thức</th>
                <th>Trạng thái</th>
                <th>Tổng lịch thu</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {list.map((x) => (
                <tr key={x.id}>
                  <td>{x.applicationCode}</td>
                  <td>{x.unitCode}</td>
                  <td>{modes[x.mode]}</td>
                  <td>{states[x.status]}</td>
                  <td>{money(x.totalVnd)}</td>
                  <td>
                    <Button onClick={() => setSelected(x.id)}>Mở</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <p>Chưa có dự thảo. Cần hồ sơ diễn tập đã duyệt và căn hợp lệ trước khi lập.</p>
        )}
        <details>
          <summary>Lập dự thảo mới</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const b = await write('/contracts', {
                applicationId: f.get('applicationId'),
                unitId: f.get('unitId'),
                mode: f.get('mode'),
                title: f.get('title'),
                startsOn: f.get('startsOn'),
                endsOn: f.get('endsOn'),
                terms: f.get('terms'),
                basis: f.get('basis'),
                evidenceHash: f.get('evidenceHash'),
                handoverRequiredVnd: f.get('handoverRequiredVnd'),
                schedule,
                synthetic: true,
                idempotencyKey: crypto.randomUUID(),
              });
              if (b) setSelected(b.id);
            }}
          >
            <div className="form-grid">
              <label>
                Hồ sơ đã duyệt
                <select name="applicationId" required>
                  <option value="">Chọn hồ sơ</option>
                  {options.applications.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.public_code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Căn thuộc dự án
                <select name="unitId" required>
                  <option value="">Chọn căn</option>
                  {options.units
                    .filter((u) => !u.reserved)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Hình thức
                <select name="mode">
                  {Object.entries(modes).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tên dự thảo
                <input name="title" required defaultValue="Dự thảo hợp đồng DIỄN TẬP" />
              </label>
              <label>
                Bắt đầu
                <input name="startsOn" type="date" required />
              </label>
              <label>
                Kết thúc
                <input name="endsOn" type="date" required />
              </label>
              <label>
                Nghĩa vụ cần đối soát trước bàn giao (đồng)
                <input
                  name="handoverRequiredVnd"
                  inputMode="numeric"
                  pattern="[0-9]+"
                  required
                  defaultValue="0"
                />
              </label>
              <label>
                Mã kiểm tra chứng cứ (SHA-256)
                <input
                  name="evidenceHash"
                  minLength={64}
                  maxLength={64}
                  pattern="[a-f0-9]{64}"
                  required
                />
              </label>
            </div>
            <label>
              Điều khoản dự thảo
              <textarea name="terms" required minLength={30} />
            </label>
            <label>
              Căn cứ và phạm vi áp dụng
              <textarea name="basis" required minLength={20} />
            </label>
            <Schedule items={schedule} set={setSchedule} />
            <p>
              Không có lãi, thuế hay phí mặc định. Nhập nghĩa vụ theo phương án đã được rà soát. Căn
              mua phải có phân căn đúng hồ sơ.
            </p>
            <Button disabled={busy}>Lưu dự thảo</Button>
          </form>
        </details>
        {c && (
          <article>
            <h3>
              {c.title} · {c.unitCode}
            </h3>
            <p>
              {states[c.status]} · Phiên bản {c.version} · {c.startsOn} – {c.endsOn}
            </p>
            <p>
              Tổng nghĩa vụ: {money(c.totalVnd)} · Ngưỡng bàn giao: {money(c.handoverRequiredVnd)}
            </p>
            <details>
              <summary>Điều khoản, căn cứ và chứng cứ</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{c.terms}</p>
              <p>{c.basis}</p>
              <p>Mã kiểm tra: {c.evidenceHash}</p>
              <p>Phiên bản chứng cứ hợp đồng: {c.snapshotHash}</p>
              <p>
                Người lập: {c.createdBy} · Người duyệt: {c.reviewedBy ?? 'Chưa duyệt'}
              </p>
            </details>
            <label>
              Giải trình khi duyệt hoặc từ chối
              <textarea value={note} minLength={20} onChange={(e) => setNote(e.target.value)} />
            </label>
            {c.status === 'draft' && (
              <div>
                <Button
                  disabled={busy || staff?.subject === c.createdBy}
                  onClick={() => review('/contracts/' + c.id + '/review', c.version)}
                >
                  Duyệt dự thảo độc lập
                </Button>
                <Button
                  disabled={busy || staff?.subject === c.createdBy}
                  onClick={() => review('/contracts/' + c.id + '/review', c.version, 'reject')}
                >
                  Từ chối dự thảo
                </Button>
                <p>
                  Yêu cầu quyền rà soát pháp lý; người lập không tự duyệt. Khách kiểm tra sau khi
                  duyệt.
                </p>
              </div>
            )}
            <h4>Lịch phải thu</h4>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kỳ</th>
                    <th>Đến hạn</th>
                    <th>Nghĩa vụ</th>
                    <th>Đã đối soát diễn tập</th>
                    <th>Đang chờ</th>
                  </tr>
                </thead>
                <tbody>
                  {c.dues.map((d) => (
                    <tr key={d.id}>
                      <td>{d.label}</td>
                      <td>{d.dueOn}</td>
                      <td>{money(d.amountVnd)}</td>
                      <td>{money(d.reconciledVnd)}</td>
                      <td>{money(d.pendingVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {['acknowledged_demo', 'handed_over_demo'].includes(c.status) && (
              <details>
                <summary>Ghi nhận khoản thu diễn tập</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void write(
                      '/contracts/' + c.id + '/payments',
                      {
                        dueId: f.get('dueId'),
                        amountVnd: f.get('amountVnd'),
                        reference: f.get('reference'),
                        evidenceHash: f.get('evidenceHash'),
                        synthetic: true,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      c.version,
                    );
                  }}
                >
                  <label>
                    Kỳ thu
                    <select name="dueId">
                      {c.dues.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.label} · {d.dueOn}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Số tiền nguyên đồng
                    <input name="amountVnd" required pattern="[0-9]+" inputMode="numeric" />
                  </label>
                  <label>
                    Tham chiếu chứng từ
                    <input name="reference" required minLength={5} />
                  </label>
                  <label>
                    Mã kiểm tra chứng cứ (SHA-256)
                    <input name="evidenceHash" required pattern="[a-f0-9]{64}" />
                  </label>
                  <Button disabled={busy}>Gửi đối soát độc lập</Button>
                </form>
              </details>
            )}
            {c.payments.map((p) => (
              <div key={p.id}>
                <p>
                  {p.reference} · {money(p.amountVnd)} · {states[p.status] ?? p.status} · Người lập{' '}
                  {p.createdBy}
                </p>
                {p.status === 'pending' && (
                  <>
                    <Button
                      disabled={busy || p.createdBy === staff?.subject}
                      onClick={() => review('/payments/' + p.id + '/review', p.version)}
                    >
                      Chấp nhận đối soát diễn tập
                    </Button>
                    <Button
                      disabled={busy || p.createdBy === staff?.subject}
                      onClick={() => review('/payments/' + p.id + '/review', p.version, 'reject')}
                    >
                      Từ chối khoản ghi nhận
                    </Button>
                  </>
                )}
              </div>
            ))}
            {['acknowledged_demo', 'handed_over_demo', 'terminated_demo'].includes(c.status) && (
              <details>
                <summary>Đề nghị bàn giao, gia hạn, chấm dứt hoặc nhận lại căn</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget),
                      kind = String(f.get('kind'));
                    void write(
                      '/contracts/' + c.id + '/actions',
                      {
                        kind,
                        reason: f.get('reason'),
                        evidenceHash: f.get('evidenceHash'),
                        ...(kind === 'extend'
                          ? { newEndsOn: f.get('newEndsOn'), schedule: extension }
                          : { schedule: [] }),
                        synthetic: true,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      c.version,
                    );
                  }}
                >
                  <label>
                    Nghiệp vụ
                    <select
                      name="kind"
                      value={actionKind}
                      onChange={(e) => setActionKind(e.target.value)}
                    >
                      {Object.entries(actions).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Lý do và chứng cứ
                    <textarea name="reason" minLength={20} required />
                  </label>
                  <label>
                    Mã kiểm tra chứng cứ (SHA-256)
                    <input name="evidenceHash" required pattern="[a-f0-9]{64}" />
                  </label>
                  {actionKind === 'extend' && (
                    <fieldset>
                      <legend>Lịch gia hạn tường minh</legend>
                      <label>
                        Ngày kết thúc mới
                        <input type="date" name="newEndsOn" required />
                      </label>
                      <Schedule items={extension} set={setExtension} />
                    </fieldset>
                  )}
                  <Button disabled={busy}>Gửi đề nghị để khách kiểm tra</Button>
                  <p>
                    Chấm dứt chưa giải phóng căn. Nhận lại cần quyết toán đầy đủ, khách xác nhận và
                    người duyệt khác người đề nghị. Không xóa phân căn mua.
                  </p>
                </form>
              </details>
            )}
            {c.actions.map((a) => (
              <div key={a.id}>
                <h4>
                  {actions[a.kind]} ·{' '}
                  {a.status === 'approved'
                    ? 'Đã duyệt'
                    : a.status === 'rejected'
                      ? 'Đã từ chối'
                      : 'Chờ xét duyệt'}
                </h4>
                <p>{a.reason}</p>
                <p>
                  {a.ownerConfirmed ? 'Khách đã xác nhận đề nghị diễn tập' : 'Chờ khách kiểm tra'} ·
                  Người đề nghị {a.createdBy}
                </p>
                {a.status === 'pending' && (
                  <>
                    <Button
                      disabled={busy || a.createdBy === staff?.subject}
                      onClick={() => review('/actions/' + a.id + '/review', a.version)}
                    >
                      Duyệt đề nghị độc lập
                    </Button>
                    <Button
                      disabled={busy || a.createdBy === staff?.subject}
                      onClick={() => review('/actions/' + a.id + '/review', a.version, 'reject')}
                    >
                      Từ chối đề nghị
                    </Button>
                  </>
                )}
              </div>
            ))}
          </article>
        )}
      </div>
    </section>
  );
}
