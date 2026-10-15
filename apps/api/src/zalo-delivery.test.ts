import { it, expect, vi, afterEach } from 'vitest';
import { ZaloDelivery } from './phone-service';
afterEach(() => vi.unstubAllGlobals());
it('uses fixed official transport and accepts only explicit provider success', async () => {
  const settings = {
    accessToken: 'synthetic-token',
    appSecret: 'synthetic-secret',
    templateId: 'test-template',
    otpParameter: 'otp',
  };
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ error: 0 }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  await new ZaloDelivery().send(settings, '84900000000', '123456', 'synthetic-tracking');
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://business.openapi.zalo.me/message/template');
  expect(init.headers.access_token).toBe(settings.accessToken);
  expect(JSON.parse(init.body).template_data).toEqual({ otp: '123456' });
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ error: -124, message: 'private provider detail' }), {
      status: 200,
    }),
  );
  await expect(
    new ZaloDelivery().send(settings, '84900000000', '123456', 'test'),
  ).rejects.toMatchObject({ status: 503 });
  fetcher.mockResolvedValue(new Response('{}', { status: 200 }));
  await expect(
    new ZaloDelivery().send(settings, '84900000000', '123456', 'test'),
  ).rejects.toMatchObject({ status: 503 });
});
