// Starts every role UI on a free loopback port against the synthetic API.
// Production builds are required (`pnpm build`); nothing here talks to a database.
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startFakeApi } from './fake-api';

const root = resolve(__dirname, '../..');
export const apps = ['citizen-web', 'investor-console', 'partner-console', 'transparency-web'];

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => ok(port));
    });
  });
}

async function waitFor(url: string, child: ChildProcess, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`${url} exited with ${child.exitCode}`);
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};
function serveStatic(dir: string): Promise<{ url: string; close: () => void }> {
  return new Promise((ok) => {
    const server = createServer((req, res) => {
      const path = normalize(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
      let file = join(dir, path);
      if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory())
        file = join(dir, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
      createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () =>
      ok({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: () => server.close(),
      }),
    );
  });
}

export async function startAll() {
  const api = await startFakeApi();
  const children: ChildProcess[] = [];
  const urls: Record<string, string> = {};
  for (const app of apps) {
    const dir = join(root, 'apps', app);
    if (!existsSync(join(dir, '.next', 'BUILD_ID')))
      throw new Error(`apps/${app} has no production build; run \`pnpm build\` first`);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const child = spawn(
      process.execPath,
      [join(dir, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--port', String(port)],
      {
        cwd: dir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          INTERNAL_API_URL: api.url,
          DEMO_OPEN_ACCESS: 'true',
          CITIZEN_PUBLIC_ORIGIN: url,
          INVESTOR_PUBLIC_ORIGIN: url,
          PARTNER_PUBLIC_ORIGIN: url,
          TRANSPARENCY_PUBLIC_ORIGIN: url,
          HOSTNAME: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    child.stdout?.on('data', (d) => (log += d));
    child.stderr?.on('data', (d) => (log += d));
    children.push(child);
    try {
      await waitFor(url + '/login', child);
    } catch (e) {
      throw new Error(`${(e as Error).message}\n${log}`);
    }
    urls[app] = url;
  }
  const dist = join(root, 'apps', 'zalo-miniapp', 'dist');
  if (!existsSync(join(dist, 'index.html')))
    throw new Error('apps/zalo-miniapp has no build; run `pnpm build` first');
  const mini = await serveStatic(dist);
  urls['zalo-miniapp'] = mini.url;
  return {
    urls,
    close: async () => {
      for (const c of children) c.kill('SIGTERM');
      mini.close();
      api.close();
      await delay(200);
    },
  };
}
