'use client';
import { useEffect, useState } from 'react';
import { Button, Icon } from '@noxh/ui';
import type { AiSettings, FormRelease, LegalForm } from '@noxh/contracts';
interface Project {
  id: string;
  name: string;
}
async function request(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/admin/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Không thực hiện được');
  return v;
}
export function OpenAiSettings() {
  const [settings, setSettings] = useState<AiSettings>(),
    [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    request('settings/openai')
      .then((v) => {
        if (live) setSettings(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="surface">
      <div className="surface-head">
        <h2 className="section-title">OpenAI · Trợ lý chuẩn bị hồ sơ</h2>
        <Icon name="chat" />
      </div>
      <div className="surface-body">
        <p>
          Sau khi quản trị triển khai đặt EXTERNAL_AI_ENABLED=true, khách hàng có thể hỏi checklist,
          đọc hướng dẫn mẫu, yêu cầu soạn bản khai và câu hỏi hỗ trợ. Mọi thao tác ghi cần khách xem
          và xác nhận.
        </p>
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
        {settings ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              setMessage('');
              try {
                await request(
                  'settings/openai',
                  {
                    enabled: settings.enabled,
                    model: settings.model,
                    dailyLimit: settings.dailyLimit,
                    ...(key ? { apiKey: key } : {}),
                  },
                  'PUT',
                  settings.version,
                );
                setKey('');
                setSettings(await request('settings/openai'));
                setMessage('Đã lưu cấu hình OpenAI. Khóa không được trả về giao diện.');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Không lưu được');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              />
              <span>Bật trợ lý OpenAI cho khách hàng của tổ chức</span>
            </label>
            <div className="form-grid">
              <label>
                Mã mô hình OpenAI
                <input
                  className="search-input"
                  required
                  pattern="[a-zA-Z0-9._-]+"
                  maxLength={100}
                  value={settings.model}
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                  placeholder="Nhập mã mô hình được tài khoản OpenAI hỗ trợ"
                />
              </label>
              <label>
                Số yêu cầu tối đa mỗi ngày
                <input
                  className="search-input"
                  required
                  type="number"
                  min={1}
                  max={1000}
                  value={settings.dailyLimit}
                  onChange={(e) => setSettings({ ...settings, dailyLimit: Number(e.target.value) })}
                />
              </label>
            </div>
            <label>
              {settings.hasKey
                ? 'Thay khóa API (để trống để giữ khóa hiện tại)'
                : 'Khóa API OpenAI'}
              <input
                className="search-input"
                required={!settings.hasKey}
                type="password"
                autoComplete="new-password"
                minLength={20}
                maxLength={512}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <div className="help-note">
              <Icon name="shield" />
              <p>
                Khóa được mã hóa ở máy chủ. Mỗi khách tối đa 10 yêu cầu/giờ; mỗi yêu cầu tối đa 3
                lượt gọi mô hình và 1.600 token đầu ra/lượt. Hạn mức ngày là số yêu cầu, không phải
                giới hạn tiền. Chủ đầu tư cần đặt thêm ngân sách tại OpenAI.
              </p>
            </div>
            <p>
              <a
                className="text-button"
                href="https://platform.openai.com/settings/organization/api-keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Quản lý khóa OpenAI ↗
              </a>{' '}
              ·{' '}
              <a
                className="text-button"
                href="https://developers.openai.com/api/docs/guides/your-data"
                target="_blank"
                rel="noopener noreferrer"
              >
                Chính sách xử lý dữ liệu ↗
              </a>
            </p>
            <p>
              Khách phải đồng ý trước mỗi yêu cầu. <code>store:false</code> được gửi tới OpenAI;
              chính sách lưu giữ phục vụ an toàn của nhà cung cấp vẫn có thể áp dụng. Nội dung trò
              chuyện không được ghi vào nhật ký vận hành.
            </p>
            <Button disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cấu hình OpenAI'}</Button>
          </form>
        ) : (
          !error && <p role="status">Đang tải cấu hình…</p>
        )}
      </div>
    </section>
  );
}
export function LegalTemplates({ projects }: { projects: Project[] }) {
  const [forms, setForms] = useState<LegalForm[]>([]),
    [scope, setScope] = useState(''),
    [project, setProject] = useState(projects[0]?.id ?? ''),
    [formId, setFormId] = useState(''),
    [mode, setMode] = useState('buy'),
    [group, setGroup] = useState(5),
    [recipient, setRecipient] = useState(''),
    [instructions, setInstructions] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10)),
    [effectiveTo, setEffectiveTo] = useState(''),
    [releases, setReleases] = useState<FormRelease[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    request('legal/catalog')
      .then((v) => {
        if (live) {
          setForms(v.forms);
          setFormId(v.forms[0]?.id ?? '');
          setScope(v.scope);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setReleases([]);
    if (project)
      request('projects/' + project + '/forms')
        .then((v) => {
          if (live) setReleases(v.items);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [project]);
  const f = forms.find((f) => f.id === formId);
  return (
    <div className="stack">
      <div className="help-note amber">
        <Icon name="shield" />
        <p>
          {scope || 'Đang tải danh mục nguồn…'} Chưa được tự động kết luận bộ hồ sơ đủ điều kiện.
          Thuê không áp dụng đồng nhất các điều kiện của mua và thuê mua.
        </p>
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
      <section className="surface">
        <div className="surface-head">
          <h2 className="section-title">Soạn hướng dẫn theo mẫu nguồn</h2>
          <span className="status-badge">15 mẫu trích nguyên trang</span>
        </div>
        <form
          className="surface-body stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setMessage('');
            try {
              await request(
                'projects/' + project + '/forms',
                {
                  formId,
                  recipient,
                  instructions,
                  mode,
                  group,
                  reviewed,
                  effectiveFrom,
                  effectiveTo: effectiveTo || null,
                },
                'POST',
              );
              setReleases((await request('projects/' + project + '/forms')).items);
              setReviewed(false);
              setMessage(
                'Đã lưu bản chờ duyệt. Nhân sự pháp lý khác cần duyệt trước khi khách thấy mẫu.',
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Không công bố được');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              Dự án
              <select
                className="search-input"
                required
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setReviewed(false);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mẫu chuẩn nguồn
              <select
                className="search-input"
                required
                value={formId}
                onChange={(e) => {
                  const next = forms.find((f) => f.id === e.target.value)!;
                  setFormId(next.id);
                  setMode(next.modes[0] ?? 'buy');
                  setGroup(next.groups[0] ?? 5);
                  setReviewed(false);
                }}
              >
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {f && (
            <div className="member-card">
              <strong>{f.legalBasis}</strong>
              <p>{f.externalConfirmation ?? 'Theo nội dung và trường hợp trong mẫu nguồn.'}</p>
              <p>
                <a
                  className="text-button"
                  href={f.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Đọc văn bản gốc ↗
                </a>{' '}
                · Trang {f.sourcePages.join(', ')}
              </p>
              <small>SHA-256 mẫu: {f.sha256}</small>
            </div>
          )}
          <div className="form-grid">
            <label>
              Hình thức
              <select
                className="search-input"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setReviewed(false);
                }}
              >
                {f?.modes.map((m) => (
                  <option key={m} value={m}>
                    {m === 'buy' ? 'Mua' : m === 'rent-buy' ? 'Thuê mua' : 'Thuê'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Khoản đối tượng tại Điều 76
              <select
                className="search-input"
                value={group}
                onChange={(e) => {
                  setGroup(Number(e.target.value));
                  setReviewed(false);
                }}
              >
                {f?.groups.map((g) => (
                  <option key={g} value={g}>
                    Khoản {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Nơi nhận / thông tin dự án để hướng dẫn điền
            <input
              className="search-input"
              required
              maxLength={500}
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                setReviewed(false);
              }}
            />
          </label>
          <label>
            Hướng dẫn khai và giấy tờ đính kèm
            <textarea
              className="search-input"
              required
              maxLength={4000}
              rows={7}
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                setReviewed(false);
              }}
              placeholder="Ghi rõ đối tượng áp dụng, dữ liệu dự án, cơ quan xác nhận, giấy tờ cần mang theo và cách nộp."
            />
          </label>
          <div className="form-grid">
            <label>
              Hiệu lực từ ngày
              <input
                className="search-input"
                type="date"
                required
                value={effectiveFrom}
                onInput={(e) => {
                  setEffectiveFrom(e.currentTarget.value);
                  setReviewed(false);
                }}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </label>
            <label>
              Hiệu lực đến ngày (nếu có)
              <input
                className="search-input"
                type="date"
                value={effectiveTo}
                onInput={(e) => {
                  setEffectiveTo(e.currentTarget.value);
                  setReviewed(false);
                }}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              Tôi đã rà soát hiệu lực pháp lý, quy định địa phương, phạm vi đối tượng và hướng dẫn
              cho dự án này; chuyển cho người duyệt pháp lý độc lập.
            </span>
          </label>
          <p>
            Mỗi lần lưu tạo một phiên bản chờ duyệt mới. Người soạn không được tự duyệt; người duyệt
            cần quyền form_legal_approver trong Keycloak. Nội dung mẫu gốc giữ nguyên theo nguồn;
            hướng dẫn dự án được hiển thị riêng.
          </p>
          <Button disabled={busy || !reviewed || !f?.modes.length || !f?.groups.length || !project}>
            {busy ? 'Đang lưu…' : 'Lưu và chuyển duyệt'}
          </Button>
        </form>
      </section>
      <section className="surface">
        <div className="surface-head">
          <h2 className="section-title">Các phiên bản hướng dẫn tại dự án</h2>
        </div>
        <div className="surface-body">
          {!releases.length && <p>Chưa công bố hướng dẫn.</p>}
          {releases.map((r) => (
            <article className="member-card" key={r.id}>
              <span className="status-badge green">
                {r.status === 'draft'
                  ? 'Chờ duyệt'
                  : r.status === 'approved'
                    ? 'Đã duyệt'
                    : 'Đã thu hồi'}{' '}
                · Bản {r.version} · Nhóm {r.subject_group} · {r.mode}
              </span>
              <h3>{r.title}</h3>
              <p>
                <strong>Nơi nhận:</strong> {r.recipient}
              </p>
              <p className="request-message">{r.instructions}</p>
              <small>
                Tạo {new Date(r.created_at).toLocaleString('vi-VN')} · Hiệu lực {r.effective_from} —{' '}
                {r.effective_to || 'đến khi thay thế'}
              </small>
              {r.status !== 'revoked' && (
                <p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          r.status === 'draft'
                            ? 'Xác nhận đã rà soát pháp lý và duyệt để công bố cho khách? Yêu cầu tài khoản người duyệt khác người soạn.'
                            : 'Thu hồi bản này khỏi danh mục cho khách?',
                        )
                      )
                        return;
                      setBusy(true);
                      setError('');
                      try {
                        await request(
                          'projects/' + project + '/forms/' + r.id + '/review',
                          { accepted: true, action: r.status === 'draft' ? 'approve' : 'revoke' },
                          'POST',
                        );
                        setReleases((await request('projects/' + project + '/forms')).items);
                        setMessage(
                          r.status === 'draft'
                            ? 'Đã duyệt và công bố hướng dẫn.'
                            : 'Đã thu hồi hướng dẫn.',
                        );
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Không thực hiện được');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {r.status === 'draft' ? 'Duyệt và công bố' : 'Thu hồi'}
                  </Button>
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
