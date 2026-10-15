'use client';
import { useState } from 'react';
import { Button, PageHeading } from '@noxh/ui';
import type { PrivacyWorkspace } from '@noxh/contracts';
export const noticeLabels: Record<string, string> = {
  controller: 'Bên kiểm soát dữ liệu',
  contact: 'Đầu mối bảo vệ dữ liệu',
  purposes: 'Mục đích xử lý',
  categories: 'Loại dữ liệu',
  legalBasis: 'Căn cứ xử lý',
  recipients: 'Bên nhận và bên xử lý',
  retention: 'Thời hạn lưu và xóa',
  transfers: 'Chuyển dữ liệu ra nước ngoài',
  safeguards: 'Biện pháp bảo vệ và xử lý sự cố',
  rights: 'Quyền và cách thực hiện',
  consequences: 'Lựa chọn và hệ quả khi từ chối',
  governance: 'Hồ sơ quản trị và trách nhiệm chủ đầu tư',
};
export default function PrivacyCenter({
  initial,
  authenticated,
}: {
  initial: PrivacyWorkspace;
  authenticated: boolean;
}) {
  const [data, setData] = useState(initial),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function act(path: string, body: unknown = {}, method = 'POST') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await fetch('/api/workflow/citizen/privacy/' + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.detail);
      const w = await fetch('/api/workflow/citizen/privacy', { cache: 'no-store' });
      if (!w.ok) throw new Error('Hãy tải lại trạng thái');
      setData(await w.json());
      setChecked(false);
      setMessage('Đã ghi nhận lựa chọn của bạn.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không kết nối được');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack privacy-center">
      <PageHeading
        eyebrow="DỮ LIỆU CỦA BẠN"
        title="Quyền riêng tư & lựa chọn"
        description="Bạn quyết định việc chia sẻ. Gửi sang OpenAI, tư vấn đối tác và marketing cần các lựa chọn riêng; đồng ý ở đây không bật những mục đó."
      />
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
      {data.notice ? (
        <section className="surface">
          <div className="surface-head">
            <h2>Thông báo bảo vệ dữ liệu</h2>
            <span className="status-badge blue">Phiên bản {data.notice.version}</span>
          </div>
          <div className="surface-body stack">
            {Object.entries(noticeLabels).map(([key, label]) => (
              <div key={key}>
                <h3>{label}</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>
                  {String(data.notice![key as keyof typeof data.notice] ?? '')}
                </p>
              </div>
            ))}
            <details>
              <summary>Phiên bản và mã kiểm chứng nội dung</summary>{' '}
              <code style={{ overflowWrap: 'anywhere' }}>{data.notice.content_hash}</code>
            </details>
            {authenticated && (
              <>
                <p className="status-badge">
                  {data.accepted
                    ? 'Đã đồng ý phiên bản hiện hành'
                    : 'Chưa đồng ý phiên bản hiện hành'}
                </p>
                {!data.accepted && (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                      />
                      Tôi đã đọc và đồng ý xử lý dữ liệu để chuẩn bị hồ sơ theo thông báo này.
                    </label>
                    <Button
                      disabled={busy || !checked}
                      onClick={() =>
                        act('consent', {
                          noticeId: data.notice!.id,
                          contentHash: data.notice!.content_hash,
                          accepted: true,
                        })
                      }
                    >
                      Ghi nhận đồng ý
                    </Button>
                  </>
                )}
                {data.accepted && (
                  <Button variant="outline" disabled={busy} onClick={() => act('withdraw')}>
                    Rút lại đồng ý xử lý hồ sơ
                  </Button>
                )}
                <p>
                  Rút lại sẽ dừng ghi thêm hồ sơ và thu hồi chia sẻ đối tác đang có. Dữ liệu đã xử
                  lý hoặc thuộc nghĩa vụ lưu trữ pháp lý cần được chủ đầu tư giải quyết riêng; thao
                  tác này không tự xóa hồ sơ pháp lý.
                </p>
              </>
            )}
            {!authenticated && (
              <a className="button-link" href="/login">
                Đăng nhập để quản lý lựa chọn
              </a>
            )}
          </div>
        </section>
      ) : (
        <div className="feedback">
          Chủ đầu tư chưa công bố thông báo đã được duyệt. Hệ thống chặn gửi thêm thông tin hồ sơ
          đến khi có thông báo và sự đồng ý hợp lệ.
        </div>
      )}
      {authenticated && (
        <>
          <section className="surface">
            <div className="surface-body stack">
              <h2>Hạn chế xử lý</h2>
              <p>
                {data.restricted
                  ? 'Đang hạn chế xử lý: bạn vẫn có thể xem thông tin và gửi yêu cầu quyền dữ liệu.'
                  : 'Bạn có thể tạm dừng gửi thêm thông tin và các thao tác AI trong tài khoản.'}
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act('restriction', { restricted: !data.restricted }, 'PUT')}
              >
                {data.restricted ? 'Cho phép tiếp tục xử lý' : 'Hạn chế xử lý dữ liệu'}
              </Button>
            </div>
          </section>
          <section className="surface">
            <div className="surface-body stack">
              <h2>Thực hiện quyền dữ liệu</h2>
              <form
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act('requests', { kind: f.get('kind'), message: f.get('message') });
                }}
              >
                <label>
                  Loại yêu cầu
                  <select name="kind" className="search-input">
                    {[
                      ['access', 'Truy cập / nhận bản sao'],
                      ['rectify', 'Chỉnh sửa'],
                      ['erase', 'Yêu cầu xóa'],
                      ['restrict', 'Yêu cầu hạn chế'],
                      ['object', 'Phản đối xử lý'],
                      ['complaint', 'Khiếu nại về dữ liệu'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Nội dung
                  <textarea
                    name="message"
                    className="search-input"
                    required
                    minLength={5}
                    maxLength={2000}
                  />
                </label>
                <Button disabled={busy}>Gửi đầu mối bảo vệ dữ liệu</Button>
              </form>
              <p>
                Không gửi mật khẩu, mã OTP hoặc ảnh giấy tờ vào nội dung yêu cầu. Phản hồi trên hệ
                thống là dấu vết giải quyết, không tự chứng minh dữ liệu đã được xóa ở mọi bên xử
                lý.
              </p>
              {data.requests.map((r) => (
                <article key={r.id} className="status-panel">
                  <strong>
                    {r.kind} · {r.status}
                  </strong>
                  <p>{r.message}</p>
                  <p>{r.reply ?? 'Đang chờ đầu mối bảo vệ dữ liệu tiếp nhận.'}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
