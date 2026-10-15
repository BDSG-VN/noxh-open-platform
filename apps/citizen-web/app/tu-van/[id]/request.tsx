'use client';
import { useState } from 'react';
import { Button } from '@noxh/ui';
export default function ConsultationForm({
  campaignId,
  partnerName,
  loggedIn,
}: {
  campaignId: string;
  partnerName: string;
  loggedIn: boolean;
}) {
  const [accepted, setAccepted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [sent, setSent] = useState(false);
  if (!loggedIn)
    return (
      <>
        <h2>Đăng ký nhận tư vấn</h2>
        <p>Xác thực số điện thoại để kiểm soát liên hệ và theo dõi yêu cầu của bạn.</p>
        <a className="button button-primary" href={'/login?next=/tu-van/' + campaignId}>
          Đăng nhập để đăng ký tư vấn →
        </a>
      </>
    );
  if (sent)
    return (
      <div role="status">
        <h2>Đã gửi yêu cầu tư vấn</h2>
        <p>
          {partnerName} đã nhận được liên hệ bạn đồng ý chia sẻ. Bạn có thể theo dõi hoặc dừng chia
          sẻ từ bảng điều khiển khách hàng.
        </p>
        <a className="text-button" href="/dashboard#tu-van">
          Xem yêu cầu của tôi →
        </a>
      </div>
    );
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
          const r = await fetch('/api/workflow/citizen/consultations/' + campaignId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fullName: f.get('fullName'),
              message: f.get('message'),
              accepted,
            }),
          });
          const v = await r.json();
          if (!r.ok) throw new Error(v.detail ?? 'Chưa gửi được');
          setSent(true);
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Không kết nối được');
          setBusy(false);
        }
      }}
    >
      <span className="kicker">LIÊN HỆ RIÊNG TƯ</span>
      <h2>Nhận tư vấn từ {partnerName}</h2>
      <label>
        Họ và tên
        <input
          className="search-input"
          name="fullName"
          required
          maxLength={200}
          autoComplete="name"
        />
      </label>
      <label>
        Nội dung cần tư vấn
        <textarea
          className="search-input"
          name="message"
          required
          rows={6}
          maxLength={2000}
          placeholder="Mô tả câu hỏi về dự án hoặc cách chuẩn bị hồ sơ. Không gửi số giấy tờ hoặc tài liệu nhạy cảm."
        />
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
        <span>
          Tôi đồng ý chia sẻ họ tên, số điện thoại đã xác thực và nội dung yêu cầu này với{' '}
          {partnerName}, để nhân viên được phân công liên hệ tư vấn. Tôi có thể dừng chia sẻ trong
          bảng điều khiển; đây không phải đồng ý nhận quảng cáo đại trà.
        </span>
      </label>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <Button disabled={busy || !accepted}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu tư vấn'}</Button>
    </form>
  );
}
