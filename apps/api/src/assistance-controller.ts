import { Body, Controller, Get, Headers, Inject, Param, Post, Put, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AssistanceService } from './assistance-service';
import { OpenAiService } from './openai-service';
import { PhoneService } from './phone-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
@Controller('api/v1')
export class AssistanceController {
  constructor(
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(AssistanceService) readonly service: AssistanceService,
    @Inject(OpenAiService) readonly ai: OpenAiService,
  ) {}
  @Get('legal/forms/:form') async form(@Param('form') id: string, @Res() res: Response) {
    const f = await this.service.pdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + f.file + '"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(f.bytes);
  }
  @Get('admin/legal/catalog') async catalog(@Headers('authorization') h: unknown) {
    await this.staff.authenticate(h);
    return this.service.catalog();
  }
  @Get('admin/projects/:project/forms') async forms(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
  ) {
    return { items: await this.service.projectForms(await this.staff.authenticate(h), project) };
  }
  @Post('admin/projects/:project/forms') async release(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
    @Body() b: unknown,
  ) {
    return this.service.publish(await this.staff.authenticate(h), project, b);
  }
  @Post('admin/projects/:project/forms/:form/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
    @Param('form') form: string,
    @Body() b: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), project, form, b);
  }
  @Get('dossiers/:id/services') async workspace(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.workspace(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/online-cases') async createCase(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.saveCase(await this.citizen.authenticate(h), id, b);
  }
  @Put('dossiers/:id/online-cases/:case') async updateCase(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('case') ref: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.saveCase(await this.citizen.authenticate(h), id, b, ref, version(v));
  }
  @Get('admin/settings/openai') async settings(@Headers('authorization') h: unknown) {
    return this.ai.settings(await this.staff.authenticate(h));
  }
  @Put('admin/settings/openai') async configure(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.ai.configure(await this.staff.authenticate(h), b, version(v));
  }
  @Get('dossiers/:id/assistant') async status(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.ai.status(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/assistant') async ask(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.ai.ask(await this.citizen.authenticate(h), id, b);
  }
  @Post('dossiers/:id/assistant/:proposal/confirm') async confirm(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('proposal') proposal: string,
    @Body() b: unknown,
  ) {
    return this.ai.confirm(await this.citizen.authenticate(h), id, proposal, b);
  }
}
