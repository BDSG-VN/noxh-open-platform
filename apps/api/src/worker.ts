import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { NotificationAutomationService } from './notification-automation-service';
import { NotificationAutomationLifecycle } from './notification-automation-lifecycle';
import { NotificationDeliveryService } from './notification-delivery-service';
import { NotificationDeliveryLifecycle } from './notification-delivery-lifecycle';
import { NotificationService } from './notification-service';
import { registerNotificationAdapters } from './notification-transports';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  // Reviewed external adapters are attached by the operator process only, never from requests.
  registerNotificationAdapters(app.get(NotificationService));
  if (process.argv.includes('--notifications-once')) {
    const service = app.get(NotificationAutomationService);
    const result = await service.runConfiguredBatch();
    const delivery = app.get(NotificationDeliveryService);
    const sent = await delivery.runConfiguredBatch();
    console.log(
      JSON.stringify({
        scope: 'synthetic-in-app-application-notifications',
        enabled: Boolean(service.configuredOrganization()),
        ...result,
        delivery: { enabled: Boolean(delivery.configuredOrganization()), ...sent },
      }),
    );
    await app.close();
    if (result.failed > 0 || sent.workerFailures > 0) process.exitCode = 1;
    return;
  }
  const automation = app.get(NotificationAutomationLifecycle);
  const delivery = app.get(NotificationDeliveryLifecycle);
  const server = createServer((request, response) => {
    const live = request.method === 'GET' && request.url === '/health/live';
    response.writeHead(live ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify(
        live
          ? {
              status: 'alive',
              release: '0.6.0',
              ...automation.status(),
              delivery: delivery.status(),
            }
          : { status: 404 },
      ),
    );
  });
  server.listen(4101, '0.0.0.0');
  process.once('SIGTERM', () => server.close());
  process.once('SIGINT', () => server.close());
}
main().catch(() => {
  console.error('Worker startup failed');
  process.exitCode = 1;
});
