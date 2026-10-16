'use client';
import { useEffect, useState } from 'react';
import type { TenancyView } from '@noxh/contracts';
import { Button } from '@noxh/ui';
const states: Record<string, string> = {
  draft: 'Đang soạn dự thảo',
  approved: 'Cần bạn kiểm tra',
  rejected: 'Dự thảo không được duyệt',
  acknowledged_demo: 'Bạn đã xác nhận xem bản diễn tập',
  handed_over_demo: 'Bàn giao diễn tập đã được duyệt',
  terminated_demo: 'Đã chấm dứt diễn tập — chưa trả căn',
  released_demo: 'Đã trả căn diễn tập',
  pending: 'Chờ rà soát',
  reconciled_demo: 'Đã đối soát diễn tập',
};
const modes = { buy: 'Mua', rent: 'Thuê', 'rent-buy': 'Thuê mua' },
  actions: Record<string, string> = {
    handover: 'Bàn giao',
    extend: 'Gia hạn',
    terminate: 'Chấm dứt',
    return: 'Trả căn',
  };
const money = (s: string) => BigInt(s).toLocaleString('vi-VN') + ' đ';
export default function TenancyCustomer() {
  const [items, setItems] = useState<TenancyView[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [ack, setAck] = useState<Record<string, boolean>>({});
  async function load() {
    const r = await fetch('/api/workflow/citizen/tenancy/contracts', { cache: 'no-store' }),
      b = await r.json();
    if (!r.ok) throw Error(b.detail ?? 'Chưa đọc được thông tin hợp đồng');
    setItems(b.items);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function confirm(path: string, id: string, v: number) {
    if (!ack[id]) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/workflow/citizen/tenancy/' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(v) },
          body: JSON.stringify({ accepted: true }),
        }),
        b = await r.json();
      if (!r.ok) throw Error(b.detail ?? 'Không xác nhận được');
      setAck((a) => ({ ...a, [id]: false }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface completion-panel">
      <div className="surface-head">
        <h2>Hợp đồng và căn hộ của bạn</h2>
        <p>
          Đây là bản diễn tập. Xác nhận chỉ ghi nhận bạn đã kiểm tra, không ký hợp đồng và không xác
          nhận giao dịch tiền thật.
        </p>
      </div>
      <div className="surface-body">
        {error && <p role="alert">{error}</p>}
        {!items.length && !error && (
          <p>
            Chưa có dự thảo. Chủ đầu tư sẽ lập sau khi hồ sơ được duyệt và căn đáp ứng điều kiện.
          </p>
        )}
        {items.map((c) => (
          <article key={c.id}>
            <h3>{c.title}</h3>
            <p>
              {modes[c.mode]} · Căn {c.unitCode} · Mã hồ sơ {c.applicationCode}
            </p>
            <p>
              {states[c.status]} · Phiên bản {c.version}
            </p>
            <p>
              {c.startsOn} – {c.endsOn} · Tổng lịch nghĩa vụ {money(c.totalVnd)}
            </p>
            <details>
              <summary>Đọc điều khoản, căn cứ và phiên bản chứng cứ</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>{c.terms}</p>
              <p>{c.basis}</p>
              <p>Mã kiểm tra chứng cứ: {c.evidenceHash}</p>
              <p>Phiên bản bản chụp: {c.snapshotHash}</p>
            </details>
            <h4>Lịch nghĩa vụ đã khai báo</h4>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nội dung</th>
                    <th>Đến hạn</th>
                    <th>Phải thu theo dự thảo</th>
                    <th>Đã đối soát diễn tập</th>
                  </tr>
                </thead>
                <tbody>
                  {c.dues.map((d) => (
                    <tr key={d.id}>
                      <td>{d.label}</td>
                      <td>{d.dueOn}</td>
                      <td>{money(d.amountVnd)}</td>
                      <td>{money(d.reconciledVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Ngưỡng đã thỏa thuận trước bàn giao: {money(c.handoverRequiredVnd)}. Mọi khoản hiển
              thị ở đây là dữ liệu diễn tập, không phải yêu cầu chuyển tiền.
            </p>
            {c.status === 'approved' && (
              <div>
                <label>
                  <input
                    type="checkbox"
                    checked={ack[c.id] ?? false}
                    onChange={(e) => setAck((a) => ({ ...a, [c.id]: e.target.checked }))}
                  />
                  Tôi đã kiểm tra điều khoản và từng kỳ thu của bản diễn tập; tôi hiểu đây chưa phải
                  chữ ký hợp đồng.
                </label>
                <Button
                  disabled={busy || !ack[c.id]}
                  onClick={() => void confirm('contracts/' + c.id + '/confirm', c.id, c.version)}
                >
                  Xác nhận đã kiểm tra bản diễn tập
                </Button>
              </div>
            )}
            {c.payments.length > 0 && (
              <details>
                <summary>Chứng cứ đối soát diễn tập</summary>
                {c.payments.map((p) => (
                  <p key={p.id}>
                    {p.reference} · {money(p.amountVnd)} ·{' '}
                    {p.status === 'rejected'
                      ? 'Khoản ghi nhận bị từ chối'
                      : (states[p.status] ?? p.status)}
                  </p>
                ))}
              </details>
            )}
            {c.actions.map((a) => (
              <section key={a.id}>
                <h4>Đề nghị {actions[a.kind]}</h4>
                <p>{a.reason}</p>
                {a.newEndsOn && <p>Thời hạn mới đến {a.newEndsOn}</p>}
                {a.schedule.map((d, i) => (
                  <p key={i}>
                    {d.label} · {d.dueOn} · {money(d.amountVnd)}
                  </p>
                ))}
                <p>Mã kiểm tra chứng cứ: {a.evidenceHash}</p>
                <p>
                  {a.status === 'approved'
                    ? 'Đề nghị đã được duyệt'
                    : a.status === 'rejected'
                      ? 'Đề nghị đã bị từ chối'
                      : a.ownerConfirmed
                        ? 'Bạn đã xác nhận, đang chờ người duyệt độc lập'
                        : 'Cần bạn kiểm tra đề nghị'}
                </p>
                {a.status === 'pending' && !a.ownerConfirmed && (
                  <div>
                    <label>
                      <input
                        type="checkbox"
                        checked={ack[a.id] ?? false}
                        onChange={(e) => setAck((v) => ({ ...v, [a.id]: e.target.checked }))}
                      />
                      Tôi đã kiểm tra nội dung đề nghị diễn tập này.
                    </label>
                    <Button
                      disabled={busy || !ack[a.id]}
                      onClick={() => void confirm('actions/' + a.id + '/confirm', a.id, a.version)}
                    >
                      Xác nhận đề nghị diễn tập
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </article>
        ))}
      </div>
    </section>
  );
}
