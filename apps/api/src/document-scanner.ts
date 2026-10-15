import { Injectable } from '@nestjs/common';
import { createConnection } from 'node:net';
export type ScanResult = {
  status: 'clean' | 'rejected' | 'quarantined';
  engine: string;
  reason: string;
};
@Injectable()
export class DocumentScanner {
  async scan(bytes: Uint8Array): Promise<ScanResult> {
    const host = process.env.CLAMD_HOST,
      port = Number(process.env.CLAMD_PORT ?? 3310);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
      return { status: 'quarantined', engine: 'clamd', reason: 'scanner-not-configured' };
    return new Promise((resolve) => {
      let done = false,
        response = '';
      const socket = createConnection({ host, port });
      const end = (r: ScanResult) => {
        if (done) return;
        done = true;
        socket.destroy();
        resolve(r);
      };
      socket.setTimeout(15000, () =>
        end({ status: 'quarantined', engine: 'clamd', reason: 'scanner-timeout' }),
      );
      socket.on('error', () =>
        end({ status: 'quarantined', engine: 'clamd', reason: 'scanner-unavailable' }),
      );
      socket.on('connect', () => {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let i = 0; i < bytes.length; i += 65536) {
          const b = Buffer.from(bytes.subarray(i, i + 65536)),
            len = Buffer.alloc(4);
          len.writeUInt32BE(b.length);
          socket.write(len);
          socket.write(b);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on('data', (chunk) => {
        response += chunk.toString('utf8');
        if (response.length > 2048)
          return end({
            status: 'quarantined',
            engine: 'clamd',
            reason: 'invalid-scanner-response',
          });
        if (!response.includes('\0')) return;
        const line = response.endsWith('\0') ? response.slice(0, -1) : response;
        if (/^stream: OK$/.test(line))
          end({ status: 'clean', engine: 'clamd', reason: 'scan-passed' });
        else if (/^stream: .+ FOUND$/.test(line))
          end({ status: 'rejected', engine: 'clamd', reason: 'malware-detected' });
        else end({ status: 'quarantined', engine: 'clamd', reason: 'scan-error' });
      });
      socket.on('end', () =>
        end({ status: 'quarantined', engine: 'clamd', reason: 'incomplete-scanner-response' }),
      );
    });
  }
}
