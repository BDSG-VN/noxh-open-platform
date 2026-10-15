import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
export function validateLoadTarget(origin, env = process.env) {
  if (env.ALLOW_SYNTHETIC_FIXTURES !== 'true')
    throw new Error('ALLOW_SYNTHETIC_FIXTURES=true is required for the synthetic local load drill');
  let u;
  try {
    u = new URL(origin);
  } catch {
    throw new Error('A local API origin is required');
  }
  if (
    u.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) ||
    u.port !== '4000' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  )
    throw new Error('Only a local HTTP API origin on port 4000 is allowed');
  return u.origin;
}
export function loadBounds(requests = 120, concurrency = 4) {
  if (
    !Number.isInteger(requests) ||
    requests < 1 ||
    requests > 500 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 8
  )
    throw new Error('Bounded drill: 1–500 requests, 1–8 concurrent workers');
  return { requests, concurrency };
}
async function json(url, signal) {
  const r = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    signal: globalThis.AbortSignal.any([signal, globalThis.AbortSignal.timeout(3000)]),
    headers: { Accept: 'application/json' },
  });
  if (!r.ok) throw new Error('A local read endpoint failed');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of r.body) {
    bytes += chunk.byteLength;
    if (bytes > 262144) throw new Error('Read response exceeded 256 KiB bound');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function syntheticLoad({
  origin = 'http://127.0.0.1:4000',
  requests = 120,
  concurrency = 4,
}) {
  origin = validateLoadTarget(origin);
  loadBounds(requests, concurrency);
  const deadline = globalThis.AbortSignal.timeout(60000),
    catalog = await json(origin + '/api/v1/projects', deadline);
  if (
    !Array.isArray(catalog.items) ||
    catalog.items.length < 2 ||
    catalog.items.length > 100 ||
    catalog.items.some(
      (p) =>
        p.synthetic !== true ||
        typeof p.id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(p.id),
    )
  )
    throw new Error(
      'Need 2–100 published synthetic projects; mixed or real project catalogs are refused',
    );
  const projects = catalog.items.slice(0, 20),
    paths = [
      '/health/live',
      '/health/ready',
      ...projects.flatMap((p) => [
        '/api/v1/projects/' + p.id,
        '/api/v1/projects/' + p.id + '/rounds',
      ]),
    ],
    latencies = [];
  let cursor = 0,
    failed = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, requests) }, async () => {
      while (cursor < requests && !deadline.aborted) {
        const index = cursor++,
          path = paths[index % paths.length],
          at = performance.now();
        try {
          const result = await json(origin + path, deadline);
          if (path.endsWith('/rounds') && !Array.isArray(result.items))
            throw new Error('Invalid round response');
          if (/\/projects\/[a-f0-9-]+$/i.test(path) && result.synthetic !== true)
            throw new Error('Project lost synthetic flag');
        } catch {
          failed++;
        }
        latencies.push(performance.now() - at);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  const percentile = (p) =>
    Number((latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? 0).toFixed(2));
  return {
    synthetic: true,
    productionLoad: false,
    readOnly: true,
    projectCount: projects.length,
    requested: requests,
    completed: latencies.length,
    failed,
    concurrency,
    durationMs: Number((performance.now() - started).toFixed(2)),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    deadlineExceeded: deadline.aborted,
  };
}
async function main() {
  const args = process.argv.slice(2),
    allowed = ['--origin', '--requests', '--concurrency'];
  if (
    args.length % 2 ||
    args.some((v, i) => i % 2 === 0 && !allowed.includes(v)) ||
    new Set(args.filter((_, i) => i % 2 === 0)).size !== args.length / 2
  )
    throw new Error('Usage: --origin http://127.0.0.1:4000 --requests 120 --concurrency 4');
  const get = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index < 0 ? fallback : args[index + 1];
  };
  const result = await syntheticLoad({
    origin: get('--origin', 'http://127.0.0.1:4000'),
    requests: Number(get('--requests', 120)),
    concurrency: Number(get('--concurrency', 4)),
  });
  console.log(JSON.stringify(result));
  if (result.failed || result.deadlineExceeded || result.completed !== result.requested)
    process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    console.error(
      'Synthetic load drill failed; check local readiness, all-synthetic projects and the documented limits',
    );
    process.exitCode = 1;
  });
