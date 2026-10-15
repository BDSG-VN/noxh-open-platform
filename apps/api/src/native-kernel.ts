import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

export type NativeKernelKind = 'lottery' | 'pricing' | 'audit';
const kernels = {
  lottery: ['LOTTERY_ENGINE_BIN', '/opt/noxh/bin/lottery-runner'],
  pricing: ['PRICING_ENGINE_BIN', '/opt/noxh/bin/pricing-engine'],
  audit: ['AUDIT_VERIFIER_BIN', '/opt/noxh/bin/audit-verifier'],
} as const;
const maxBytes = 2_000_000;
const active: Record<NativeKernelKind, number> = { lottery: 0, pricing: 0, audit: 0 };
const unavailable = () =>
  new ServiceUnavailableException(
    'Bộ xử lý Rust chưa sẵn sàng hoặc không trả kết quả kiểm chứng hợp lệ. Hãy kiểm tra cấu hình triển khai.',
  );

export function nativeKernelExecutable(kind: NativeKernelKind) {
  const [variable, fallback] = kernels[kind];
  const executable = process.env[variable] || fallback;
  if (!isAbsolute(executable) || executable.includes('\0')) throw unavailable();
  return executable;
}
export async function nativeKernelsAvailable() {
  try {
    await Promise.all(
      (Object.keys(kernels) as NativeKernelKind[]).map(async (kind) => {
        const file = nativeKernelExecutable(kind);
        await access(file, constants.X_OK);
        if (!(await stat(file)).isFile()) throw unavailable();
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/** Fixed-purpose executables only. Secrets travel over stdin; child processes inherit no app credentials. */
export async function runRustKernel(kind: NativeKernelKind, payload: unknown): Promise<unknown> {
  const executable = nativeKernelExecutable(kind);
  let input: Buffer;
  try {
    input = Buffer.from(JSON.stringify(payload));
  } catch {
    throw unavailable();
  }
  if (input.byteLength > maxBytes) throw unavailable();
  if (active[kind] >= 2 || Object.values(active).reduce((a, b) => a + b, 0) >= 4)
    throw new HttpException('Bộ xử lý đang bận. Hãy thử lại sau.', 429);
  const configured = Number(process.env.RUST_KERNEL_TIMEOUT_MS ?? 5000);
  const timeout =
    Number.isInteger(configured) && configured >= 100 && configured <= 10000 ? configured : 5000;
  active[kind]++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, [], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { LANG: 'C.UTF-8', RUST_BACKTRACE: '0' },
      });
      let settled = false,
        size = 0,
        errors = 0;
      const chunks: Buffer[] = [];
      const finish = (failure?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        if (failure) {
          child.kill('SIGKILL');
          reject(failure);
        } else resolve(value);
      };
      const timer = setTimeout(() => finish(unavailable()), timeout);
      child.once('error', () => finish(unavailable()));
      child.stdin.on('error', () => finish(unavailable()));
      child.stdout.on('data', (data: Buffer) => {
        size += data.length;
        if (size > maxBytes) return finish(unavailable());
        chunks.push(data);
      });
      // Drain bounded stderr without logging or forwarding private input/provider/process details.
      child.stderr.on('data', (data: Buffer) => {
        errors += data.length;
        if (errors > 8192) finish(unavailable());
      });
      child.once('close', (code, signal) => {
        if (settled) return;
        try {
          if (signal || (code !== 0 && !(kind === 'audit' && code === 1)))
            return finish(unavailable());
          const output: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
          if (
            !output ||
            typeof output !== 'object' ||
            (Array.isArray(output) && kind !== 'pricing')
          )
            return finish(unavailable());
          if (code === 1 && (output as { valid?: unknown }).valid !== false)
            return finish(unavailable());
          finish(undefined, output);
        } catch {
          finish(unavailable());
        }
      });
      child.stdin.end(input);
    });
  } finally {
    active[kind]--;
  }
}
