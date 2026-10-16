'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  NotificationAdminWorkspace,
  NotificationChannel,
  NotificationPurpose,
} from '@noxh/contracts';
import { Button } from '@noxh/ui';
import NotificationAutomationAdmin from './notification-automation-admin';
const channels = { in_app: 'Trong ứng dụng', email: 'Email', zalo: 'Zalo' },
  purposes = { transactional: 'Thông báo nghiệp vụ', marketing: 'Truyền thông / marketing' };
const states: Record<string, string> = {
  draft: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  revoked: 'Đã thu hồi',
  queued: 'Chờ phát',
  delivered: 'Đã phát',
  failed: 'Bị kênh từ chối',
  cancelled: 'Đã hủy',
  outcome_unknown: 'Cần đối chiếu kênh',
};
const empty: NotificationAdminWorkspace = {
  templates: [],
  messages: [],
  applications: [],
  transports: [],
  externalEnabled: false,
  registeredAdapters: [],
  notice: '',
};
async function call(project: string, path: string, body?: unknown, version?: number) {
  const r = await fetch('/api/admin/notifications/projects/' + project + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.detail ?? 'Chưa thực hiện được');
  return b;
}
export default function NotificationsAdmin({
  projects,
  staff,
}: {
  projects: { id: string; name: string }[];
  staff?: { subject: string; permissions?: string[] };
}) {
  const [view, setView] = useState<'manual' | 'automation'>('manual');
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [data, setData] = useState(empty),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState('');
  const [channel, setChannel] = useState<NotificationChannel>('in_app'),
    [purpose, setPurpose] = useState<NotificationPurpose>('transactional'),
    [template, setTemplate] = useState(''),
    [application, setApplication] = useState(''),
    [reference, setReference] = useState(''),
    [note, setNote] = useState('');
  const retries = useRef(new Map<string, string>());
  async function load() {
    if (!project) return;
    const d = await call(project, '/workspace');
    setData(d);
  }
  useEffect(() => {
    let active = true;
    if (project)
      call(project, '/workspace')
        .then((d) => {
          if (active) {
            setData(d);
            setError('');
            setTemplate('');
            setApplication('');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [project]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      await load();
      setSuccess('Đã ghi nhận thao tác.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  async function create(path: string, body: Record<string, unknown>) {
    const key = JSON.stringify({ project, path, body }),
      id = retries.current.get(key) ?? crypto.randomUUID();
    retries.current.set(key, id);
    const r = await call(project, path, { ...body, idempotencyKey: id });
    retries.current.delete(key);
    return r;
  }
  const canReview = staff?.permissions?.includes('form_legal_approver') ?? false;
  return (
    <section className="surface completion-panel">
      <div className="surface-head">
        <div>
          <p className="eyebrow">Vận hành dự án</p>
          <h2>Thông báo và hộp thư</h2>
          <p>Soạn mẫu, duyệt độc lập và theo dõi từng lần phát tới hồ sơ đã chọn.</p>
        </div>
        <label>
          Dự án
          <select
            disabled={busy}
            value={project}
            onChange={(e) => {
              setData(empty);
              setTemplate('');
              setApplication('');
              setProject(e.target.value);
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav className="iw-tabs surface-body" aria-label="Cách phát thông báo">
        <Button
          variant={view === 'manual' ? 'default' : 'outline'}
          aria-pressed={view === 'manual'}
          disabled={busy}
          onClick={() => setView('manual')}
        >
          Thông báo thủ công
        </Button>
        <Button
          variant={view === 'automation' ? 'default' : 'outline'}
          aria-pressed={view === 'automation'}
          disabled={busy}
          onClick={() => setView('automation')}
        >
          Tự động trong ứng dụng
        </Button>
      </nav>
      {view === 'automation' ? (
        <div className="surface-body">
          <NotificationAutomationAdmin
            key={project}
            project={project}
            templates={data.templates}
            staff={staff}
          />
        </div>
      ) : (
        <div className="surface-body">
          <p>{data.notice || 'Chỉ dữ liệu diễn tập. Email và Zalo mặc định tắt.'}</p>
          {error && <p role="alert">{error}</p>}
          {success && <p role="status">{success}</p>}
          <div className="form-grid">
            <article>
              <strong>{data.templates.filter((t) => t.status === 'approved').length}</strong>
              <p>Mẫu đã duyệt trong 100 mẫu mới nhất</p>
            </article>
            <article>
              <strong>{data.messages.filter((m) => m.status === 'queued').length}</strong>
              <p>Chờ phát trong 100 thông báo mới nhất</p>
            </article>
            <article>
              <strong>{data.messages.filter((m) => m.status === 'outcome_unknown').length}</strong>
              <p>Cần đối chiếu, không gửi lại</p>
            </article>
          </div>
          <details>
            <summary>Soạn mẫu thông báo mới</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(() =>
                  create('/templates', {
                    name: f.get('name'),
                    title: f.get('title'),
                    body: f.get('body'),
                    basis: f.get('basis'),
                    channel,
                    purpose,
                  }),
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Tên mẫu
                  <input name="name" minLength={3} maxLength={160} required />
                </label>
                <label>
                  Kênh
                  <select
                    value={channel}
                    onChange={(e) => setChannel(e.target.value as NotificationChannel)}
                  >
                    {Object.entries(channels).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mục đích
                  <select
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value as NotificationPurpose)}
                  >
                    {Object.entries(purposes).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Tiêu đề
                <input name="title" minLength={3} maxLength={200} required />
              </label>
              <label>
                Nội dung
                <textarea name="body" minLength={10} maxLength={3000} required />
              </label>
              <p>
                Biến được hỗ trợ: {'{projectName}'}, {'{applicationCode}'}, {'{reference}'}. Chỉ văn
                bản thuần.
              </p>
              <label>
                Căn cứ và phạm vi sử dụng
                <textarea name="basis" minLength={20} maxLength={2000} required />
              </label>
              <Button disabled={busy || !project}>Lưu bản chờ duyệt</Button>
            </form>
          </details>
          <h3>Thư viện mẫu</h3>
          {!data.templates.length && (
            <p>Chưa có mẫu. Soạn mẫu trước, sau đó chuyển người có quyền pháp chế rà soát.</p>
          )}
          <label>
            Ghi chú quyết định duyệt / thu hồi
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={10}
              maxLength={1000}
            />
          </label>
          {data.templates.map((t) => (
            <details key={t.id}>
              <summary>
                {t.name} · {channels[t.channel]} · {states[t.status]}
              </summary>
              <p>
                {purposes[t.purpose]} · Phiên bản {t.version}
              </p>
              <h4>{t.title}</h4>
              <p style={{ whiteSpace: 'pre-wrap' }}>{t.body}</p>
              <p>Căn cứ: {t.basis}</p>
              {canReview &&
                t.createdBy !== staff?.subject &&
                ['draft', 'approved'].includes(t.status) && (
                  <div className="actions">
                    {(t.status === 'draft' ? ['approve', 'reject'] : ['revoke']).map((decision) => (
                      <Button
                        key={decision}
                        disabled={busy || note.trim().length < 10}
                        onClick={() =>
                          void run(() =>
                            call(
                              project,
                              '/templates/' + t.id + '/review',
                              { decision, accepted: true, note },
                              t.version,
                            ),
                          )
                        }
                      >
                        {decision === 'approve'
                          ? 'Duyệt mẫu'
                          : decision === 'reject'
                            ? 'Từ chối mẫu'
                            : 'Thu hồi mẫu và hủy thư chưa phát'}
                      </Button>
                    ))}
                  </div>
                )}
            </details>
          ))}
          <details>
            <summary>Lập thông báo từ hồ sơ</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  create('/queue', { templateId: template, applicationId: application, reference }),
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Mẫu đã duyệt
                  <select required value={template} onChange={(e) => setTemplate(e.target.value)}>
                    <option value="">Chọn mẫu</option>
                    {data.templates
                      .filter((t) => t.status === 'approved')
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} · {channels[t.channel]}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Mã hồ sơ người nhận
                  <select
                    required
                    value={application}
                    onChange={(e) => setApplication(e.target.value)}
                  >
                    <option value="">Chọn hồ sơ</option>
                    {data.applications.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Thông tin tham chiếu
                <input
                  maxLength={300}
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <p>
                Hệ thống kiểm tra lại thông báo riêng tư và lựa chọn đúng kênh, mục đích của khách.
                Đưa vào hàng đợi chưa phát ngay.
              </p>
              <Button disabled={busy}>Đưa vào hàng đợi</Button>
            </form>
          </details>
          <h3>Hàng đợi và lịch sử phát</h3>
          {!data.messages.length && <p>Chưa có thông báo.</p>}
          {data.messages.map((m) => (
            <article className="surface" key={m.id}>
              <div className="surface-body">
                <h4>{m.title}</h4>
                <p>
                  {m.applicationCode} · {channels[m.channel]} · {purposes[m.purpose]} ·{' '}
                  {states[m.status]}
                </p>
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                <p>
                  Lần thử {m.attemptCount}/3 tối đa ·{' '}
                  {m.readAt ? 'Khách đã xác nhận đọc' : 'Chưa có xác nhận đọc'} · Phiên bản{' '}
                  {m.version}
                </p>
                {m.attempts.map((a) => (
                  <p key={a.number}>
                    Lần {a.number}: {states[a.outcome] ?? a.outcome} ·{' '}
                    {new Date(a.at).toLocaleString('vi-VN')}
                  </p>
                ))}
                {['queued', 'failed'].includes(m.status) && (
                  <Button
                    disabled={busy || (m.channel !== 'in_app' && !data.externalEnabled)}
                    onClick={() =>
                      void run(() =>
                        call(
                          project,
                          '/messages/' + m.id + '/deliver',
                          { accepted: true },
                          m.version,
                        ),
                      )
                    }
                  >
                    {m.status === 'failed'
                      ? 'Xác nhận thử lại theo giới hạn'
                      : 'Xác nhận phát thông báo'}
                  </Button>
                )}
                {m.status === 'outcome_unknown' && (
                  <p>
                    Cần vận hành đối chiếu nhà cung cấp. Hệ thống chặn gửi lại khi chưa rõ kết quả.
                  </p>
                )}
              </div>
            </article>
          ))}
          <details>
            <summary>Cấu hình adapter email / Zalo</summary>
            <p>
              {data.externalEnabled
                ? 'Vận hành đã cho phép kênh ngoài.'
                : 'Vận hành chưa bật kênh ngoài. Cấu hình giao diện không thể tự mở chốt này.'}{' '}
              Adapter đã đăng ký: {data.registeredAdapters.join(', ') || 'Chưa có'}.
            </p>
            <p>
              Không nhập khóa bí mật ở đây. Adapter do vận hành đăng ký trên máy chủ, phải hỗ trợ
              idempotency. Cần quyền rà soát dữ liệu để bật.
            </p>
            {(['email', 'zalo'] as const).map((c) => {
              const t = data.transports.find((t) => t.channel === c);
              return (
                <form
                  key={c + ':' + (t?.version ?? 0)}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      call(
                        project,
                        '/transports',
                        {
                          channel: c,
                          enabled: f.get('enabled') === 'on',
                          adapterId: f.get('adapterId'),
                          maxAttempts: Number(f.get('maxAttempts')),
                          accepted: true,
                        },
                        t?.version ?? 0,
                      ),
                    );
                  }}
                >
                  <h4>{channels[c]}</h4>
                  <div className="form-grid">
                    <label>
                      Adapter
                      <input
                        name="adapterId"
                        pattern="[a-z][a-z0-9-]{2,60}"
                        defaultValue={t?.adapterId ?? ''}
                        required
                      />
                    </label>
                    <label>
                      Giới hạn lần thử
                      <input
                        name="maxAttempts"
                        type="number"
                        min={1}
                        max={3}
                        defaultValue={t?.maxAttempts ?? 1}
                        required
                      />
                    </label>
                  </div>
                  <label>
                    <input name="enabled" type="checkbox" defaultChecked={t?.enabled ?? false} />{' '}
                    Cho phép sử dụng adapter đã kiểm tra
                  </label>
                  <Button disabled={busy}>Xác nhận cấu hình {channels[c]}</Button>
                </form>
              );
            })}
          </details>
        </div>
      )}
    </section>
  );
}
