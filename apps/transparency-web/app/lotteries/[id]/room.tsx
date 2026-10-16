'use client';
import { useEffect, useState } from 'react';
import { Brand, Button } from '@noxh/ui';
import type { LotteryConfig, LotteryResult } from '@noxh/contracts';
type Evidence = {
  id: string;
  title: string;
  status: string;
  version: number;
  config: LotteryConfig;
  result: LotteryResult | null;
  commitment: string;
  snapshotHash: string;
  frozenAt: string;
  entropyRecord: string | null;
  minutesHash: string | null;
  voidReason: string | null;
};
const stages = [
  'Khóa danh sách',
  'Cam kết công khai',
  'Nguồn ngẫu nhiên',
  'Chạy & kiểm tra',
  'Công bố',
];
export default function LotteryRoom({ initial }: { initial: Evidence }) {
  const [data, setData] = useState(initial),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [shown, setShown] = useState(0),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    let active = true;
    const t = setInterval(() => {
      if (document.hidden) return;
      fetch('/api/lotteries/' + initial.id, { cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((v) => {
          if (active) {
            setData(v);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError('Mất kết nối cập nhật. Dữ liệu dưới đây là lần nhận gần nhất.');
        });
    }, 5000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [initial.id]);
  const count = data.result?.ranking.length ?? 0;
  useEffect(() => {
    if (!playing || !data.result || shown >= count) return;
    const t = setTimeout(() => setShown((v) => v + 1), 1100);
    return () => clearTimeout(t);
  }, [playing, shown, count, data.result]);
  const stage =
    data.status === 'published'
      ? 4
      : ['drawn', 'certified'].includes(data.status)
        ? 3
        : data.status === 'seeded'
          ? 2
          : 1;
  const ranking = data.result?.ranking ?? [],
    current = ranking[Math.max(0, shown - 1)],
    filtered = ranking.filter((v) => v.code.includes(query.trim().toUpperCase()));
  function download(kind: 'json' | 'csv') {
    const content =
      kind === 'json'
        ? JSON.stringify(data, null, 2)
        : '\ufeffMã hồ sơ,Thứ tự,Kết quả,Căn hộ\n' +
          ranking
            .map((v) =>
              [v.code, v.rank, v.selected ? 'Được chọn' : 'Dự bị', v.unit ?? ''].join(','),
            )
            .join('\n');
    const url = URL.createObjectURL(
      new Blob([content], {
        type: kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'noxh-demo-' + data.id + '.' + kind;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main id="noi-dung" tabIndex={-1} className="container section">
      <div className="lottery-top">
        <Brand />
        <a href="/">← Các phiên công khai</a>
      </div>
      <div className="lottery-hero">
        <span className="status-badge amber">DIỄN TẬP · KHÔNG CÓ GIÁ TRỊ PHÂN NHÀ</span>
        <h1>{data.title}</h1>
        <p>
          {data.config.kind === 'allocation'
            ? 'Phân căn cho danh sách đã được chọn'
            : data.config.kind === 'priority-overflow'
              ? 'Diễn tập trong một nhóm ưu tiên vượt suất'
              : 'Diễn tập lựa chọn sau khi xử lý ưu tiên'}
        </p>
      </div>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <div className="lottery-timeline" aria-label="Tiến trình">
        {stages.map((s, i) => (
          <div key={s} className={i <= stage ? 'done' : ''}>
            <span>{i + 1}</span>
            {s}
          </div>
        ))}
      </div>
      {data.status === 'voided' && (
        <p role="alert" className="feedback error">
          Phiên đã hủy: {data.voidReason}. Giữ nguyên bằng chứng; không quay lại phiên này.
        </p>
      )}
      <div className="lottery-room-grid">
        <section className="lottery-stage">
          <span className="lottery-stage-label">
            {data.status === 'published'
              ? 'TRÌNH CHIẾU KẾT QUẢ ĐÃ GHI NHẬN'
              : 'THEO DÕI TRẠNG THÁI'}
          </span>
          <div className="lottery-code" aria-live="polite">
            {data.status === 'voided'
              ? 'ĐÃ HỦY'
              : shown && current
                ? current.code
                : data.status === 'published'
                  ? 'SẴN SÀNG'
                  : 'ĐÃ KHÓA'}
          </div>
          <p>
            {shown && current
              ? `Thứ tự ${current.rank} · ${current.selected ? 'Được chọn' : 'Dự bị'}${current.unit ? ' · Căn ' + current.unit : ''}`
              : data.status === 'published'
                ? 'Chọn trình chiếu hoặc xem ngay danh sách đầy đủ bên dưới.'
                : 'Kết quả chỉ hiển thị sau khi có kiểm tra và công bố.'}
          </p>
          {data.status === 'published' && (
            <div className="lottery-stage-actions">
              <Button disabled={shown >= count} onClick={() => setPlaying(!playing)}>
                {playing ? 'Tạm dừng' : 'Trình chiếu'}
              </Button>
              <Button
                variant="outline"
                disabled={shown >= count}
                onClick={() => {
                  setPlaying(false);
                  setShown((v) => v + 1);
                }}
              >
                Mã tiếp theo
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPlaying(false);
                  setShown(0);
                }}
              >
                Xem lại
              </Button>
            </div>
          )}
          <small>Trình chiếu chỉ đọc kết quả đã lưu; không thực hiện bốc thăm mới.</small>
        </section>
        <aside className="surface">
          <div className="surface-body stack">
            <span className="kicker">THÔNG TIN PHIÊN</span>
            <h2>
              {data.config.entries.length} hồ sơ / {data.config.seats} suất
            </h2>
            <p>
              Lịch lấy ngẫu nhiên:{' '}
              {new Date(data.config.scheduledAt).toLocaleString('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
              })}
            </p>
            <p>
              Cam kết công bố:{' '}
              {new Date(data.frozenAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
            </p>
            <span className="status-badge blue">
              {data.status === 'published'
                ? 'Đã công bố'
                : data.status === 'voided'
                  ? 'Đã hủy'
                  : 'Chờ hoàn thành quy trình'}
            </span>
            <p>HKDF-SHA256 · HMAC-SHA256 · Fisher–Yates với loại bỏ sai lệch modulo.</p>
          </div>
        </aside>
      </div>
      <section className="surface">
        <div className="surface-head">
          <h2>{data.result ? 'Tra cứu kết quả' : 'Danh sách đã khóa'}</h2>
          {data.result && (
            <Button variant="outline" onClick={() => download('csv')}>
              Tải CSV
            </Button>
          )}
        </div>
        <div className="surface-body">
          <label>
            Tra mã hồ sơ
            <input
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="DEMO-0001"
            />
          </label>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Mã hồ sơ</th>
                <th scope="col">Thứ tự</th>
                <th scope="col">Kết quả</th>
                <th scope="col">Căn hộ</th>
              </tr>
            </thead>
            <tbody>
              {data.result
                ? filtered.map((v) => (
                    <tr key={v.code}>
                      <td>
                        <strong>{v.code}</strong>
                      </td>
                      <td>{v.rank}</td>
                      <td>
                        <span className={'status-badge ' + (v.selected ? 'green' : 'amber')}>
                          {v.selected ? 'Được chọn' : 'Dự bị'}
                        </span>
                      </td>
                      <td>{v.unit ?? '—'}</td>
                    </tr>
                  ))
                : [...data.config.entries]
                    .sort()
                    .filter((v) => v.includes(query.toUpperCase()))
                    .map((v) => (
                      <tr key={v}>
                        <td>{v}</td>
                        <td colSpan={3}>Chưa công bố kết quả</td>
                      </tr>
                    ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="lottery-room-grid">
        <section className="surface">
          <div className="surface-body stack">
            <h2>Quy chế & căn cứ</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{data.config.rules}</p>
            <p>{data.config.legalBasis}</p>
            <h3>Phạm vi sau ưu tiên</h3>
            <p>{data.config.priorityResolution}</p>
            <h3>Nguồn ngẫu nhiên đã định trước</h3>
            <p>{data.config.entropySource}</p>
            <p>{data.entropyRecord}</p>
          </div>
        </section>
        <section className="surface">
          <div className="surface-head">
            <h2>Bằng chứng kiểm tra</h2>
            {data.result && (
              <Button variant="outline" onClick={() => download('json')}>
                Tải JSON
              </Button>
            )}
          </div>
          <div className="surface-body stack">
            <p>
              Cam kết: <code className="hash-value">{data.commitment}</code>
            </p>
            <p>
              SHA-256 danh sách và quy chế: <code className="hash-value">{data.snapshotHash}</code>
            </p>
            {data.result && (
              <>
                <p>
                  Mở cam kết: <code className="hash-value">{data.result.secret}</code>
                </p>
                <p>
                  Ngẫu nhiên diễn tập: <code className="hash-value">{data.result.entropy}</code>
                </p>
                <p>
                  SHA-256 biên bản: <code className="hash-value">{data.minutesHash}</code>
                </p>
                <code>python3 scripts/verify-lottery.py &lt;tệp JSON&gt;</code>
              </>
            )}
            <small>
              Bộ kiểm tra xác nhận phép tính, không xác thực chữ ký cơ quan, điều kiện hồ sơ hoặc
              nguồn ngẫu nhiên. Bốc thăm thật vẫn bị khóa chờ thẩm định độc lập.
            </small>
          </div>
        </section>
      </div>
    </main>
  );
}
