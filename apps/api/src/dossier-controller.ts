import { Controller, Get, Post, Patch, Headers, Param, Body, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PhoneService } from './phone-service';
import { WorkforceAuth } from './workforce';
import { DossierService } from './dossier-service';
import { version } from './admin-service';
@Controller('api/v1')
export class DossierController {
  constructor(
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(DossierService) readonly service: DossierService,
  ) {}
  @Get('dossiers/:id') async detail(@Headers('authorization') h: unknown, @Param('id') id: string) {
    return this.service.detail(await this.citizen.authenticate(h), id);
  }
  @Patch('dossiers/:id/declarations') async save(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.save(await this.citizen.authenticate(h), id, body, version(v));
  }
  @Get('dossiers/:id/checklist') async checklist(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return (await this.service.detail(await this.citizen.authenticate(h), id)).readiness;
  }
  @Post('dossiers/:id/readiness') async readiness(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.assess(await this.citizen.authenticate(h), id, version(v));
  }
  @Post('dossiers/:id/support') async help(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.requestHelp(await this.citizen.authenticate(h), id, body);
  }
  @Post('citizen/requests/:id/close') async close(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.closeRequest(await this.citizen.authenticate(h), id, version(v));
  }
  @Get('admin/projects/:id/preparation-checklists') async checklists(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.checklists(await this.staff.authenticate(h), id);
  }
  @Post('admin/projects/:id/preparation-checklists') async draftChecklist(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.draftChecklist(await this.staff.authenticate(h), id, body);
  }
  @Post('admin/projects/:id/preparation-checklists/:checklistId/review') async reviewChecklist(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('checklistId') checklistId: string,
    @Body() body: unknown,
  ) {
    return this.service.reviewChecklist(await this.staff.authenticate(h), id, checklistId, body);
  }
  @Get('admin/requests') async requests(@Headers('authorization') h: unknown) {
    return { items: await this.service.requests(await this.staff.authenticate(h)) };
  }
  @Post('admin/requests/:id/reply') async reply(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reply(await this.staff.authenticate(h), id, body, version(v));
  }
  @Get('admin/audit') async audit(@Headers('authorization') h: unknown) {
    return this.service.audit(await this.staff.authenticate(h));
  }
  @Get('admin/audit/export') async auditExport(
    @Headers('authorization') h: unknown,
    @Res() res: Response,
  ) {
    const evidence = await this.service.auditExport(await this.staff.authenticate(h));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="noxh-audit-evidence.json"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(JSON.stringify(evidence));
  }
}
