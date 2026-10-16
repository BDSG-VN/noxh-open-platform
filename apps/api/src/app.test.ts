import { beforeEach, afterEach, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app';
import { Database } from './database';
import { HealthService } from './health';
import { configure } from './bootstrap';
let app: INestApplication;
let ready = true;
beforeEach(async () => {
  process.env.ALLOW_SYNTHETIC_FIXTURES = 'true';
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Database)
    .useValue({ available: false })
    .overrideProvider(HealthService)
    .useValue({
      check: async () => ({
        status: ready ? 'ready' : 'not-ready',
        checks: { postgres: ready, redis: ready, migration: ready },
      }),
    })
    .compile();
  app = mod.createNestApplication();
  configure(app);
  // Bind once per test: repeated Supertest ephemeral binds can reuse a closing keep-alive socket.
  await app.listen(0, '127.0.0.1');
});
afterEach(async () => {
  await app.close();
  ready = true;
  delete process.env.ALLOW_SYNTHETIC_FIXTURES;
});
it('serves liveness and explicit nonproduction marker', async () => {
  const r = await request(app.getHttpServer()).get('/health/live');
  expect(r.status).toBe(200);
  expect(r.body.productionReady).toBe(false);
});
it('does not report readiness when dependencies fail', async () => {
  ready = false;
  const r = await request(app.getHttpServer()).get('/health/ready');
  expect(r.status).toBe(503);
  expect(r.headers['content-type']).toContain('application/problem+json');
});
it('serves ready after dependencies pass', async () =>
  expect((await request(app.getHttpServer()).get('/health/ready')).status).toBe(200));
it('only returns labeled synthetic projects', async () => {
  const r = await request(app.getHttpServer()).get('/api/v1/projects');
  expect(r.status).toBe(200);
  expect(r.body.items.every((p: { synthetic: boolean }) => p.synthetic)).toBe(true);
});
it('disables fixtures by default', async () => {
  delete process.env.ALLOW_SYNTHETIC_FIXTURES;
  expect((await request(app.getHttpServer()).get('/api/v1/projects')).status).toBe(503);
});
it('never accepts caller-provided Zalo identity', async () => {
  const r = await request(app.getHttpServer())
    .post('/api/v1/auth/zalo/exchange')
    .send({ userId: 'admin', accessToken: 'fake' });
  expect(r.status).toBe(400);
});
it('does not expose a business write endpoint', async () =>
  expect(
    (await request(app.getHttpServer()).post('/api/v1/dossiers').send({ ownerId: 'other' })).status,
  ).toBe(404));
it('denies unauthenticated staff mutations and private customer routes at HTTP boundary', async () => {
  process.env.WORKFORCE_ISSUER = 'https://identity.example.test/realms/noxh';
  try {
    for (const path of [
      '/api/v1/admin/dashboard',
      '/api/v1/admin/projects',
      '/api/v1/admin/settings/zalo',
      '/api/v1/citizen/dashboard',
      '/api/v1/admin/requests',
      '/api/v1/admin/audit',
      '/api/v1/admin/legal/catalog',
      '/api/v1/admin/settings/openai',
      '/api/v1/admin/partners',
      '/api/v1/admin/partner-campaigns',
      '/api/v1/admin/settings/zalo-miniapp',
      '/api/v1/admin/notifications/projects/20000000-0000-4000-8000-000000000001/workspace',
      '/api/v1/admin/notifications/projects/20000000-0000-4000-8000-000000000001/automation',
      '/api/v1/citizen/notifications/workspace',
      '/api/v1/admin/audit/checkpoints',
      '/api/v1/admin/knowledge/projects/20000000-0000-4000-8000-000000000001',
      '/api/v1/admin/tenancy/projects/20000000-0000-4000-8000-000000000001/contracts',
      '/api/v1/admin/projects/20000000-0000-4000-8000-000000000001/preparation-checklists',
      '/api/v1/citizen/tenancy/contracts',
      '/api/v1/partner/workspace',
      '/api/v1/partner/leads',
      '/api/v1/citizen/consultations',
      '/api/v1/dossiers/40000000-0000-4000-8000-000000000001/services',
      '/api/v1/dossiers/40000000-0000-4000-8000-000000000001/assistant',
      '/api/v1/dossiers/40000000-0000-4000-8000-000000000001',
    ])
      expect((await request(app.getHttpServer()).get(path)).status, `GET ${path}`).toBe(401);
    for (const path of [
      '/api/v1/admin/projects',
      '/api/v1/admin/rounds',
      '/api/v1/admin/notifications/projects/20000000-0000-4000-8000-000000000001/automation/policies',
      '/api/v1/admin/notifications/projects/20000000-0000-4000-8000-000000000001/automation/policies/40000000-0000-4000-8000-000000000001/review',
      '/api/v1/admin/partners',
      '/api/v1/partner/members',
      '/api/v1/partner/campaigns',
      '/api/v1/citizen/dossiers',
      '/api/v1/dossiers/40000000-0000-4000-8000-000000000001/assistant',
      '/api/v1/dossiers/40000000-0000-4000-8000-000000000001/online-cases',
      '/api/v1/admin/projects/20000000-0000-4000-8000-000000000001/forms',
    ])
      expect(
        (
          await request(app.getHttpServer())
            .post(path)
            .send({ role: 'org_admin', organizationId: 'caller-controlled', ownerId: 'other' })
        ).status,
        `POST ${path}`,
      ).toBe(401);
  } finally {
    delete process.env.WORKFORCE_ISSUER;
  }
});
