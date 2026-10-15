import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { configure } from './bootstrap';
async function main() {
  if (process.env.LOTTERY_PRODUCTION_ENABLED === 'true')
    throw new Error('Production lottery remains disabled');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configure(app);
  await app.listen(Number(process.env.PORT ?? 4000), process.env.HOST ?? '127.0.0.1');
}
main().catch(() => {
  console.error('API startup failed; check local configuration');
  process.exitCode = 1;
});
