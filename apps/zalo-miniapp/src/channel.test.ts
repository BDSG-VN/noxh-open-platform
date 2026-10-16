import { it, expect } from 'vitest';
import { ZaloChannel, isZaloEnvironment } from './channel';
it('uses userAgent only for presentation and rejects unsafe API origin', () => {
  expect(isZaloEnvironment('Mozilla')).toBe(false);
  expect(() => new ZaloChannel('http://attacker.example')).toThrow();
  expect(() => new ZaloChannel('https://api.example.test/path')).toThrow();
  expect(() => new ZaloChannel('https://user:secret@api.example.test')).toThrow();
});
it('exchanges via a server challenge and keeps bearer credentials out of return values, URLs and persistent storage', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const firstParty = 'SYNTHETIC-FIRST-PARTY-SESSION-TOKEN-ONLY';
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify(
        String(url).endsWith('/challenges')
          ? {
              challengeId: '20000000-0000-4000-8000-000000000001',
              challengeProof: 'p'.repeat(43),
              expiresIn: 120,
            }
          : String(url).endsWith('/exchange')
            ? {
                sessionEstablished: true,
                sessionToken: firstParty,
                expiresIn: 3600,
                legalIdentityVerified: false,
              }
            : { phoneMasked: '09•••000', legalIdentityVerified: false, dossiers: [] },
      ),
    );
  };
  const channel = new ZaloChannel('https://api.example.test', fake as typeof fetch);
  expect(await channel.exchange('SYNTHETIC-PROVIDER-ACCESS-TOKEN')).toEqual({
    sessionEstablished: true,
  });
  expect((await channel.dashboard()).dossiers).toEqual([]);
  expect(JSON.stringify(requests.map((r) => r.url))).not.toContain(firstParty);
  expect(requests[2]?.init?.headers).toEqual({ Authorization: 'Bearer ' + firstParty });
  expect(requests.every((r) => r.init?.credentials === 'omit' && r.init.redirect === 'error')).toBe(
    true,
  );
  channel.clear();
  await expect(channel.dashboard()).rejects.toThrow('đăng nhập');
});
it('does not trust client-side environment or token when the server denies identity verification', async () => {
  const channel = new ZaloChannel(
    'https://api.example.test',
    (async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith('/challenges')
            ? { challengeId: 'challenge', challengeProof: 'proof' }
            : { detail: 'Token không thuộc ứng dụng' },
        ),
        { status: String(url).endsWith('/challenges') ? 200 : 401 },
      )) as typeof fetch,
  );
  await expect(channel.exchange('UNTRUSTED-CLIENT-TOKEN')).rejects.toThrow('không thuộc');
  await expect(channel.dashboard()).rejects.toThrow('đăng nhập');
});

it('revokes the fresh phone session when cancelling linking and before a successful Zalo handoff', async () => {
  const phoneToken = 'SYNTHETIC-PHONE-SESSION',
    zaloToken = 'SYNTHETIC-ZALO-SESSION',
    revoked: string[] = [],
    paths: string[] = [];
  let linked = false;
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path.endsWith('/logout')) {
      revoked.push(String((init?.headers as Record<string, string>).Authorization));
      return new Response('{}');
    }
    return new Response(
      JSON.stringify(
        path.endsWith('/challenges')
          ? {
              challengeId: '20000000-0000-4000-8000-000000000001',
              challengeProof: 'p'.repeat(43),
              expiresIn: 120,
            }
          : path.endsWith('/exchange')
            ? linked
              ? { sessionEstablished: true, sessionToken: zaloToken, expiresIn: 3600 }
              : { sessionEstablished: false, needsLink: true }
            : path.endsWith('/phone/request')
              ? {
                  challengeId: '20000000-0000-4000-8000-000000000001',
                  challengeProof: 'p'.repeat(43),
                  expiresIn: 300,
                }
              : path.endsWith('/phone/verify')
                ? { sessionToken: phoneToken }
                : path.endsWith('/link/start')
                  ? {
                      challengeId: '20000000-0000-4000-8000-000000000001',
                      challengeProof: 'p'.repeat(43),
                      expiresIn: 120,
                    }
                  : { linked: true },
      ),
    );
  };
  const channel = new ZaloChannel('https://api.example.test', fake as typeof fetch);
  await channel.exchange('SYNTHETIC-PROVIDER-TOKEN');
  await channel.requestPhone('0900000000', true);
  await channel.verifyPhone('000000');
  await channel.logout();
  expect(revoked).toEqual(['Bearer ' + phoneToken]);
  await channel.exchange('SYNTHETIC-PROVIDER-TOKEN');
  await channel.requestPhone('0900000000', true);
  await channel.verifyPhone('000000');
  await channel.startLink(true);
  linked = true;
  expect(await channel.confirmLink(true)).toEqual({ sessionEstablished: true });
  expect(revoked).toEqual(['Bearer ' + phoneToken, 'Bearer ' + phoneToken]);
  expect(paths.lastIndexOf('/api/v1/auth/logout')).toBeLessThan(
    paths.lastIndexOf('/api/v1/auth/zalo/exchange'),
  );
  await channel.logout();
  expect(revoked[2]).toBe('Bearer ' + zaloToken);
});

it('sends exact owner dossier/version paths and refuses arbitrary endpoints or binary MIME', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const path = new URL(String(url)).pathname;
    return new Response(
      JSON.stringify(
        path.endsWith('/challenges')
          ? {
              challengeId: '20000000-0000-4000-8000-000000000001',
              challengeProof: 'p'.repeat(43),
              expiresIn: 120,
            }
          : path.endsWith('/exchange')
            ? { sessionEstablished: true, sessionToken: 'SYNTHETIC-SESSION' }
            : {},
      ),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  const channel = new ZaloChannel('https://api.example.test', fake as typeof fetch),
    id = '40000000-0000-4000-8000-000000000001';
  await channel.exchange('SYNTHETIC-PROVIDER-TOKEN');
  const { emptyDeclaration } = await import('@noxh/contracts');
  await channel.saveDeclaration(id, { ...emptyDeclaration, fullName: 'GIẢ LẬP' }, 7);
  expect(calls[2]?.init?.method).toBe('PATCH');
  expect(calls[2]?.init?.headers).toMatchObject({
    'If-Match': '7',
    Authorization: 'Bearer SYNTHETIC-SESSION',
  });
  const before = calls.length;
  await expect(channel.dossierAction(id, '../../admin/settings/openai', {})).rejects.toThrow(
    'không thuộc',
  );
  await expect(channel.dossierAction(id, 'documents?owner=other', {})).rejects.toThrow();
  expect(calls).toHaveLength(before);
  await expect(channel.file(id, 'form-packet')).rejects.toThrow('Định dạng');
});

it('clears session and aborts an in-flight private request on logout', async () => {
  let pendingSignal: AbortSignal | undefined,
    started: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fake = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/dashboard')) {
      pendingSignal = init?.signal ?? undefined;
      started();
      return new Promise<Response>((_resolve, reject) =>
        pendingSignal?.addEventListener('abort', () => reject(Error('aborted')), { once: true }),
      );
    }
    return new Response(
      JSON.stringify(
        path.endsWith('/challenges')
          ? {
              challengeId: '20000000-0000-4000-8000-000000000001',
              challengeProof: 'p'.repeat(43),
              expiresIn: 120,
            }
          : path.endsWith('/exchange')
            ? { sessionEstablished: true, sessionToken: 'SYNTHETIC-SESSION' }
            : {},
      ),
    );
  };
  const channel = new ZaloChannel('https://api.example.test', fake as typeof fetch);
  await channel.exchange('SYNTHETIC-PROVIDER-TOKEN');
  const pending = channel.dashboard();
  const rejection = expect(pending).rejects.toThrow('aborted');
  await waiting;
  await channel.logout();
  await rejection;
  expect(pendingSignal?.aborted).toBe(true);
  await expect(channel.dashboard()).rejects.toThrow('đăng nhập');
});

it('revokes an already verified phone session before requesting another OTP', async () => {
  const paths: string[] = [];
  const channel = new ZaloChannel('https://api.example.test', (async (url) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    return new Response(
      JSON.stringify(
        path.endsWith('/phone/verify')
          ? { sessionToken: 'SYNTHETIC-PHONE' }
          : { challengeId: 'synthetic', challengeProof: 'proof', expiresIn: 300 },
      ),
    );
  }) as typeof fetch);
  await channel.requestPhone('0900000000', true);
  await channel.verifyPhone('000000');
  await channel.requestPhone('0900000001', true);
  expect(paths.slice(-2)).toEqual(['/api/v1/auth/logout', '/api/v1/auth/phone/request']);
});
it('does not resurrect authentication after logout interrupts exchange cleanup', async () => {
  let finish: () => void = () => {},
    waiting: () => void = () => {};
  const started = new Promise<void>((r) => {
    waiting = r;
  });
  let exchanges = 0;
  const channel = new ZaloChannel('https://api.example.test', (async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/logout')) {
      waiting();
      await new Promise<void>((r) => {
        finish = r;
      });
    }
    if (path.endsWith('/exchange')) exchanges++;
    return new Response(
      JSON.stringify(
        path.endsWith('/challenges')
          ? { challengeId: 'synthetic', challengeProof: 'proof' }
          : path.endsWith('/exchange')
            ? { sessionEstablished: true, sessionToken: 'SYNTHETIC' }
            : {},
      ),
    );
  }) as typeof fetch);
  await channel.exchange('SYNTHETIC-PROVIDER');
  const next = channel.exchange('SYNTHETIC-PROVIDER');
  const rejected = expect(next).rejects.toThrow(/Phiên đã đóng|Đã xóa phiên trên thiết bị/);
  await started;
  await channel.logout();
  finish();
  await rejected;
  expect(exchanges).toBe(1);
  await expect(channel.dashboard()).rejects.toThrow('đăng nhập');
});
it('prevents two simultaneous OTP requests from replacing each other out of order', async () => {
  let finish: () => void = () => {};
  let calls = 0;
  const channel = new ZaloChannel('https://api.example.test', (async () => {
    calls++;
    await new Promise<void>((r) => {
      finish = r;
    });
    return new Response(
      JSON.stringify({ challengeId: 'synthetic', challengeProof: 'proof', expiresIn: 300 }),
    );
  }) as typeof fetch);
  const first = channel.requestPhone('0900000000', true);
  await expect(channel.requestPhone('0900000001', true)).rejects.toThrow('Hãy chờ');
  finish();
  await first;
  expect(calls).toBe(1);
});
it('does not dispatch a replacement OTP when old-session revocation fails and retains it for explicit logout retry', async () => {
  let revocations = 0,
    requests = 0;
  const channel = new ZaloChannel('https://api.example.test', (async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/logout')) {
      revocations++;
      return new Response('{}', { status: revocations === 1 ? 503 : 200 });
    }
    if (path.endsWith('/phone/request')) requests++;
    return new Response(
      JSON.stringify(
        path.endsWith('/phone/verify')
          ? { sessionToken: 'SYNTHETIC-PHONE' }
          : { challengeId: 'synthetic', challengeProof: 'proof', expiresIn: 300 },
      ),
    );
  }) as typeof fetch);
  await channel.requestPhone('0900000000', true);
  await channel.verifyPhone('000000');
  await expect(channel.requestPhone('0900000001', true)).rejects.toThrow('Chưa xác nhận thu hồi');
  expect(requests).toBe(1);
  await channel.logout();
  expect(revocations).toBe(2);
});
