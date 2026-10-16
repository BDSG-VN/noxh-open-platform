import { afterEach, expect, it, vi } from 'vitest';
import { NotificationAutomationLifecycle } from './notification-automation-lifecycle';
import type {
  NotificationAutomationBatch,
  NotificationAutomationService,
} from './notification-automation-service';

const argv = [...process.argv];
const empty = (): NotificationAutomationBatch => ({
  claimed: 0,
  delivered: 0,
  skipped: 0,
  failed: 0,
});
function fixture(enabled = true) {
  const service = {
    configuredOrganization: vi.fn(() => (enabled ? '10000000-0000-4000-8000-000000000001' : null)),
    runConfiguredBatch: vi.fn(async (_continue?: () => boolean) => empty()),
  };
  const lifecycle = new NotificationAutomationLifecycle(
    service as unknown as NotificationAutomationService,
  );
  return { service, lifecycle };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  process.argv = [...argv];
});

it('starts no background work when disabled or invoked as a one-shot worker', async () => {
  vi.useFakeTimers();
  const disabled = fixture(false);
  disabled.lifecycle.onApplicationBootstrap();
  const once = fixture();
  process.argv.push('--notifications-once');
  once.lifecycle.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(20000);
  expect(disabled.service.runConfiguredBatch).not.toHaveBeenCalled();
  expect(once.service.runConfiguredBatch).not.toHaveBeenCalled();
  await disabled.lifecycle.onModuleDestroy();
  await once.lifecycle.onModuleDestroy();
});

it('never overlaps a running batch when interval ticks continue', async () => {
  vi.useFakeTimers();
  const { service, lifecycle } = fixture();
  let release!: (result: NotificationAutomationBatch) => void;
  service.runConfiguredBatch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  lifecycle.onApplicationBootstrap();
  try {
    await vi.advanceTimersByTimeAsync(20000);
    expect(service.runConfiguredBatch).toHaveBeenCalledTimes(1);
  } finally {
    release({ claimed: 1, delivered: 1, skipped: 0, failed: 0 });
    await lifecycle.onModuleDestroy();
  }
  expect(lifecycle.status().processedCount).toBe(1);
});

it('waits for its active transaction and stops further claims during shutdown', async () => {
  vi.useFakeTimers();
  const { service, lifecycle } = fixture();
  let release!: (result: NotificationAutomationBatch) => void;
  let mayContinue: (() => boolean) | undefined;
  service.runConfiguredBatch.mockImplementationOnce((check) => {
    mayContinue = check;
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  lifecycle.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(5000);
  expect(mayContinue?.()).toBe(true);
  let closed = false;
  const closing = lifecycle.onModuleDestroy().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  expect(mayContinue?.()).toBe(false);
  release(empty());
  await closing;
  await vi.advanceTimersByTimeAsync(20000);
  expect(closed).toBe(true);
  expect(service.runConfiguredBatch).toHaveBeenCalledTimes(1);
});

it('reports failure without claiming delivery and recovers on a later successful batch', async () => {
  vi.useFakeTimers();
  const { service, lifecycle } = fixture();
  service.runConfiguredBatch.mockRejectedValueOnce(new Error('synthetic database failure'));
  service.runConfiguredBatch.mockResolvedValueOnce({
    claimed: 1,
    delivered: 0,
    skipped: 1,
    failed: 0,
  });
  lifecycle.onApplicationBootstrap();
  await vi.advanceTimersByTimeAsync(5000);
  expect(lifecycle.status()).toMatchObject({
    error: true,
    jobsProcessed: false,
    processedCount: 0,
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(lifecycle.status()).toMatchObject({
    error: false,
    jobsProcessed: true,
    processedCount: 1,
  });
  await lifecycle.onModuleDestroy();
});
