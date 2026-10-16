'use client';
import { useEffect, useState } from 'react';
/** RFC 6238 TOTP in the browser from a PUBLIC demo secret; never used for real accounts. */
function base32(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('Không phải Base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return bytes;
}
async function totp(secret: string, at = Date.now()) {
  const key = await crypto.subtle.importKey(
    'raw',
    base32(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counter = new ArrayBuffer(8);
  new DataView(counter).setUint32(4, Math.floor(at / 30000));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1]! & 15;
  const code =
    (((mac[offset]! & 127) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) %
    1000000;
  return String(code).padStart(6, '0');
}
export default function DemoTotp({ secret }: { secret: string }) {
  const [code, setCode] = useState('······');
  const [left, setLeft] = useState(30);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      const now = Date.now();
      setLeft(30 - Math.floor((now / 1000) % 30));
      try {
        const next = await totp(secret, now);
        if (active) setCode(next);
      } catch {
        if (active) setCode('lỗi');
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [secret]);
  return (
    <p role="status">
      Mã xác thực hai bước hiện tại: <strong style={{ fontSize: 22 }}>{code}</strong>{' '}
      <small>
        (đổi sau {left}s; bí mật TOTP demo: <code>{secret}</code>)
      </small>
    </p>
  );
}
