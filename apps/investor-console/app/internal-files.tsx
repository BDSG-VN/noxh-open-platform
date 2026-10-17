'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import { departments, departmentLabels } from '@noxh/contracts';
import type { OperationsStaff } from './operations-admin';
interface InternalFile {
  id: string;
  name: string;
  department: (typeof departments)[number];
  classification: string;
  created_by: string;
  scan_status: string;
  sha256: string;
  reference: string;
  bytes: number;
  created_at: string;
}
async function call(path: string, body?: unknown, signal?: AbortSignal) {
  const r = await fetch('/api/admin/operations/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Không thực hiện được');
  return v;
}
export default function InternalFiles({
  projectId,
  staff,
  onSelect,
}: {
  projectId: string;
  staff: OperationsStaff;
  onSelect?: (f: { reference: string; sha256: string; classification: 'restricted' }) => void;
}) {
  const [items, setItems] = useState<InternalFile[]>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [scanner, setScanner] = useState(false),
    [uploading, setUploading] = useState(false),
    [selected, setSelected] = useState<InternalFile>();
  const upload = useRef<AbortController | null>(null);
  const writable =
    staff.role === 'org_admin' || Boolean(staff.permissions?.includes('records_write'));
  const base = 'projects/' + projectId + '/files';
  async function load() {
    const v = await call(base);
    setItems(v.items);
    setScanner(v.scannerConfigured);
  }
  useEffect(() => {
    setItems(undefined);
    setSelected(undefined);
    load().catch((e) => setError(e.message));
  }, [projectId]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface dossier-process">
      <div className="surface-head">
        <div>
          <span className="kicker">LƯU TRỮ TỆP RIÊNG / THEO DỰ ÁN</span>
          <h2>Kho tệp hồ sơ và tài liệu</h2>
          <p className="section-subtitle">
            Tệp gốc được bảo vệ theo dự án, phòng ban và quyền truy cập.
          </p>
        </div>
      </div>
      <div className="surface-body stack">
        <p>
          Tải tệp, chờ quét an toàn rồi đính kèm vào một phiên bản tài liệu. Tệp chỉ mở cho tác giả
          và người có quyền đối với tài liệu liên quan. Người có quyền duyệt được xem tệp của bản
          chờ duyệt trong đúng phạm vi được phân công.
        </p>
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
        {items && !scanner && (
          <p className="help-note amber">
            Chưa cấu hình máy quét. Tệp mới nằm trong vùng cách ly và chưa được dùng làm tệp đính
            kèm đã kiểm tra.
          </p>
        )}
        {writable && (
          <form
            className="status-panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget),
                file = f.get('file') as File;
              run(async () => {
                if (!file || !file.size || file.size > 5 * 1024 * 1024)
                  throw new Error('Chọn PDF/JPEG/PNG tối đa 5 MiB');
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result).split(',')[1]!);
                  reader.onerror = () => reject(new Error('Không đọc được tệp'));
                  reader.readAsDataURL(file);
                });
                const controller = new AbortController();
                upload.current = controller;
                setUploading(true);
                try {
                  await call(
                    base,
                    {
                      name: file.name,
                      mime: file.type,
                      base64,
                      department:
                        staff.role === 'org_admin' ? f.get('department') : staff.department,
                      classification: 'restricted',
                    },
                    controller.signal,
                  );
                } catch (e) {
                  if (controller.signal.aborted)
                    throw new Error('Đã hủy tải lên. Tệp chưa được lưu.');
                  throw e;
                } finally {
                  upload.current = null;
                  setUploading(false);
                }
                setMessage(
                  'Đã lưu tệp vào kho riêng; chỉ dùng sau khi trạng thái quét an toàn thành công.',
                );
              });
            }}
          >
            <div>
              <span className="kicker">01 / BỔ SUNG TỆP GỐC</span>
              <h3>Tải phiên bản tệp mới</h3>
              <p>PDF tĩnh tối đa 20 trang hoặc ảnh JPG, PNG. Mỗi tệp tối đa 5 MiB.</p>
            </div>
            <label>
              Phòng ban quản lý
              <select
                className="search-input"
                name="department"
                disabled={staff.role !== 'org_admin'}
                defaultValue={staff.department ?? 'project_office'}
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabels[d]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              PDF tĩnh tối đa 20 trang hoặc ảnh, tối đa 5 MiB
              <input
                className="search-input"
                type="file"
                name="file"
                accept="application/pdf,image/jpeg,image/png"
                required
              />
            </label>
            <label className="check-row">
              <input type="checkbox" required />
              Tôi có thẩm quyền lưu trữ tệp, đã kiểm tra nội dung và chỉ đưa dữ liệu cá nhân cần
              thiết theo chính sách dự án.
            </label>
            <Button disabled={busy}>{uploading ? 'Đang tải lên…' : 'Tải vào kho mã hóa'}</Button>
            {uploading && (
              <p className="feedback" role="status" aria-live="polite">
                Đang tải tệp vào kho mã hóa, vui lòng đợi.{' '}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => upload.current?.abort()}
                >
                  Hủy tải lên
                </button>
              </p>
            )}
          </form>
        )}
        {!items && !error && <p role="status">Đang tải kho hồ sơ…</p>}
        {items && !items.length && (
          <EmptyState
            title="Chưa có tệp trong phạm vi của bạn"
            description="Người soạn tải tệp, đợi quét và gắn vào phiên bản tài liệu; nhân sự khác đọc theo quyền tài liệu đã duyệt."
          />
        )}
        {items?.map((f) => (
          <article key={f.id} className="member-card">
            <span className="status-badge">
              {f.scan_status === 'clean'
                ? 'Đã quét an toàn'
                : f.scan_status === 'rejected'
                  ? 'Bị từ chối'
                  : 'Đang cách ly'}
            </span>
            <h3>{f.name}</h3>
            <p>
              {departmentLabels[f.department]} · Hạn chế · {Math.ceil(f.bytes / 1024)} KiB ·{' '}
              {new Date(f.created_at).toLocaleString('vi-VN')}
            </p>
            <details>
              <summary>Nguồn gốc và mã kiểm chứng</summary>
              <p>Mã tệp: {f.reference}</p>
              <p>
                SHA256: <code>{f.sha256}</code>
              </p>
              <p>Đổi tệp bằng cách tải phiên bản mới; liên kết các bản cũ được lưu để đối chiếu.</p>
            </details>
            <div className="button-row">
              {f.scan_status === 'clean' && (
                <>
                  <a
                    className="text-button"
                    href={'/api/admin/operations/' + base + '/' + f.id + '/download'}
                  >
                    Tải tệp
                  </a>
                  {writable && f.created_by === staff.subject && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(f);
                        onSelect?.({
                          reference: f.reference,
                          sha256: f.sha256,
                          classification: 'restricted',
                        });
                        setMessage(
                          'Dùng mã tham chiếu và SHA256 bên dưới khi soạn tài liệu, chọn phân loại Hạn chế.',
                        );
                      }}
                    >
                      Dùng cho phiên bản tài liệu
                    </Button>
                  )}
                </>
              )}
              {writable && f.created_by === staff.subject && f.scan_status === 'quarantined' && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() => run(() => call(base + '/' + f.id + '/scan', {}))}
                >
                  Yêu cầu quét lại
                </Button>
              )}
            </div>
          </article>
        ))}
        {selected && (
          <div className="status-panel stack">
            <span className="kicker">02 / GẮN VÀO TÀI LIỆU</span>
            <h3>Tệp đã chọn: {selected.name}</h3>
            <label>
              Mã tham chiếu tệp (điền vào phiên bản tài liệu)
              <input className="search-input" readOnly value={selected.reference} />
            </label>
            <label>
              SHA256 tệp
              <input className="search-input" readOnly value={selected.sha256} />
            </label>
            <p>
              Chọn phân loại <strong>Hạn chế</strong> khi soạn. Máy chủ đối chiếu đúng dự án, quyền
              truy cập, trạng thái quét và mã kiểm trước khi lưu liên kết. Mỗi lần thay tệp phải tải
              mới và tạo phiên bản tài liệu mới.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
