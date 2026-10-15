'use client';
import { useEffect, useState } from 'react';
import { Button } from '@noxh/ui';
import type { PrivacyNotice, PrivacyRequest } from '@noxh/contracts';
const labels: Record<string, string> = {
  controller: 'Tên, địa chỉ bên kiểm soát dữ liệu',
  contact: 'Đầu mối phụ trách / email / điện thoại',
  purposes: 'Mục đích xử lý hồ sơ',
  categories: 'Loại dữ liệu, dữ liệu nhạy cảm, người liên quan',
  legalBasis: 'Căn cứ xử lý từng mục đích',
  recipients: 'Bên nhận, bên xử lý và phạm vi truy cập',
  retention: 'Thời hạn lưu, xóa và căn cứ giữ lại',
  transfers: 'Chuyển dữ liệu xuyên biên giới / OpenAI',
  safeguards: 'Biện pháp bảo vệ, xử lý và thông báo sự cố',
  rights: 'Cách thực hiện quyền, quy trình và thời hạn trả lời',
  consequences: 'Lựa chọn, hệ quả từ chối / rút lại',
  governance: 'Đầu mối, hồ sơ đánh giá tác động, thỏa thuận bên xử lý và kiểm tra',
};
async function call(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/admin/privacy/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail);
  return b;
}
export default function PrivacyAdmin({ citizenOrigin }: { citizenOrigin: string }) {
  const [items, setItems] = useState<PrivacyNotice[]>([]),
    [requests, setRequests] = useState<PrivacyRequest[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => setItems((await call('notices')).items);
  useEffect(() => {
    call('notices')
      .then((v) => setItems(v.items))
      .catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await refresh();
      setMessage('Đã lưu và ghi nhật ký.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const statuses: Record<string, string> = {
    draft: 'Chờ duyệt',
    approved: 'Đã công bố',
    revoked: 'Đã thu hồi',
    new: 'Mới tiếp nhận',
    processing: 'Đang giải quyết',
    responded: 'Đã phản hồi',
  };
  const kinds: Record<string, string> = {
    access: 'Truy cập / nhận bản sao',
    rectify: 'Chỉnh sửa dữ liệu',
    erase: 'Yêu cầu xóa',
    restrict: 'Hạn chế xử lý',
    object: 'Phản đối xử lý',
    complaint: 'Phản ánh về dữ liệu',
  };
  return (
    <div className="stack">
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
      <div className="feedback">
        Luật 91/2025/QH15 và NĐ 356/2025/NĐ-CP có hiệu lực từ 01/01/2026. Phần mềm hỗ trợ kiểm soát
        và lưu dấu vết; chủ đầu tư vẫn chịu trách nhiệm về căn cứ xử lý, nhân sự, đánh giá tác động,
        nhà cung cấp và thông báo sự cố theo trường hợp áp dụng.
      </div>
      <details className="surface">
        <summary className="surface-head">
          <strong>Soạn phiên bản thông báo mới</strong>
          <span className="text-button">Mở trình soạn</span>
        </summary>
        <form
          className="surface-body stack"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(async () => {
              await call(
                'notices',
                {
                  ...Object.fromEntries(Object.keys(labels).map((k) => [k, f.get(k)])),
                  reviewed: f.get('reviewed') === 'on',
                },
                'POST',
              );
            });
          }}
        >
          <div className="form-grid">
            {Object.entries(labels).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  name={key}
                  className="search-input"
                  required
                  minLength={key === 'controller' ? 3 : key === 'contact' ? 5 : 10}
                  maxLength={['controller', 'contact'].includes(key) ? 300 : 2000}
                />
              </label>
            ))}
          </div>
          <label className="checkbox-label">
            <input type="checkbox" name="reviewed" required />
            Tôi đã rà soát nội dung cụ thể của chủ đầu tư, không dùng tuyên bố chung thay cho nghĩa
            vụ pháp lý.
          </label>
          <Button disabled={busy}>Lưu phiên bản chờ người phụ trách duyệt</Button>
        </form>
      </details>
      <section className="surface">
        <div className="surface-head">
          <h2>Phiên bản và phê duyệt</h2>
          <a href={citizenOrigin + '/privacy'} target="_blank" rel="noopener noreferrer">
            Xem thông báo phía khách ↗
          </a>
        </div>
        <div className="surface-body stack">
          {!items.length && (
            <p>Chưa có thông báo. Các thao tác gửi thêm dữ liệu hồ sơ đang bị chặn.</p>
          )}
          {items.map((n) => (
            <article key={n.id} className="status-panel">
              <h3>
                Phiên bản {n.version} · {statuses[n.status] ?? n.status}
              </h3>
              <p>{n.controller}</p>
              <details>
                <summary>Đọc nội dung cần duyệt</summary>
                {Object.entries(labels).map(([k, l]) => (
                  <p key={k}>
                    <strong>{l}:</strong> {String(n[k as keyof PrivacyNotice])}
                  </p>
                ))}
                <code style={{ overflowWrap: 'anywhere' }}>{n.content_hash}</code>
              </details>
              {n.status !== 'revoked' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() =>
                      call(
                        'notices/' + n.id + '/review',
                        { action: n.status === 'draft' ? 'approve' : 'revoke', accepted: true },
                        'POST',
                      ),
                    );
                  }}
                >
                  <label className="checkbox-label">
                    <input required type="checkbox" />
                    Tôi là đầu mối bảo vệ dữ liệu được cấp quyền, đã kiểm tra trách nhiệm và là
                    người khác người soạn.
                  </label>
                  <Button variant="outline" disabled={busy}>
                    {n.status === 'draft' ? 'Duyệt và công bố' : 'Thu hồi thông báo'}
                  </Button>
                </form>
              )}
            </article>
          ))}
        </div>
      </section>
      <section className="surface">
        <div className="surface-head">
          <h2>Yêu cầu quyền dữ liệu</h2>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => run(async () => setRequests((await call('requests')).items))}
          >
            Mở hàng đợi phụ trách
          </Button>
        </div>
        <div className="surface-body stack">
          <p>
            Chỉ tài khoản có quyền privacy_officer được đọc nội dung. Trạng thái “đã phản hồi” không
            tự chứng minh việc xóa hoặc xuất dữ liệu đã hoàn tất.
          </p>
          {requests.map((r) => (
            <form
              key={r.id}
              className="status-panel stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(async () => {
                  await call(
                    'requests/' + r.id,
                    { status: f.get('status'), reply: f.get('reply') },
                    'PUT',
                    r.version,
                  );
                  setRequests((await call('requests')).items);
                });
              }}
            >
              <h3>
                {kinds[r.kind] ?? r.kind} · {statuses[r.status] ?? r.status}
              </h3>
              <small>{new Date(r.created_at).toLocaleString('vi-VN')}</small>
              <p>{r.message}</p>
              <label>
                Trạng thái
                <select name="status" className="search-input" defaultValue="processing">
                  <option value="processing">Đang giải quyết</option>
                  <option value="responded">Đã phản hồi</option>
                </select>
              </label>
              <label>
                Phản hồi, hành động đã thực hiện và căn cứ
                <textarea
                  name="reply"
                  className="search-input"
                  defaultValue={r.reply ?? ''}
                  required
                  maxLength={2000}
                />
              </label>
              <Button disabled={busy}>Lưu phản hồi</Button>
            </form>
          ))}
        </div>
      </section>
    </div>
  );
}
