import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
} from '@nestjs/common';
import helmet from 'helmet';
import type { Request, Response } from 'express';
@Catch()
class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const message = error instanceof HttpException ? error.message : 'Unexpected error';
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
  app.use(helmet());
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
}
