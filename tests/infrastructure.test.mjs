import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
const compose = parse(await readFile('compose.yaml', 'utf8'), { merge: true });
test('development ports bind loopback; persistent stores have volumes', () => {
  for (const service of Object.values(compose.services))
    for (const port of service.ports ?? []) assert.ok(port.startsWith('127.0.0.1:'), port);
  for (const service of ['postgres', 'keycloak-db', 'keycloak', 'minio', 'redis'])
    assert.ok(compose.services[service].volumes.length > 0);
  assert.equal(compose.services.keycloak.environment.KC_DB, 'postgres');
});
test('external AI defaults off and lottery remains disabled', () => {
  assert.equal(
    compose.services.api.environment.EXTERNAL_AI_ENABLED,
    '${EXTERNAL_AI_ENABLED:-false}',
  );
  assert.equal(compose.services.api.environment.LOTTERY_PRODUCTION_ENABLED, 'false');
  assert.deepEqual(compose.services['ai-worker'].profiles, ['ai']);
});
test('no anonymous object storage access', () =>
  assert.ok(compose.services['storage-init'].command[0].includes('mc anonymous set none')));
test('migration is required before API starts', () =>
  assert.equal(
    compose.services.api.depends_on.migrate.condition,
    'service_completed_successfully',
  ));
test('fixture seed and private bucket setup must complete before API starts', () => {
  assert.equal(compose.services.api.depends_on.seed.condition, 'service_completed_successfully');
  assert.equal(
    compose.services.api.depends_on['storage-init'].condition,
    'service_completed_successfully',
  );
});
