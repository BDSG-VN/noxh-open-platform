/** Fake SMTP server (node:net + STARTTLS/implicit TLS) and throwaway certificate for tests only. */
import { createServer as createTcpServer, type Server, type Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export type SmtpBehaviour =
  | 'accept'
  | 'reject'
  | 'temporary'
  | 'hang-after-data'
  | 'drop-before-data'
  | 'drop-on-starttls';
export interface FakeSmtp {
  server: Server;
  port: number;
  behaviour: SmtpBehaviour;
  transcript: string[];
  messages: string[];
  close(): Promise<void>;
}
export interface TestCertificate {
  key: string;
  cert: string;
  dispose(): void;
}
/** Self-signed EC certificate for 127.0.0.1 generated with the local openssl binary. */
export function testCertificate(): TestCertificate {
  const dir = mkdtempSync(join(tmpdir(), 'noxh-smtp-'));
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:prime256v1',
    '-nodes',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
    '-days',
    '2',
    '-subj',
    '/CN=127.0.0.1',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  return {
    key: readFileSync(join(dir, 'key.pem'), 'utf8'),
    cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
export function startFakeSmtp(
  tls: TestCertificate,
  options: { starttls: boolean; implicit: boolean },
): Promise<FakeSmtp> {
  const { key, cert } = tls;
  const state: FakeSmtp = {
    server: createTcpServer(),
    port: 0,
    behaviour: 'accept',
    transcript: [],
    messages: [],
    close: () => new Promise((r) => state.server.close(() => r())),
  };
  const serve = (raw: Socket | TLSSocket) => {
    let socket: Socket | TLSSocket = raw;
    let buffer = '';
    let data = false;
    let body = '';
    const write = (s: string) => socket.write(s + '\r\n');
    const attach = () =>
      socket.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        for (;;) {
          const i = buffer.indexOf('\r\n');
          if (i < 0) break;
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (data) {
            if (line === '.') {
              data = false;
              state.messages.push(body);
              body = '';
              if (state.behaviour === 'hang-after-data') return;
              if (state.behaviour === 'reject') write('550 5.1.1 synthetic mailbox rejected');
              else if (state.behaviour === 'temporary') write('451 4.3.0 synthetic try later');
              else write('250 2.0.0 OK queued as synthetic-' + state.messages.length);
            } else body += line + '\n';
            continue;
          }
          state.transcript.push(line);
          const [verb] = line.split(' ');
          if (verb === 'EHLO')
            write(
              '250-fake.synthetic\r\n' +
                (options.starttls && !(socket instanceof TLSSocket) ? '250-STARTTLS\r\n' : '') +
                '250-AUTH PLAIN LOGIN\r\n250 8BITMIME',
            );
          else if (verb === 'STARTTLS' && options.starttls) {
            write('220 2.0.0 Ready');
            if (state.behaviour === 'drop-on-starttls') return socket.destroy();
            socket.removeAllListeners('data');
            socket = new TLSSocket(raw, { isServer: true, key, cert });
            attach();
          } else if (verb === 'AUTH') write('235 2.7.0 Authentication successful');
          else if (verb === 'MAIL') write('250 2.1.0 OK');
          else if (verb === 'RCPT') write('250 2.1.5 OK');
          else if (verb === 'DATA') {
            if (state.behaviour === 'drop-before-data') return socket.destroy();
            data = true;
            write('354 End data with <CR><LF>.<CR><LF>');
          } else if (verb === 'QUIT') {
            write('221 2.0.0 Bye');
            socket.end();
          } else write('500 5.5.1 synthetic unknown');
        }
      });
    attach();
    write('220 fake.synthetic ESMTP');
  };
  state.server.on('connection', (socket) =>
    serve(options.implicit ? new TLSSocket(socket, { isServer: true, key, cert }) : socket),
  );
  return new Promise((resolve) =>
    state.server.listen(0, '127.0.0.1', () => {
      state.port = (state.server.address() as { port: number }).port;
      resolve(state);
    }),
  );
}
