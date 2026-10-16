'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import type { KnowledgeDraft } from '@noxh/contracts';

interface Revision extends Omit<KnowledgeDraft, 'reviewedSource'> {
  id: string;
  recordId: string;
  revision: number;
  status: string;
  createdBy: string;
  reviewedBy: string | null;
}
type DraftInput = Omit<KnowledgeDraft, 'reviewedSource'> & { reviewedSource: boolean };
const blank: DraftInput = {
  title: '',
  content: '',
  sourceUrl: '',
  sourceHash: '',
  legalBasis: '',
  mode: 'all',
  group: null,
  effectiveFrom: new Date().toISOString().slice(0, 10),
  effectiveTo: null,
  reviewedSource: false,
};
async function api(path: string, body?: unknown) {
  const r = await fetch('/api/admin/knowledge/projects/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail ?? 'Chưa xử lý được tài liệu');
  return b;
}
export default function KnowledgeAdmin({ projects }: { projects: { id: string; name: string }[] }) {
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [rows, setRows] = useState<Revision[]>([]),
    [form, setForm] = useState<DraftInput>({ ...blank }),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    if (!project) return;
    setRows([]);
    setError('');
    setLoading(true);
    setForm({ ...blank });
    api(project)
      .then((b) => {
        if (active) setRows(b.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project]);
  async function review(id: string, action: 'approve' | 'revoke') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(project + '/' + id + '/review', { action, accepted: true });
      setRows((await api(project)).items);
      setMessage(
        action === 'approve'
          ? 'Đã duyệt tài liệu cho trợ lý tra cứu theo phạm vi và ngày hiệu lực.'
          : 'Đã thu hồi tài liệu; trợ lý không dùng lại phiên bản cũ.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa xử lý được');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="help-note">
        <p>
          Chỉ nội dung được người có quyền pháp chế duyệt mới được trợ lý tra cứu. Ghi đúng điều
          khoản, bản nguồn và phạm vi áp dụng; nội dung và mã nguồn cần được người duyệt đối chiếu.
          Không đưa thông tin cá nhân vào kho hướng dẫn.
        </p>
      </div>
      <label>
        Dự án
        <select
          className="search-input"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          disabled={busy}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      {loading && <p role="status">Đang tải kho tri thức…</p>}
      {!loading && !rows.length && (
        <EmptyState
          title="Chưa có tài liệu tri thức"
          description="Tạo bản hướng dẫn có nguồn, chuyển người khác rà soát rồi mới công bố cho trợ lý."
        />
      )}
      {rows.map((r) => (
        <article className="member-card" key={r.id}>
          <span className="status-badge">
            Bản {r.revision} ·{' '}
            {r.status === 'approved'
              ? 'Đã duyệt'
              : r.status === 'revoked'
                ? 'Đã thu hồi'
                : 'Chờ rà soát'}
          </span>
          <h2 className="section-title">{r.title}</h2>
          <p>
            {r.legalBasis} ·{' '}
            {r.mode === 'all'
              ? 'Mọi hình thức'
              : r.mode === 'buy'
                ? 'Mua'
                : r.mode === 'rent'
                  ? 'Thuê'
                  : 'Thuê mua'}{' '}
            · {r.group ? `Nhóm ${r.group}` : 'Hướng dẫn chung'}
          </p>
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
            Mở tài liệu nguồn ↗
          </a>
          <details>
            <summary>Đọc nội dung và dấu kiểm nguồn</summary>
            <p className="request-message">{r.content}</p>
            <small style={{ overflowWrap: 'anywhere' }}>SHA-256: {r.sourceHash}</small>
            <p>
              Hiệu lực từ {String(r.effectiveFrom).slice(0, 10)}
              {r.effectiveTo ? ' đến ' + String(r.effectiveTo).slice(0, 10) : ''}
            </p>
          </details>
          <div className="top-actions">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setForm({
                  recordId: r.recordId,
                  title: r.title,
                  content: r.content,
                  sourceUrl: r.sourceUrl,
                  sourceHash: r.sourceHash,
                  legalBasis: r.legalBasis,
                  mode: r.mode,
                  group: r.group,
                  effectiveFrom: String(r.effectiveFrom).slice(0, 10),
                  effectiveTo: r.effectiveTo ? String(r.effectiveTo).slice(0, 10) : null,
                  reviewedSource: false,
                });
                setMessage('Đang soạn phiên bản mới của ' + r.title);
              }}
            >
              Soạn bản tiếp theo
            </Button>
            {r.status === 'draft' && (
              <Button disabled={busy} onClick={() => review(r.id, 'approve')}>
                Xác nhận đã đối chiếu nguồn và duyệt
              </Button>
            )}
            {r.status === 'approved' && (
              <Button variant="outline" disabled={busy} onClick={() => review(r.id, 'revoke')}>
                Thu hồi bản này
              </Button>
            )}
          </div>
        </article>
      ))}
      <form
        className="status-panel stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await api(project, form);
            setRows((await api(project)).items);
            setForm({ ...blank });
            setMessage('Đã lưu bản chờ duyệt. Người soạn không tự duyệt.');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Chưa lưu được');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="section-title">
          {form.recordId ? 'Soạn phiên bản mới' : 'Thêm tài liệu hướng dẫn'}
        </h2>
        <label>
          Tiêu đề
          <input
            className="search-input"
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </label>
        <label>
          Nội dung dùng để tra cứu
          <textarea
            className="search-input"
            required
            rows={9}
            minLength={30}
            maxLength={24000}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Đường dẫn nguồn cơ quan nhà nước
            <input
              className="search-input"
              type="url"
              required
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            SHA-256 của bản nguồn đã đối chiếu
            <input
              className="search-input"
              required
              pattern="[a-f0-9]{64}"
              maxLength={64}
              value={form.sourceHash}
              onChange={(e) => setForm({ ...form, sourceHash: e.target.value })}
            />
          </label>
        </div>
        <label>
          Căn cứ và điều khoản
          <input
            className="search-input"
            required
            maxLength={500}
            value={form.legalBasis}
            onChange={(e) => setForm({ ...form, legalBasis: e.target.value })}
          />
        </label>
        <div className="form-grid">
          <label>
            Hình thức
            <select
              className="search-input"
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value as KnowledgeDraft['mode'] })}
            >
              <option value="all">Hướng dẫn chung</option>
              <option value="buy">Mua</option>
              <option value="rent-buy">Thuê mua</option>
              <option value="rent">Thuê</option>
            </select>
          </label>
          <label>
            Nhóm đối tượng
            <select
              className="search-input"
              value={form.group ?? ''}
              onChange={(e) =>
                setForm({ ...form, group: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Hướng dẫn chung</option>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Nhóm {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hiệu lực từ
            <input
              className="search-input"
              type="date"
              required
              value={form.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
          </label>
          <label>
            Đến ngày (nếu có)
            <input
              className="search-input"
              type="date"
              value={form.effectiveTo ?? ''}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value || null })}
            />
          </label>
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            required
            checked={form.reviewedSource}
            onChange={(e) => setForm({ ...form, reviewedSource: e.target.checked })}
          />
          <span>
            Tôi đã đối chiếu nội dung với nguồn và phạm vi áp dụng trước khi gửi người khác duyệt.
          </span>
        </label>
        <div className="top-actions">
          <Button disabled={busy || !project}>{busy ? 'Đang xử lý…' : 'Lưu bản chờ duyệt'}</Button>
          {form.recordId && (
            <Button type="button" variant="outline" onClick={() => setForm({ ...blank })}>
              Chuyển sang tài liệu mới
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
