import { expect, it } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { channelCors, channelCorsOrigins } from './channel-cors';
it('requires exact HTTPS origins, accepts loopback only in development, rejects wildcard/null/path/credentials', () => {
  expect(channelCorsOrigins('https://h5.zdn.vn', true).has('https://h5.zdn.vn')).toBe(true);
  expect(channelCorsOrigins('http://localhost:3003', false).size).toBe(1);
  for (const value of [
    '*',
    'null',
    'https://h5.zdn.vn/other',
    'https://x:secret@h5.zdn.vn',
    'http://localhost:3003',
    'https://*.example.test',
  ])
    expect(() => channelCorsOrigins(value, true)).toThrow();
});
it('opens only citizen bearer routes for configured origin; denies extra headers/methods and never credentials', () => {
  const middleware = channelCors(new Set(['https://h5.zdn.vn']));
  function run(
    path: string,
    origin: string,
    method = 'POST',
    extra = 'authorization,content-type',
  ) {
    const output: { headers: Record<string, string>; status: number; next: boolean } = {
      headers: {},
      status: 200,
      next: false,
    };
    const req = {
      path,
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': method,
        'access-control-request-headers': extra,
      },
    } as Request;
    const res = {
      vary: () => {},
      setHeader: (k: string, v: string) => {
        output.headers[k] = v;
      },
      status: (s: number) => {
        output.status = s;
        return res;
      },
      end: () => {},
    } as unknown as Response;
    middleware(req, res, (() => {
      output.next = true;
    }) as NextFunction);
    return output;
  }
  const ok = run('/api/v1/auth/zalo/exchange', 'https://h5.zdn.vn');
  expect(ok.status).toBe(204);
  expect(ok.headers['Access-Control-Allow-Origin']).toBe('https://h5.zdn.vn');
  expect(ok.headers['Access-Control-Allow-Credentials']).toBeUndefined();
  expect(run('/api/v1/auth/zalo/exchange', 'https://evil.example.test').status).toBe(403);
  expect(run('/api/v1/dossiers/anything', 'https://h5.zdn.vn', 'TRACE').status).toBe(403);
  expect(run('/api/v1/dossiers/anything', 'https://h5.zdn.vn', 'POST', 'x-admin-role').status).toBe(
    403,
  );
  const admin = run('/api/v1/admin/settings/openai', 'https://h5.zdn.vn');
  expect(admin.next).toBe(true);
  expect(admin.headers['Access-Control-Allow-Origin']).toBeUndefined();
});
