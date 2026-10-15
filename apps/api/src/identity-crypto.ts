import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
export function normalizePhone(input: unknown) {
  if (typeof input !== 'string' || input.length > 24 || !/^\+?[0-9 ().-]+$/.test(input))
    throw new BadRequestException('Số điện thoại không hợp lệ');
  let n = input.replace(/[ ().-]/g, '').replace(/^\+/, '');
  if (n.startsWith('0')) n = '84' + n.slice(1);
  if (!/^84[35789][0-9]{8}$/.test(n))
    throw new BadRequestException('Nhập số di động Việt Nam hợp lệ');
  return n;
}
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export function safeEqual(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function configuredKey(name: string) {
  const value = process.env[name] ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new ServiceUnavailableException('Khóa bảo vệ xác thực chưa được cấu hình');
  return Buffer.from(value, 'hex');
}
export function digest(domain: string, value: string) {
  return createHmac('sha256', configuredKey('AUTH_HASH_KEY'))
    .update(domain + '\0' + value)
    .digest('hex');
}
export function seal(value: string, context: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', configuredKey('AUTH_ENCRYPTION_KEY'), iv);
  c.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString('base64');
}
export function unseal(value: string, context: string) {
  const b = Buffer.from(value, 'base64');
  const d = createDecipheriv(
    'aes-256-gcm',
    configuredKey('AUTH_ENCRYPTION_KEY'),
    b.subarray(0, 12),
  );
  d.setAAD(Buffer.from(context));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
