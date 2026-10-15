import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = () => randomBytes(24).toString('hex');
const pg = password();
const content = `NODE_ENV=development
POSTGRES_USER=noxh_owner
POSTGRES_PASSWORD=${pg}
POSTGRES_DB=noxh
DATABASE_URL=postgresql://noxh_owner:${pg}@localhost:5432/noxh
REDIS_URL=redis://localhost:6379
AUTH_ORGANIZATION_ID=10000000-0000-4000-8000-000000000001
AUTH_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}
AUTH_HASH_KEY=${randomBytes(32).toString('hex')}
WORKFORCE_ISSUER=http://localhost:8080/realms/noxh
WORKFORCE_PUBLIC_ISSUER=http://localhost:8080/realms/noxh
WORKFORCE_CLIENT_ID=noxh-investor
INVESTOR_PUBLIC_ORIGIN=http://localhost:3001
CITIZEN_PUBLIC_ORIGIN=http://localhost:3000
KEYCLOAK_DB_USER=keycloak
KEYCLOAK_DB_PASSWORD=${password()}
KEYCLOAK_DB_NAME=keycloak
KEYCLOAK_ADMIN=local-admin
KEYCLOAK_ADMIN_PASSWORD=${password()}
MINIO_ROOT_USER=noxh-local
MINIO_ROOT_PASSWORD=${password()}
INTERNAL_API_URL=http://localhost:4000
ALLOW_SYNTHETIC_FIXTURES=true
EXTERNAL_AI_ENABLED=false
LOTTERY_PRODUCTION_ENABLED=false
`;
await writeFile('.env', content, { flag: 'wx', mode: 0o600 });
console.log('Created ignored .env with fresh local-only credentials. Never commit this file.');
