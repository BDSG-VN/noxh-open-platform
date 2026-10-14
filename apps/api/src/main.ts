import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { configure } from './bootstrap';
async function main() {
  if (
    process.env.EXTERNAL_AI_ENABLED === 'true' ||
    process.env.LOTTERY_PRODUCTION_ENABLED === 'true'
  )
    throw new Error('Sprint 0 forbids external AI and production lottery');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configure(app);
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
}
main().catch(() => {
  console.error('API startup failed; check local configuration');
  process.exitCode = 1;
});
