import { Injectable, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { seal, unseal } from './identity-crypto';
export const hashBytes = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export function encryptObject(bytes: Uint8Array, scope: string) {
  const key = randomBytes(32),
    iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(scope));
  const data = Buffer.concat([c.update(bytes), c.final()]);
  return {
    bytes: Buffer.concat([iv, c.getAuthTag(), data]),
    keyCipher: seal(key.toString('hex'), 'document-key:' + scope),
  };
}
export function decryptObject(bytes: Uint8Array, keyCipher: string, scope: string) {
  const b = Buffer.from(bytes),
    key = Buffer.from(unseal(keyCipher, 'document-key:' + scope), 'hex'),
    d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
  d.setAAD(Buffer.from(scope));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}
@Injectable()
export class DocumentStorage implements OnModuleDestroy {
  private cached?: S3Client;
  onModuleDestroy() {
    this.cached?.destroy();
  }
  private client() {
    if (this.cached) return this.cached;
    const endpoint = process.env.S3_ENDPOINT,
      accessKeyId = process.env.S3_ACCESS_KEY,
      secretAccessKey = process.env.S3_SECRET_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey)
      throw new ServiceUnavailableException('Kho giấy tờ riêng chưa được cấu hình');
    const u = new URL(endpoint);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
      throw new ServiceUnavailableException('Cấu hình kho không hợp lệ');
    return (this.cached = new S3Client({
      endpoint,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestHandler: { requestTimeout: 15000 },
      maxAttempts: 1,
    }));
  }
  async put(key: string, bytes: Uint8Array) {
    await this.client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET ?? 'noxh-private',
        Key: key,
        Body: bytes,
        ContentType: 'application/octet-stream',
      }),
    );
  }
  async get(key: string) {
    const r = await this.client().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'noxh-private', Key: key }),
    );
    if (!r.Body) throw new ServiceUnavailableException('Không đọc được tệp');
    let n = 0;
    const chunks: Uint8Array[] = [];
    for await (const c of r.Body as AsyncIterable<Uint8Array>) {
      n += c.length;
      if (n > 10 * 1024 * 1024) {
        if ('destroy' in r.Body && typeof r.Body.destroy === 'function') r.Body.destroy();
        throw new ServiceUnavailableException('Tệp vượt giới hạn');
      }
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  }
  async remove(key: string) {
    await this.client().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'noxh-private', Key: key }),
    );
  }
}
