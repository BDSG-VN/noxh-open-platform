'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
interface Item {
  id: string;
  status: string;
  version: number;
  created_at: string;
  partner_name: string;
  project_name: string;
  campaign_name: string;
}
const statuses: Record<string, string> = {
  new: 'Chờ tư vấn',
  contacting: 'Đang tư vấn',
  waiting: 'Chờ bổ sung thông tin',
  closed: 'Đã kết thúc',
  withdrawn: 'Đã dừng chia sẻ',
};
export default function Consultations() {
  const [items, setItems] = useState<Item[]>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch('/api/workflow/citizen/consultations')
      .then(async (r) => {
        if (!r.ok) throw new Error('Chưa tải được yêu cầu tư vấn');
        const v = await r.json();
        if (live) setItems(v.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <section className="surface" id="tu-van">
      <div className="surface-head">
        <div>
          <h2 className="section-title">Yêu cầu tư vấn của tôi</h2>
          <p className="section-subtitle">Kiểm soát thông tin liên hệ đã chia sẻ cho đối tác</p>
        </div>
      </div>
      <div className="surface-body">
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {items?.length ? (
          items.map((i) => (
            <article className="member-card" key={i.id}>
              <span className={'status-badge ' + (i.status === 'withdrawn' ? '' : 'green')}>
                {statuses[i.status]}
              </span>
              <h3>{i.partner_name}</h3>
              <p>{i.project_name}</p>
              <p className="section-subtitle">{i.campaign_name}</p>
              <small>Gửi {new Date(i.created_at).toLocaleString('vi-VN')}</small>
              {i.status !== 'withdrawn' && (
                <p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        !window.confirm(
                          'Dừng chia sẻ liên hệ trong hệ thống với ' +
                            i.partner_name +
                            '? Đối tác sẽ không còn mở được yêu cầu này.',
                        )
                      )
                        return;
                      setBusy(true);
                      setError('');
                      try {
                        const r = await fetch('/api/workflow/citizen/consultations/' + i.id, {
                          method: 'DELETE',
                          headers: {
                            'Content-Type': 'application/json',
                            'If-Match': String(i.version),
                          },
                          body: '{}',
                        });
                        const v = await r.json();
                        if (!r.ok) throw new Error(v.detail ?? 'Không dừng được');
                        setItems(
                          items.map((v) =>
                            v.id === i.id
                              ? { ...v, status: 'withdrawn', version: v.version + 1 }
                              : v,
                          ),
                        );
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Không xử lý được');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Dừng chia sẻ liên hệ
                  </Button>
                </p>
              )}
            </article>
          ))
        ) : (
          <EmptyState
            title={items ? 'Bạn chưa gửi yêu cầu tư vấn' : 'Đang tải yêu cầu…'}
            description="Khi đăng ký qua trang chiến dịch của đối tác, yêu cầu của bạn sẽ xuất hiện tại đây."
          />
        )}
      </div>
    </section>
  );
}
