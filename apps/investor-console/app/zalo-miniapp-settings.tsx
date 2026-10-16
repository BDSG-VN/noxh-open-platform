'use client';
import { useEffect, useState } from 'react';
import type { ZaloIdentitySettings } from '@noxh/contracts';
import { Button } from '@noxh/ui';
export default function ZaloMiniAppSettings() {
  const [data, setData] = useState<ZaloIdentitySettings>(),
    [enabled, setEnabled] = useState(false),
    [appId, setAppId] = useState(''),
    [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  async function load() {
    const response = await fetch('/api/admin/settings/zalo-miniapp', { cache: 'no-store' });
    const b = await response.json();
    if (!response.ok) throw new Error(b.detail ?? 'Chưa tải được cấu hình Mini App.');
    setData(b);
    setEnabled(b.enabled);
    setAppId(b.appId);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="surface dossier-process stack">
      <header>
        <span className="kicker">ĐỊNH DANH / ZALO MINI APP</span>
        <h2>Đăng nhập và liên kết tài khoản</h2>
        <p>
          Cấu hình Zalo App ID và App Secret riêng cho Mini App. Không dùng mặc định khóa OA/ZBS gửi
          mã điện thoại nếu hai ứng dụng khác nhau.
        </p>
      </header>
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
      {data && !data.deploymentEnabled && (
        <p className="help-note">
          Hạ tầng chưa bật ZALO_MINIAPP_ENABLED. Có thể chuẩn bị cấu hình tắt; chưa nhận đăng nhập
          thật.
        </p>
      )}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!data) return;
          setBusy(true);
          setError('');
          setMessage('');
          try {
            const response = await fetch('/api/admin/settings/zalo-miniapp', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json', 'If-Match': String(data.version) },
              body: JSON.stringify({ enabled, appId, ...(secret ? { appSecret: secret } : {}) }),
            });
            const b = await response.json();
            if (!response.ok) throw new Error(b.detail ?? 'Chưa lưu được cấu hình.');
            setSecret('');
            await load();
            setMessage(
              'Đã cập nhật. Các phiên và yêu cầu liên kết Zalo cũ đã được thu hồi; phiên điện thoại giữ nguyên.',
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Chưa lưu được.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="check-row">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!data?.deploymentEnabled || busy}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Bật đăng nhập Mini App sau khi ứng dụng và quyền tích hợp được duyệt
        </label>
        <label>
          Zalo App ID (khác Mini App ID)
          <input
            className="search-input"
            required
            inputMode="numeric"
            pattern="[0-9]{1,30}"
            maxLength={30}
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
        </label>
        <label>
          App Secret mới{data?.hasSecret ? ' (để trống để giữ khóa hiện tại)' : ''}
          <input
            className="search-input"
            type="password"
            autoComplete="new-password"
            required={!data?.hasSecret || appId !== data.appId}
            minLength={20}
            maxLength={512}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <p>
          Khóa được mã hóa trên máy chủ, không trả về giao diện. Mỗi lần đổi cấu hình sẽ tăng phiên
          bản và buộc các phiên Zalo đăng nhập lại. Token ứng dụng không phải giấy tờ xác nhận danh
          tính pháp lý.
        </p>
        <Button disabled={busy || !data}>{busy ? 'Đang lưu…' : 'Lưu cấu hình Mini App'}</Button>
      </form>
    </section>
  );
}
