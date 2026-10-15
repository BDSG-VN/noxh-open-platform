'use client';
import { useEffect, useState } from 'react';
export default function PrivacyBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/api/workflow/citizen/privacy', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => {
        if (active) setShow(!w?.accepted || w?.restricted);
      })
      .catch(() => {
        if (active) setShow(true);
      });
    return () => {
      active = false;
    };
  }, []);
  return show ? (
    <p className="feedback">
      <a href="/privacy">
        <strong>Kiểm tra lựa chọn bảo vệ dữ liệu →</strong>
      </a>
      <br />
      Đọc thông báo và ghi nhận lựa chọn để tiếp tục gửi thông tin hồ sơ.
    </p>
  ) : null;
}
