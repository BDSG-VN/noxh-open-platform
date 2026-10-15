'use client';
import { useState } from 'react';
import { Button } from '@noxh/ui';
export default function LoginForm({ returnTo = '/dashboard' }: { returnTo?: string }) {
  const [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [accepted, setAccepted] = useState(false),
    [step, setStep] = useState<'phone' | 'code'>('phone'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retryAt, setRetryAt] = useState(0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await fetch('/api/auth/' + (step === 'phone' ? 'request' : 'verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(step === 'phone' ? { phone, accepted } : { code }),
      });
      const value = await result.json();
      if (!result.ok) throw new Error(value.detail ?? 'Không hoàn tất được xác thực');
      if (step === 'phone') {
        setStep('code');
        setRetryAt(Date.now() + 60000);
      } else window.location.assign(returnTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi kết nối');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="">
      {step === 'code' && <h2 style={{ fontSize: 18 }}>Nhập mã xác thực</h2>}
      {step === 'phone' ? (
        <>
          <label htmlFor="phone">Số điện thoại có tài khoản Zalo</label>
          <input
            id="phone"
            className="search-input"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09xx xxx xxx"
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            <span className="text-sm">
              Tôi đồng ý dùng số điện thoại để nhận mã xác thực đăng nhập. Không đăng ký nhận quảng
              cáo.
            </span>
          </label>
        </>
      ) : (
        <>
          <p>Mở Zalo và xem tin nhắn xác thực từ OA của chủ đầu tư. Mã có hiệu lực 5 phút.</p>
          <label htmlFor="otp">Mã xác thực gồm 6 chữ số</label>
          <input
            id="otp"
            className="search-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button className="w-full" type="submit" disabled={busy || (step === 'phone' && !accepted)}>
        {busy ? 'Đang xử lý…' : step === 'phone' ? 'Nhận mã qua Zalo' : 'Xác nhận và đăng nhập'}
      </Button>
      {step === 'code' && (
        <Button
          type="button"
          variant="ghost"
          className="mt-3"
          onClick={() => {
            if (Date.now() < retryAt) {
              setError('Vui lòng chờ ít nhất 60 giây trước khi xin mã mới');
              return;
            }
            setStep('phone');
            setCode('');
          }}
        >
          Đổi số hoặc yêu cầu mã mới
        </Button>
      )}
    </form>
  );
}
