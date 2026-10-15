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
import { Database } from './database';
import { WorkforceAuth, organizationId } from './workforce';
import { AdminService } from './admin-service';
import { AdminController } from './admin-controller';
import { PhoneController } from './phone-controller';
import { PhoneService, ZaloDelivery } from './phone-service';
import { DossierService } from './dossier-service';
import { DossierController } from './dossier-controller';
import { PartnerController } from './partner-controller';
import { PartnerService } from './partner-service';
import { AssistanceController } from './assistance-controller';
import { AssistanceService } from './assistance-service';
import { OpenAiService, OpenAiTransport } from './openai-service';
@Controller()
export class PlatformController {
  constructor(
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(Database) private readonly db: Database,
  ) {}
  @Get('health/live') live() {
    return { status: 'alive', release: '0.4.0', productionReady: false };
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
        detail: 'Postgres, Redis and migrations 001–005 must be ready.',
        checks: result.checks,
      };
    }
    return result;
  }
  private async catalog() {
    if (!this.db.available) {
      this.assertFixtures();
      return demoProjects;
    }
    try {
      const rows = await this.db.query(
        `SELECT id,organization_id,name,locality,is_synthetic FROM projects WHERE organization_id=$1 AND publication_status='published' AND archived_at IS NULL ORDER BY created_at DESC`,
        [organizationId()],
      );
      return rows.map((r) => ({
        id: String(r.id),
        organizationId: String(r.organization_id),
        name: String(r.name),
        locality: String(r.locality),
        phase: 'preparation' as const,
        synthetic: Boolean(r.is_synthetic),
      }));
    } catch {
      throw new ServiceUnavailableException('Danh mục dự án tạm thời không khả dụng');
    }
  }
  @Get('api/v1/projects') async projects() {
    return {
      items: await this.catalog(),
      mode: this.db.available ? 'database' : 'synthetic',
      release: '0.4.0',
    };
  }
  @Get('api/v1/projects/:id') async project(@Param('id') id: string) {
    const p = (await this.catalog()).find((x) => x.id === id);
    if (!p) throw new NotFoundException('Dự án chưa công bố hoặc không tồn tại');
    return p;
  }
  @Get('api/v1/projects/:id/rounds') async publicRounds(@Param('id') id: string) {
    await this.project(id);
    if (!this.db.available) return { items: [] };
    return {
      items: await this.db.query(
        "SELECT id,name,status,opens_at,closes_at FROM intake_rounds WHERE project_id=$1 AND organization_id=$2 AND status IN('open','closed') ORDER BY opens_at DESC",
        [id, organizationId()],
      ),
    };
  }
  @Get('api/v1/capabilities') capabilities() {
    return {
      release: '0.4.0',
      externalAi: 'organization-opt-in',
      officialSubmission: false,
      officialForms: 'source-catalog-project-review',
      dvc: 'manual-handoff',
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
@Module({
  controllers: [
    PlatformController,
    AdminController,
    PhoneController,
    DossierController,
    AssistanceController,
    PartnerController,
  ],
  providers: [
    HealthService,
    Database,
    WorkforceAuth,
    AdminService,
    PhoneService,
    ZaloDelivery,
    DossierService,
    AssistanceService,
    PartnerService,
    OpenAiService,
    OpenAiTransport,
  ],
})
export class AppModule {}
