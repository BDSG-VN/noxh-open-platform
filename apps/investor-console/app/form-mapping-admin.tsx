'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import type { MappingField } from '@noxh/contracts';
interface Mapping {
  id: string;
  version: number;
  status: string;
  source_hash: string;
  payload: { title: string; fields: unknown[] };
  created_by: string;
}
async function request(path: string, body?: unknown) {
  const r = await fetch('/api/admin/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Không thực hiện được');
  return v;
}
export function FormMappingAdmin({ projects }: { projects: { id: string; name: string }[] }) {
  const [project, setProject] = useState(projects[0]?.id ?? ''),
    [rows, setRows] = useState<Mapping[]>([]),
    [releases, setReleases] = useState<
      { id: string; title: string; status: string; form_id: string }[]
    >([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [fields, setFields] = useState<MappingField[]>([
      {
        key: 'fullName',
        label: 'Họ và tên',
        page: 1,
        x: 150,
        y: 610,
        width: 320,
        height: 24,
        fontSize: 11,
        required: true,
        externalConfirmation: false,
      },
    ]);
  function updateField(index: number, patch: Partial<MappingField>) {
    setFields((current) =>
      current.map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }
  async function load() {
    if (!project) return;
    const [m, r] = await Promise.all([
      request('projects/' + project + '/form-mappings'),
      request('projects/' + project + '/forms'),
    ]);
    setRows(m.items);
    setReleases(r.items);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [project]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      setMessage('Đã lưu. Chỉ bản được người pháp chế khác người soạn duyệt mới dùng cho khách.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dossier-process stack">
      <header>
        <span className="kicker">PHÁP CHẾ / BIỂU MẪU HỒ SƠ</span>
        <h2>Thiết lập vị trí điền trên mẫu nguồn</h2>
        <p>
          Quản lý phiên bản biểu mẫu để khách hàng điền đúng vị trí, giữ nguyên lời văn của mẫu
          nguồn.
        </p>
      </header>
      <div className="metric-grid">
        <div className="metric">
          <span>Đã duyệt cấu hình</span>
          <strong>{rows.filter((r) => r.status === 'approved').length}</strong>
          <small>Còn cần kiểm tra thời hạn áp dụng</small>
        </div>
        <div className="metric">
          <span>Chờ pháp chế</span>
          <strong>{rows.filter((r) => r.status === 'draft').length}</strong>
          <small>Người duyệt khác người soạn</small>
        </div>
        <div className="metric">
          <span>Đã thu hồi</span>
          <strong>{rows.filter((r) => r.status === 'revoked').length}</strong>
          <small>Lưu lại lịch sử đối chiếu</small>
        </div>
        <div className="metric">
          <span>Hướng dẫn đã duyệt</span>
          <strong>{releases.filter((r) => r.status === 'approved').length}</strong>
          <small>Nguồn để tạo cấu hình mới</small>
        </div>
      </div>
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
      <label>
        Dự án
        <select
          className="search-input"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          {projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <details className="surface">
        <summary>Soạn cấu hình điền mẫu mới</summary>
        <p>
          Chọn hướng dẫn nguồn, xác định từng ô điền, sau đó tải PDF xem trước và chuyển người có
          quyền pháp chế duyệt.
        </p>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            run(() =>
              request('projects/' + project + '/form-mappings', {
                releaseId: d.get('release'),
                title: d.get('title'),
                effectiveFrom: d.get('from'),
                effectiveTo: d.get('to') || null,
                fields,
                reviewedCoordinates: true,
              }),
            );
          }}
        >
          <h3>Thông tin phiên bản</h3>
          <label>
            Hướng dẫn pháp lý đã duyệt
            <select className="search-input" name="release" required>
              <option value="">Chọn hướng dẫn</option>
              {releases
                .filter((r) => r.status === 'approved')
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {r.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Tên hiển thị cho khách hàng
            <input
              className="search-input"
              name="title"
              placeholder="Ví dụ: Đơn đăng ký mua nhà ở xã hội — đợt 1"
              required
              minLength={3}
              maxLength={200}
            />
          </label>
          <label>
            Hiệu lực từ
            <input className="search-input" type="date" name="from" required />
          </label>
          <label>
            Hiệu lực đến (nếu có)
            <input className="search-input" type="date" name="to" />
          </label>
          <div className="stack">
            <div>
              <h3>Các trường cần điền</h3>
              <p>
                Tọa độ tính bằng điểm PDF, từ góc dưới bên trái; trang bắt đầu từ 1. Các số minh họa
                bên dưới cần được đo lại trên mẫu đã chọn.
              </p>
            </div>
            {fields.map((field, index) => (
              <fieldset className="member-card stack" key={index}>
                <legend>
                  Trường {index + 1}: {field.label || 'Chưa đặt tên'}
                </legend>
                <div className="form-grid">
                  <label>
                    Tên trường hiển thị
                    <input
                      className="search-input"
                      value={field.label}
                      required
                      maxLength={160}
                      onChange={(e) => updateField(index, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    Mã trường dữ liệu
                    <input
                      className="search-input"
                      value={field.key}
                      required
                      pattern="[a-z][a-zA-Z0-9_]{0,59}"
                      onChange={(e) => updateField(index, { key: e.target.value })}
                    />
                    <small>Ví dụ: fullName, identityNumber</small>
                  </label>
                  {(['page', 'x', 'y', 'width', 'height', 'fontSize'] as const).map((key) => (
                    <label key={key}>
                      {
                        (
                          {
                            page: 'Trang',
                            x: 'Vị trí ngang (X)',
                            y: 'Vị trí dọc (Y)',
                            width: 'Chiều rộng ô',
                            height: 'Chiều cao ô',
                            fontSize: 'Cỡ chữ',
                          } as const
                        )[key]
                      }
                      <input
                        className="search-input"
                        type="number"
                        min={{ page: 1, x: 0, y: 0, width: 10, height: 8, fontSize: 6 }[key]}
                        max={
                          { page: 100, x: 2000, y: 2000, width: 2000, height: 1000, fontSize: 16 }[
                            key
                          ]
                        }
                        step={key === 'page' ? 1 : 0.5}
                        required
                        value={field[key]}
                        onChange={(e) => updateField(index, { [key]: Number(e.target.value) })}
                      />
                    </label>
                  ))}
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(index, { required: e.target.checked })}
                  />
                  Bắt buộc có dữ liệu trước khi xác nhận bản in
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={field.externalConfirmation}
                    onChange={(e) => updateField(index, { externalConfirmation: e.target.checked })}
                  />
                  Nội dung cần cơ quan hoặc đơn vị có thẩm quyền xác nhận
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={fields.length === 1}
                  onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
                >
                  Bỏ trường này
                </Button>
              </fieldset>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setFields((current) => [
                  ...current,
                  {
                    key: 'field' + (current.length + 1),
                    label: '',
                    page: 1,
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 20,
                    fontSize: 11,
                    required: false,
                    externalConfirmation: false,
                  },
                ])
              }
            >
              Thêm trường điền
            </Button>
            <details>
              <summary>Cấu trúc kỹ thuật để đối chiếu</summary>
              <pre>{JSON.stringify(fields, null, 2)}</pre>
            </details>
          </div>
          <label className="check-row">
            <input type="checkbox" required />
            Tôi đã đối chiếu các tọa độ với mẫu nguồn, không sửa lời văn, không điền vào chỗ
            ký/dấu/xác nhận thay cơ quan.
          </label>
          <Button disabled={busy}>Lưu bản chờ pháp chế duyệt</Button>
        </form>
      </details>
      <div>
        <h3>Các phiên bản đã lưu</h3>
        <p>
          Mỗi lần thay vị trí hoặc mẫu nguồn cần một phiên bản mới. Tải PDF để kiểm tra toàn bộ vị
          trí trước khi duyệt.
        </p>
      </div>
      {!rows.length && (
        <EmptyState
          title="Chưa có ánh xạ"
          description="Nguồn chính thức và hướng dẫn phải được duyệt trước. Ví dụ tọa độ trong ô nhập chỉ minh họa cấu trúc, không phải ánh xạ được xác nhận."
        />
      )}
      {rows.map((r) => (
        <article className="member-card" key={r.id}>
          <span className="status-badge">
            {{ draft: 'Chờ pháp chế duyệt', approved: 'Đã duyệt cấu hình', revoked: 'Đã thu hồi' }[
              r.status
            ] ?? r.status}{' '}
            · phiên bản {r.version}
          </span>
          <h3>{r.payload.title}</h3>
          <p>{r.payload.fields.length} trường điền · Dựa trên bản nguồn được khóa mã kiểm chứng</p>
          <p>
            <a
              className="text-button"
              href={'/api/admin/projects/' + project + '/form-mappings/' + r.id + '/preview'}
            >
              Tải PDF kiểm tra vị trí điền
            </a>
          </p>
          <details>
            <summary>Chi tiết cấu hình và mã nguồn đối chiếu</summary>
            <p>
              SHA256 mẫu nguồn: <code>{r.source_hash}</code>
            </p>
            <pre>{JSON.stringify(r.payload, null, 2)}</pre>
          </details>
          {r.status !== 'revoked' && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                run(() =>
                  request('projects/' + project + '/form-mappings/' + r.id + '/review', {
                    accepted: true,
                    action: r.status === 'draft' ? 'approve' : 'revoke',
                  }),
                );
              }}
            >
              <label className="check-row">
                <input type="checkbox" required />
                Tôi có quyền pháp chế, khác người soạn và đã rà soát mẫu/hiệu lực/toàn bộ vị trí
                điền.
              </label>
              <Button disabled={busy}>
                {r.status === 'draft' ? 'Duyệt ánh xạ' : 'Thu hồi ánh xạ'}
              </Button>
            </form>
          )}
        </article>
      ))}
    </div>
  );
}
