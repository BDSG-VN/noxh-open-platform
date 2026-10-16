import type { Request, Response, NextFunction } from 'express';

const channelPath =
  /^\/api\/v1\/(?:auth\/(?:zalo(?:\/|$)|link\/|phone\/|logout$)|citizen(?:\/|$)|dossiers\/|projects(?:\/|$)|capabilities$|legal\/forms\/)/;
const headers = new Set(['authorization', 'content-type', 'if-match', 'idempotency-key']);
export function channelCorsOrigins(value: string, production: boolean) {
  if (value.length > 8192) throw new Error('Invalid Mini App CORS configuration');
  const origins = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length > 32) throw new Error('Invalid Mini App CORS configuration');
  for (const origin of origins) {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new Error('Invalid Mini App CORS configuration');
    }
    const local =
      !production && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
    if (
      (u.protocol !== 'https:' && !local) ||
      u.origin !== origin ||
      u.username ||
      u.password ||
      u.hostname === 'null' ||
      u.hostname.includes('*')
    )
      throw new Error('Invalid Mini App CORS configuration');
  }
  return new Set(origins);
}
/** Optional bearer-only channel access; workforce routes and credentialed CORS stay closed. */
export function channelCors(allowed: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.headers.origin || !channelPath.test(req.path)) {
      next();
      return;
    }
    res.vary('Origin');
    const requested = String(req.headers['access-control-request-headers'] ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const method = String(req.headers['access-control-request-method'] ?? req.method).toUpperCase();
    const valid =
      allowed.has(req.headers.origin) &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method) &&
      requested.every((h) => headers.has(h));
    if (!valid) {
      if (req.method === 'OPTIONS') {
        res.status(403).end();
        return;
      }
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    if (req.method === 'OPTIONS') {
      res.vary('Access-Control-Request-Headers');
      res.vary('Access-Control-Request-Method');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, If-Match, Idempotency-Key',
      );
      res.setHeader('Access-Control-Max-Age', '300');
      res.status(204).end();
      return;
    }
    next();
  };
}
