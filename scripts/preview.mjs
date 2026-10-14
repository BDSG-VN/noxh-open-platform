// Local synthetic preview only; does not issue sessions or accept citizen records.
import { spawn } from 'node:child_process';
const env = { ...process.env, ALLOW_SYNTHETIC_FIXTURES: 'true', NODE_ENV: 'development' };
const specs = [
  ['node', ['apps/api/dist/main.js']],
  ['pnpm', ['--filter', '@noxh/citizen-web', 'start', '--hostname', '127.0.0.1']],
  ['pnpm', ['--filter', '@noxh/investor-console', 'start', '--hostname', '127.0.0.1']],
  ['pnpm', ['--filter', '@noxh/transparency-web', 'start', '--hostname', '127.0.0.1']],
];
const children = specs.map(([command, args]) =>
  spawn(command, args, {
    env: { ...env, NODE_ENV: command === 'node' ? 'development' : 'production' },
    stdio: 'inherit',
  }),
);
let stopping = false;
const stop = () => {
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
for (const child of children)
  child.once('exit', (code) => {
    if (!stopping && code !== 0) {
      stop();
      process.exitCode = 1;
    }
  });
console.log(
  'Synthetic preview: citizen :3000, investor :3001, transparency :3002, API :4000. Ready checks require separate DB/Redis.',
);
