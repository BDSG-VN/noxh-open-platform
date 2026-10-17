import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  Logger,
} from '@nestjs/common';
import helmet from 'helmet';
import type { Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { channelCors, channelCorsOrigins } from './channel-cors';
import { trustedProxyCidrs } from './client-peer';
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message = error instanceof HttpException ? error.message : 'Unexpected error';
    if (status >= 500) {
      // Class, message and route only: never headers, bodies or query strings (tokens, PII).
      const request = ctx.getRequest<Request>();
      const cause = error instanceof Error ? error.name + ': ' + error.message : String(error);
      this.logger.error(`${request.method} ${request.path} -> ${status} ${cause.slice(0, 300)}`);
    }
    ctx
      .getResponse<Response>()
      .status(status)
      .type('application/problem+json')
      .json({
        type: `urn:noxh:problem:http-${status}`,
        title: status === 500 ? 'Internal error' : 'Request cannot be completed',
        status,
        detail: message,
        instance: ctx.getRequest<Request>().path,
      });
  }
}
export function configure(app: INestApplication) {
  const proxies = trustedProxyCidrs(process.env.TRUSTED_PROXY_CIDRS ?? '');
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', proxies.length ? proxies : false);
  const origins = channelCorsOrigins(
    process.env.ZALO_MINIAPP_ALLOWED_ORIGINS ?? '',
    process.env.NODE_ENV === 'production',
  );
  app.use(channelCors(origins));
  (app as NestExpressApplication).useBodyParser('json', { limit: '8mb' });
  app.use(helmet());
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
}
