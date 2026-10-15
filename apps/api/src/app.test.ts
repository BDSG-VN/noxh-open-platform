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
  await app.init();
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
  expect(r.status).toBe(501);
});
it('does not expose a business write endpoint', async () =>
  expect(
    (await request(app.getHttpServer()).post('/api/v1/dossiers').send({ ownerId: 'other' })).status,
  ).toBe(404));
