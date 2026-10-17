// Generates deploy/keycloak/noxh-realm.open-demo.json: the source realm plus one synthetic
// investor administrator with FIXED, PUBLIC credentials for the open demo. Never use this realm
// file for a real deployment; the credentials are intentionally printed on the demo page.
import { readFile, writeFile } from 'node:fs/promises';

export const OPEN_DEMO_ADMIN = {
  username: 'demo.admin',
  password: 'MayTrang-Demo-2026',
  // Base32 TOTP secret shown on the demo page; the page computes the current code.
  totpSecret: 'NOXHDEMOMAYTRANGOPENACCESSAB2345',
};

const realm = JSON.parse(await readFile('deploy/keycloak/noxh-realm.json', 'utf8'));
// Public investor-console origin of the demo deployment (default: local Compose).
const investorOrigin = (process.env.INVESTOR_PUBLIC_ORIGIN ?? 'http://localhost:3001').replace(
  /\/$/,
  '',
);
if (!/^https?:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(investorOrigin))
  throw new Error('INVESTOR_PUBLIC_ORIGIN must be an origin without a path');
for (const client of realm.clients ?? [])
  if (client.clientId === 'noxh-investor') {
    client.redirectUris = [investorOrigin + '/auth/callback'];
    client.webOrigins = [investorOrigin];
  }
realm.users = [
  {
    username: OPEN_DEMO_ADMIN.username,
    enabled: true,
    emailVerified: true,
    firstName: 'Quản trị',
    lastName: 'Trải nghiệm (giả lập)',
    email: 'demo.admin@example.test',
    realmRoles: ['org_admin'],
    credentials: [
      { type: 'password', value: OPEN_DEMO_ADMIN.password, temporary: false },
      {
        type: 'otp',
        secretData: JSON.stringify({ value: OPEN_DEMO_ADMIN.totpSecret }),
        credentialData: JSON.stringify({
          subType: 'totp',
          digits: 6,
          counter: 0,
          period: 30,
          algorithm: 'HmacSHA1',
          secretEncoding: 'BASE32',
        }),
      },
    ],
  },
];
const out = 'deploy/keycloak/noxh-realm.open-demo.json';
// Prettier is a dev dependency; outside the workspace (e.g. a bare Node container on a server)
// the file is written as plain JSON instead.
let text = JSON.stringify(realm, null, 2) + '\n';
try {
  const { default: prettier } = await import('prettier');
  text = await prettier.format(JSON.stringify(realm), {
    ...(await prettier.resolveConfig(out)),
    filepath: out,
  });
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
await writeFile(out, text);
console.log('Wrote deploy/keycloak/noxh-realm.open-demo.json (public demo credentials inside)');
