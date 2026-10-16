import { execFileSync } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
let failures = 0;
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /AKIA[A-Z0-9]{16}/,
  /sk-[A-Za-z0-9_-]{32,}/,
];
for (const file of files) {
  if (file.split('/').some((p) => p === '.env' || p === 'credentials.json')) {
    console.error(`Forbidden file: ${file}`);
    failures++;
    continue;
  }
  // Symlinks and directories (e.g. a linked build target) are not source text to scan.
  if (!(await lstat(file)).isFile()) continue;
  const content = await readFile(file, 'utf8');
  if (patterns.some((p) => p.test(content))) {
    console.error(`Possible credential in ${file}; value redacted`);
    failures++;
  }
}
if (failures) process.exitCode = 1;
else
  console.log(
    `Secret-pattern gate passed on ${files.length} source files (not a full security audit)`,
  );
