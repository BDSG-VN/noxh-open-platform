'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import {
  PreparationChecklistSchema,
  preparationDocumentTypes,
  type PreparationChecklist,
  type PreparationChecklistInput,
  type LegalForm,
} from '@noxh/contracts';
const labels: Record<string, string> = {
  any: 'Ít nhất một tệp an toàn (mục chuẩn bị chung)',
  identity: 'Nhân thân',
  housing: 'Chỗ ở',
  income: 'Thu nhập',
  subject: 'Đối tượng',
  'attested-form': 'Bản có xác nhận',
  other: 'Khác theo hướng dẫn',
};
async function request(path: string, body?: unknown) {
  const response = await fetch('/api/admin/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.detail ?? 'Chưa thực hiện được thao tác.');
  return data;
}
function empty(): PreparationChecklistInput {
  return {
    title: '',
    instructions: '',
    sourceReference: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: null,
    documentTypes: ['any'],
    formIds: ['any'],
  };
}
export function PreparationChecklistAdmin({
  projects,
  staff,
}: {
  projects: { id: string; name: string }[];
  staff?: { subject: string; permissions?: string[] };
}) {
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [rows, setRows] = useState<PreparationChecklist[]>([]),
    [catalog, setCatalog] = useState<LegalForm[]>([]),
    [input, setInput] = useState<PreparationChecklistInput>(empty),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const sequence = useRef(0);
  async function load() {
    if (!project) return;
    const serial = ++sequence.current;
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        request('projects/' + project + '/preparation-checklists'),
        request('legal/catalog'),
      ]);
      if (serial !== sequence.current) return;
      setRows(r.items);
      setCatalog(c.forms);
    } finally {
      if (serial === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setRows([]);
    setInput(empty());
    setError('');
    setMessage('');
    load().catch((e) => setError(e.message));
    return () => {
      sequence.current++;
    };
  }, [project]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      setMessage('Đã lưu thay đổi. Hướng dẫn chỉ dùng đánh giá mức độ chuẩn bị.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa thực hiện được.');
    } finally {
      setBusy(false);
    }
  }
  function toggleDocument(type: PreparationChecklistInput['documentTypes'][number]) {
    const values = input.documentTypes.filter((v) => v !== 'any');
    const next: PreparationChecklistInput['documentTypes'] =
      type === 'any'
        ? ['any']
        : values.includes(type)
          ? values.filter((v) => v !== type)
          : [...values, type];
    setInput({ ...input, documentTypes: next.length ? next : ['any'] });
  }
  function toggleForm(id: string) {
    const values = input.formIds.filter((v) => v !== 'any');
    const next =
      id === 'any'
        ? ['any']
        : values.includes(id)
          ? values.filter((v) => v !== id)
          : [...values, id];
    setInput({ ...input, formIds: next.length ? next : ['any'] });
  }
  return (
    <div className="dossier-process stack">
      <header>
        <span className="kicker">HỒ SƠ / CHECKLIST CHUẨN BỊ</span>
        <h2>Hướng dẫn rõ từng việc cần làm</h2>
        <p>
          Thiết lập danh mục chuẩn bị của dự án, duyệt độc lập rồi theo dõi phiên bản áp dụng. Các
          mục và trọng số không xác định điều kiện pháp lý hay thứ tự mua nhà.
        </p>
      </header>
      <label>
        Dự án
        <select
          className="search-input"
          value={project}
          disabled={busy}
          onChange={(e) => setProject(e.target.value)}
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
        <p role="status" className="feedback success">
          {message}
        </p>
      )}
      {loading && <p role="status">Đang tải hướng dẫn…</p>}
      {!project ? (
        <EmptyState
          title="Chưa có dự án"
          description="Tạo dự án trước khi thiết lập hướng dẫn chuẩn bị."
        />
      ) : (
        <>
          <section className="surface stack">
            <h3>Soạn phiên bản mới</h3>
            <p>
              Mỗi lần lưu tạo một bản nháp bất biến. Người có quyền pháp chế khác người soạn phải rà
              soát trước khi áp dụng.
            </p>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = PreparationChecklistSchema.safeParse(input);
                if (!parsed.success) {
                  setError(
                    'Kiểm tra tên, hướng dẫn, nguồn và ngày hiệu lực; chọn ít nhất một mục mỗi nhóm.',
                  );
                  return;
                }
                run(async () => {
                  await request('projects/' + project + '/preparation-checklists', parsed.data);
                  setInput(empty());
                });
              }}
            >
              <label>
                Tên hướng dẫn
                <input
                  className="search-input"
                  required
                  minLength={5}
                  maxLength={200}
                  value={input.title}
                  onChange={(e) => setInput({ ...input, title: e.target.value })}
                />
              </label>
              <label>
                Phạm vi và hướng dẫn chuẩn bị
                <textarea
                  className="search-input"
                  required
                  minLength={20}
                  maxLength={3000}
                  rows={4}
                  value={input.instructions}
                  onChange={(e) => setInput({ ...input, instructions: e.target.value })}
                  placeholder="Nêu rõ đây là checklist chuẩn bị chung, giấy tờ cần xin xác nhận và trường hợp phải hỏi pháp chế."
                />
              </label>
              <label>
                Nguồn đối chiếu / mã tài liệu nội bộ
                <input
                  className="search-input"
                  required
                  minLength={5}
                  maxLength={1000}
                  value={input.sourceReference}
                  onChange={(e) => setInput({ ...input, sourceReference: e.target.value })}
                />
              </label>
              <div className="form-grid">
                <label>
                  Áp dụng từ
                  <input
                    className="search-input"
                    type="date"
                    required
                    value={input.effectiveFrom}
                    onChange={(e) => setInput({ ...input, effectiveFrom: e.target.value })}
                  />
                </label>
                <label>
                  Áp dụng đến (nếu có)
                  <input
                    className="search-input"
                    type="date"
                    min={input.effectiveFrom}
                    value={input.effectiveTo ?? ''}
                    onChange={(e) => setInput({ ...input, effectiveTo: e.target.value || null })}
                  />
                </label>
              </div>
              <fieldset className="stack">
                <legend>Nhóm giấy tờ cần chuẩn bị</legend>
                <p>
                  Loại giấy tờ do người tải tự khai. Tệp qua quét an toàn chưa chứng minh danh tính,
                  nội dung hay xác nhận pháp lý.
                </p>
                {(['any', ...preparationDocumentTypes] as const).map((type) => (
                  <label className="check-row" key={type}>
                    <input
                      type="checkbox"
                      checked={input.documentTypes.includes(type)}
                      onChange={() => toggleDocument(type)}
                    />
                    {labels[type]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="stack">
                <legend>Biểu mẫu trong checklist</legend>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={input.formIds.includes('any')}
                    onChange={() => toggleForm('any')}
                  />
                  Ít nhất một PDF đã kiểm tra (mục chung, chưa phải đủ bộ)
                </label>
                {catalog.map((f) => (
                  <label className="check-row" key={f.id}>
                    <input
                      type="checkbox"
                      checked={input.formIds.includes(f.id)}
                      onChange={() => toggleForm(f.id)}
                    />
                    {f.title}
                  </label>
                ))}
                <p>
                  Chỉ PDF được người khai kiểm tra theo bản khai hiện tại và ánh xạ/hướng dẫn còn
                  hiệu lực được tính. Việc chọn mẫu ở đây không tự tạo hoặc duyệt ánh xạ.
                </p>
              </fieldset>
              <Button disabled={busy || loading}>Lưu phiên bản nháp</Button>
            </form>
          </section>
          <section className="surface stack">
            <h3>Lịch sử hướng dẫn</h3>
            {!rows.length && !loading && (
              <EmptyState
                title="Chưa có hướng dẫn dự án"
                description="Khách đang dùng checklist chuẩn bị chung, không phải bộ hồ sơ pháp lý đầy đủ."
              />
            )}
            {rows.map((r) => (
              <article className="member-card stack" key={r.id}>
                <div>
                  <span className={'status-badge ' + (r.status === 'approved' ? 'green' : 'amber')}>
                    {r.status === 'approved'
                      ? 'Đã duyệt'
                      : r.status === 'revoked'
                        ? 'Đã thu hồi'
                        : 'Chờ duyệt độc lập'}
                  </span>
                  <h4>
                    {r.title} · phiên bản {r.version}
                  </h4>
                  <p>{r.instructions}</p>
                </div>
                <dl>
                  <dt>Nguồn đối chiếu</dt>
                  <dd>{r.sourceReference}</dd>
                  <dt>Hiệu lực</dt>
                  <dd>
                    {r.effectiveFrom}
                    {r.effectiveTo ? ' đến ' + r.effectiveTo : ''}
                  </dd>
                  <dt>Giấy tờ</dt>
                  <dd>{r.documentTypes.map((t) => labels[t]).join(' · ')}</dd>
                  <dt>Biểu mẫu</dt>
                  <dd>
                    {r.formIds
                      .map((id) =>
                        id === 'any'
                          ? 'Ít nhất một PDF hiện hành'
                          : (catalog.find((f) => f.id === id)?.title ?? id),
                      )
                      .join(' · ')}
                  </dd>
                </dl>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setInput({
                      title: r.title,
                      instructions: r.instructions,
                      sourceReference: r.sourceReference,
                      effectiveFrom: new Date().toISOString().slice(0, 10),
                      effectiveTo: null,
                      documentTypes: [...r.documentTypes],
                      formIds: [...r.formIds],
                    });
                    setMessage(
                      'Đã sao chép vào vùng soạn; lưu sẽ tạo phiên bản mới, không sửa bản cũ.',
                    );
                  }}
                >
                  Sao chép để soạn phiên bản mới
                </Button>
                {r.status !== 'revoked' && (
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() =>
                        request(
                          'projects/' + project + '/preparation-checklists/' + r.id + '/review',
                          { action: r.status === 'draft' ? 'approve' : 'revoke', accepted: true },
                        ),
                      );
                    }}
                  >
                    <label className="check-row">
                      <input
                        type="checkbox"
                        required
                        disabled={busy || staff?.subject === r.created_by}
                      />
                      Tôi đã rà soát phạm vi, nguồn, danh mục và thời hạn. Tôi không phải người soạn
                      hướng dẫn này.
                    </label>
                    <Button
                      disabled={
                        busy ||
                        staff?.subject === r.created_by ||
                        Boolean(staff && !staff.permissions?.includes('form_legal_approver'))
                      }
                    >
                      {r.status === 'draft' ? 'Duyệt hướng dẫn chuẩn bị' : 'Thu hồi hướng dẫn'}
                    </Button>
                  </form>
                )}
              </article>
            ))}
          </section>
          <p className="help-note">
            Bản bị thu hồi, hết hiệu lực hoặc bị thay thế không được tự lùi về bản cũ để tính hoàn
            thành. Lịch sử đánh giá giữ nguyên chứng cứ và phiên bản tại lúc ghi nhận. Checklist này
            chưa thay thế danh mục pháp lý riêng cho từng nhóm đối tượng và hình thức mua, thuê mua,
            thuê.
          </p>
        </>
      )}
    </div>
  );
}
