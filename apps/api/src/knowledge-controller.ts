import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { KnowledgeService } from './knowledge-service';
import { WorkforceAuth } from './workforce';
import { PhoneService } from './phone-service';
@Controller('api/v1')
export class KnowledgeController {
  constructor(
    @Inject(KnowledgeService) readonly service: KnowledgeService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(PhoneService) readonly citizen: PhoneService,
  ) {}
  @Get('admin/knowledge/projects/:project') async list(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.list(await this.staff.authenticate(h), p);
  }
  @Post('admin/knowledge/projects/:project') async draft(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.draft(await this.staff.authenticate(h), p, b);
  }
  @Post('admin/knowledge/projects/:project/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), p, id, b);
  }
  @Post('dossiers/:id/knowledge/search') async search(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.search(await this.citizen.authenticate(h), id, b);
  }
}
