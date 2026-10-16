'use client';
import { useEffect, useState } from 'react';
import type {
  NotificationCitizenWorkspace,
  NotificationChannel,
  NotificationPurpose,
} from '@noxh/contracts';
import { Button } from '@noxh/ui';
const channels = { in_app: 'Trong ứng dụng', email: 'Email', zalo: 'Zalo' },
  purposes = {
    transactional: 'Thông báo nghiệp vụ về hồ sơ',
    marketing: 'Truyền thông / marketing',
  };
const empty: NotificationCitizenWorkspace = {
  items: [],
  preferences: [],
  projects: [],
  notice: '',
};
export default function NotificationsCustomer() {
  const [data, setData] = useState(empty),
    [project, setProject] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await fetch('/api/workflow/citizen/notifications/workspace', { cache: 'no-store' }),
      b = await r.json();
    if (!r.ok) throw Error(b.detail ?? 'Chưa đọc được hộp thư');
    setData(b);
    setProject((p) => p || b.projects[0]?.id || '');
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function save(path: string, body: unknown, version: number) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/workflow/citizen/notifications/' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'If-Match': String(version) },
          body: JSON.stringify(body),
        }),
        b = await r.json();
      if (!r.ok) throw Error(b.detail ?? 'Chưa ghi nhận được');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa ghi nhận được');
    } finally {
      setBusy(false);
    }
  }
  const messages = data.items.filter((i) => !project || i.projectId === project);
  return (
    <section className="surface completion-panel">
      <div className="surface-head">
        <div>
          <p className="eyebrow">Đồng hành cùng hồ sơ</p>
          <h2>Hộp thư của bạn</h2>
          <p>Thông báo từ chủ đầu tư và lựa chọn nhận tin theo từng mục đích.</p>
        </div>
      </div>
      <div className="surface-body">
        {error && <p role="alert">{error}</p>}
        <p>{data.notice}</p>
        {data.projects.length > 0 && (
          <label>
            Dự án
            <select disabled={busy} value={project} onChange={(e) => setProject(e.target.value)}>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p>
          {messages.filter((m) => !m.readAt).length} thư chưa xác nhận đọc trong {messages.length}{' '}
          thư đang hiển thị.
        </p>
        {messages.length === 0 && (
          <p>
            Chưa có thư trong ứng dụng. Bạn có thể chọn nhận thông báo bên dưới; đồng ý nhận tin
            không thay thế việc đọc và đồng ý thông báo bảo vệ dữ liệu hiện hành.
          </p>
        )}
        {messages.map((m) => (
          <article className="surface" key={m.id}>
            <div className="surface-body">
              <p>
                {m.applicationCode} · {new Date(m.createdAt).toLocaleString('vi-VN')}
              </p>
              <h3>{m.title}</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
              <p>{purposes[m.purpose]}</p>
              {m.readAt ? (
                <p>Đã xác nhận đọc lúc {new Date(m.readAt).toLocaleString('vi-VN')}</p>
              ) : (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void save('messages/' + m.id + '/read', { accepted: true }, m.version)
                  }
                >
                  Tôi đã đọc thông báo này
                </Button>
              )}
            </div>
          </article>
        ))}
        {project && (
          <details>
            <summary>Lựa chọn nhận thông báo</summary>
            <p>
              Mỗi lựa chọn áp dụng riêng cho dự án này. Mặc định chưa đồng ý. Có thể rút lại bất cứ
              lúc nào; thư chưa phát sẽ bị hủy. Thư đã nhận được giữ trong lịch sử. Đây không phải
              chấp thuận toàn bộ hoạt động xử lý dữ liệu.
            </p>
            {(Object.keys(purposes) as NotificationPurpose[]).map((purpose) => (
              <fieldset key={purpose}>
                <legend>{purposes[purpose]}</legend>
                {(Object.keys(channels) as NotificationChannel[]).map((channel) => {
                  const p = data.preferences.find(
                      (p) =>
                        p.projectId === project && p.channel === channel && p.purpose === purpose,
                    ),
                    enabled = p?.enabled ?? false;
                  return (
                    <div className="actions" key={channel}>
                      <span>
                        {channels[channel]}:{' '}
                        <strong>{enabled ? 'Đã đồng ý nhận' : 'Chưa đồng ý nhận'}</strong>
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void save(
                            'projects/' + project + '/preferences',
                            { channel, purpose, enabled: !enabled, accepted: true },
                            p?.version ?? 0,
                          )
                        }
                      >
                        {enabled ? 'Rút lại lựa chọn' : 'Tôi đồng ý nhận qua ' + channels[channel]}
                      </Button>
                    </div>
                  );
                })}
              </fieldset>
            ))}
            <p>
              Email và Zalo cần chủ đầu tư cấu hình adapter và vận hành kích hoạt; đồng ý nhận tin
              chưa đồng nghĩa kênh đã hoạt động.
            </p>
          </details>
        )}
      </div>
    </section>
  );
}
