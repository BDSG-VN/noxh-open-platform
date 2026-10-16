import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { configure } from './bootstrap';
import { NotificationService } from './notification-service';
import { registerNotificationAdapters } from './notification-transports';
async function main() {
  if (process.env.LOTTERY_PRODUCTION_ENABLED === 'true')
    throw new Error('Production lottery remains disabled');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configure(app);
  registerNotificationAdapters(app.get(NotificationService));
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
}
main().catch((e: unknown) => {
  // Class and message only (configuration/connection problems); no environment or secrets.
  const cause = e instanceof Error ? e.name + ': ' + e.message : 'unknown';
  console.error('API startup failed; check local configuration (' + cause.slice(0, 300) + ')');
  process.exitCode = 1;
});
