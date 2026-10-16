import { expect, it } from 'vitest';
import type { Request } from 'express';
import { clientPeer, trustedProxyCidrs } from './client-peer';
it('trusts only configured literal ranges and rejects wildcard/trust-all/invalid prefixes', () => {
  expect(trustedProxyCidrs('')).toEqual([]);
  expect(trustedProxyCidrs('127.0.0.1,::1,10.0.0.0/8')).toHaveLength(3);
  for (const value of [
    '*',
    'true',
    'loopback',
    '0.0.0.0/0',
    '::/0',
    'example.test',
    '127.0.0.1/33',
    '::1/129',
    '127.0.0.1/32x',
  ])
    expect(() => trustedProxyCidrs(value)).toThrow();
});
it('uses framework-derived peer and never accepts caller forwarded headers directly', () => {
  expect(
    clientPeer({
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': 'spoofed' },
    } as unknown as Request),
  ).toBe('127.0.0.1');
  expect(
    clientPeer({
      ip: undefined,
      socket: { remoteAddress: '::1' },
      headers: { 'cf-connecting-ip': 'spoofed' },
    } as unknown as Request),
  ).toBe('::1');
});
