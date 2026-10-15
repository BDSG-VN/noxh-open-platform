import { it, expect } from 'vitest';
import { assertOrigin, jsonBody } from './server';
it('blocks cross-origin or absent-origin cookie mutations', () => {
  for (const origin of ['https://attacker.example', ''])
    expect(() =>
      assertOrigin(
        new Request('https://investor.example', { headers: { origin } }),
        'https://investor.example',
      ),
    ).toThrow();
  expect(() =>
    assertOrigin(
      new Request('https://investor.example', { headers: { origin: 'https://investor.example' } }),
      'https://investor.example',
    ),
  ).not.toThrow();
});
it('bounds streamed JSON and rejects invalid shapes', async () => {
  const req = (value: string) =>
    new Request('http://localhost', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: value,
    });
  expect(await jsonBody(req('{"name":"test"}'))).toEqual({ name: 'test' });
  await expect(jsonBody(req('[]'))).rejects.toMatchObject({ status: 400 });
  await expect(jsonBody(req('invalid'))).rejects.toMatchObject({ status: 400 });
  await expect(jsonBody(req('{"x":"' + 'x'.repeat(20000) + '"}'))).rejects.toMatchObject({
    status: 413,
  });
});
