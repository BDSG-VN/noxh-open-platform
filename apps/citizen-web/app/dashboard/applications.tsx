'use client';
import { useEffect, useState } from 'react';
import type { ApplicationRead } from '@noxh/contracts';
import { EmptyState } from '@noxh/ui';
import { applicationRequest, applicationStatuses } from '../applications/application-ui';
export default function Applications() {
  const [items, setItems] = useState<ApplicationRead[]>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    applicationRequest('citizen/applications')
      .then((v) => {
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
    <section className="surface" id="da-nop">
      <div className="surface-head">
        <div>
          <h2 className="section-title">Hồ sơ đã gửi và biên nhận</h2>
          <p className="section-subtitle">
            Theo dõi tiếp nhận, yêu cầu bổ sung, quyết định và đề nghị xem xét lại
          </p>
        </div>
      </div>
      <div className="surface-body">
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        {!items && !error && <p role="status">Đang tải hồ sơ tiếp nhận…</p>}
        {items && !items.length && (
          <EmptyState
            title="Bạn chưa gửi hồ sơ tiếp nhận"
            description="Mở hồ sơ chuẩn bị, hoàn thành bản khai/giấy tờ và mục Nộp hồ sơ khi dự án mở đợt tiếp nhận."
          />
        )}
        {items?.map((a) => (
          <article key={a.id} className="member-card">
            <span
              className={
                'status-badge ' +
                (a.status === 'approved' ? 'green' : a.status === 'supplement' ? 'amber' : '')
              }
            >
              {applicationStatuses[a.status] ?? a.status}
            </span>
            {a.synthetic && <span className="status-badge amber">DỮ LIỆU DEMO</span>}
            <h3>{a.project_name}</h3>
            <p>
              {a.round_name} · {new Date(a.submitted_at).toLocaleString('vi-VN')}
            </p>
            <p>
              <strong>Biên nhận:</strong> {a.receipt_code}
            </p>
            <a href={'/applications/' + a.id} className="text-button">
              Xem biên nhận và tiến độ →
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
