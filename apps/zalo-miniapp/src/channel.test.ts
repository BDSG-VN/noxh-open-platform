import { it, expect } from 'vitest';
import { ZaloChannel, isZaloEnvironment } from './channel';
it('keeps plain browser fallback', () => expect(isZaloEnvironment('Mozilla')).toBe(false));
it('never trusts a client token without server verification', async () => {
  await expect(new ZaloChannel().exchange('untrusted')).rejects.toThrow('NOT_IMPLEMENTED');
});
