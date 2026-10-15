'use client';
import { useState } from 'react';
import { Button } from '@noxh/ui';
export function Logout() {
  return (
    <Button
      variant="outline"
      onClick={async () => {
        const r = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (r.ok) window.location.assign('/login');
        else window.alert('Chưa đăng xuất được, hãy thử lại');
      }}
    >
      Đăng xuất
    </Button>
  );
}
export function StartDossier({ projects }: { projects: { id: string; name: string }[] }) {
  const [id, setId] = useState(projects[0]?.id ?? ''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="status-panel">
      <h2>Chuẩn bị hồ sơ</h2>
      <label htmlFor="project-id">Dự án đã công bố</label>
      <select
        id="project-id"
        className="search-input"
        value={id}
        onChange={(e) => setId(e.target.value)}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button
        disabled={!id || busy}
        onClick={async () => {
          setBusy(true);
          const r = await fetch('/api/dossiers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: id }),
          });
          const b = await r.json();
          setBusy(false);
          if (r.ok) window.location.reload();
          else setMessage(b.detail ?? 'Không tạo được hồ sơ');
        }}
      >
        Tạo hồ sơ chuẩn bị
      </Button>
      {message && <p role="alert">{message}</p>}
      <p className="text-sm">
        Đây là bản nháp chuẩn bị, không phải đơn đã nộp chính thức. Luồng khai báo và giấy tờ đang
        tiếp tục phát triển.
      </p>
    </div>
  );
}
