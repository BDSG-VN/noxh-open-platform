import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  app.enableShutdownHooks();
  const server = createServer((request, response) => {
    const live = request.method === 'GET' && request.url === '/health/live';
    response.writeHead(live ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify(
        live ? { status: 'alive', release: 'sprint-0', jobsProcessed: false } : { status: 404 },
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
