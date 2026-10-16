import { isIP } from 'node:net';
import type { Request } from 'express';
export function trustedProxyCidrs(value: string) {
  if (value.length > 8192) throw new Error('Invalid trusted proxy configuration');
  const ranges = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (ranges.length > 32) throw new Error('Invalid trusted proxy configuration');
  for (const entry of ranges) {
    const parts = entry.split('/'),
      family = isIP(parts[0] ?? '');
    const prefix = parts.length === 1 ? (family === 4 ? 32 : 128) : Number(parts[1]);
    if (
      !family ||
      parts.length > 2 ||
      !Number.isInteger(prefix) ||
      prefix < 1 ||
      prefix > (family === 4 ? 32 : 128) ||
      (parts.length === 2 && !/^\d+$/.test(parts[1] ?? ''))
    )
      throw new Error('Invalid trusted proxy configuration');
  }
  return ranges;
}
/** Express derives ip only from explicitly trusted proxies; never read raw forwarded headers. */
export function clientPeer(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}
