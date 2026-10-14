import 'reflect-metadata';
import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Post,
  Res,
  ServiceUnavailableException,
  NotImplementedException,
  NotFoundException,
} from '@nestjs/common';
import type { Response } from 'express';
import { demoProjects } from '@noxh/contracts';
import { HealthService } from './health';
@Controller()
export class PlatformController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}
  @Get('health/live') live() {
    return { status: 'alive', release: 'sprint-0', productionReady: false };
  }
  @Get('health/ready') async ready(@Res({ passthrough: true }) res: Response) {
    const result = await this.health.check();
    if (result.status !== 'ready') {
      res.status(503);
      res.type('application/problem+json');
      return {
        type: 'urn:noxh:problem:not-ready',
        title: 'Dependencies unavailable',
        status: 503,
        detail: 'Postgres, Redis and migration 001 must be ready.',
        checks: result.checks,
      };
    }
    return result;
  }
  @Get('api/v1/projects') projects() {
    this.assertFixtures();
    return { items: demoProjects, mode: 'synthetic', release: 'sprint-0' };
  }
  @Get('api/v1/projects/:id') project(@Param('id') id: string) {
    this.assertFixtures();
    const p = demoProjects.find((x) => x.id === id);
    if (!p) throw new NotFoundException('Project not available in synthetic fixture catalog');
    return p;
  }
  @Get('api/v1/capabilities') capabilities() {
    return {
      release: 'sprint-0',
      externalAi: false,
      officialSubmission: false,
      officialForms: false,
      lottery: false,
      zaloTokenExchange: false,
    };
  }
  @Post('api/v1/auth/zalo/exchange') zalo(): never {
    throw new NotImplementedException(
      'Zalo server verification is not integrated; no session issued',
    );
  }
  private assertFixtures() {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_SYNTHETIC_FIXTURES !== 'true')
      throw new ServiceUnavailableException('Synthetic project catalog disabled');
  }
}
@Module({ controllers: [PlatformController], providers: [HealthService] })
export class AppModule {}
