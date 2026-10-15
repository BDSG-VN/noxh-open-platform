import { createHash, createHmac, hkdfSync } from 'node:crypto';
import type { LotteryConfig, LotteryResult } from '@noxh/contracts';
export const algorithm = 'noxh-hkdf-hmac-fisher-yates-v1';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
export function snapshot(config: LotteryConfig, id: string) {
  return JSON.stringify([
    algorithm,
    id,
    config.projectId,
    config.title,
    config.synthetic,
    config.kind,
    config.seats,
    [...config.entries].sort(),
    [...config.units].sort(),
    config.rules,
    config.legalBasis,
    config.priorityResolution,
    config.eligibilityEvidenceHash,
    config.scheduledAt,
    config.entropySource,
  ]);
}
export function commitment(secret: string, snapshotHash: string) {
  if (!/^[a-f0-9]{64}$/.test(secret) || !/^[a-f0-9]{64}$/.test(snapshotHash))
    throw new Error('Invalid seed material');
  return hash(
    Buffer.concat([
      Buffer.from('noxh-commit-v1\0'),
      Buffer.from(secret, 'hex'),
      Buffer.from(snapshotHash, 'hex'),
    ]),
  );
}
export function boundedIndex(next: () => number, bound: number) {
  const limit = 0x100000000 - (0x100000000 % bound);
  for (let tries = 0; tries < 10000; tries++) {
    const n = next();
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid random word');
    if (n < limit) return n % bound;
  }
  throw new Error('Random stream exhausted');
}
export function draw(
  config: LotteryConfig,
  id: string,
  secret: string,
  entropy: string,
): LotteryResult {
  if (!/^[a-f0-9]{64}$/.test(entropy)) throw new Error('Invalid entropy');
  const snapshotHash = hash(snapshot(config, id)),
    key = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(secret, 'hex'),
        Buffer.from(entropy, 'hex'),
        Buffer.from('noxh-draw-v1:' + snapshotHash),
        32,
      ),
    );
  let counter = 0,
    offset = 32,
    block = Buffer.alloc(32);
  const next = () => {
    if (offset === 32) {
      const c = Buffer.alloc(4);
      c.writeUInt32BE(counter++);
      block = createHmac('sha256', key).update(c).digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const codes = [...config.entries].sort();
  for (let i = codes.length - 1; i > 0; i--) {
    const j = boundedIndex(next, i + 1);
    [codes[i], codes[j]] = [codes[j]!, codes[i]!];
  }
  const units = [...config.units].sort();
  return {
    algorithm,
    snapshotHash,
    commitment: commitment(secret, snapshotHash),
    secret,
    entropy,
    ranking: codes.map((code, i) => ({
      code,
      rank: i + 1,
      selected: i < config.seats,
      unit: config.kind === 'allocation' ? units[i]! : null,
    })),
  };
}
export const snapshotHash = (config: LotteryConfig, id: string) => hash(snapshot(config, id));
