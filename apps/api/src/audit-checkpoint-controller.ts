import { Body, Controller, Get, Headers, Inject, Param, Post, Query } from '@nestjs/common';
import { WorkforceAuth } from './workforce';
import { AuditCheckpointService } from './audit-checkpoint-service';

@Controller('api/v1/admin/audit/checkpoints')
export class AuditCheckpointController {
  constructor(
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(AuditCheckpointService) readonly service: AuditCheckpointService,
  ) {}
  @Get() async status(@Headers('authorization') h: unknown) {
    return this.service.status(await this.staff.authenticate(h));
  }
  @Post('proposals') async propose(@Headers('authorization') h: unknown, @Body() body: unknown) {
    return this.service.propose(await this.staff.authenticate(h), body);
  }
  @Get('proposals/:id/evidence') async evidence(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Query('afterSequence') after: unknown,
  ) {
    return this.service.evidence(await this.staff.authenticate(h), id, after ?? '0');
  }
  @Post('imports') async import(@Headers('authorization') h: unknown, @Body() body: unknown) {
    return this.service.import(await this.staff.authenticate(h), body);
  }
  @Post('verify') async verify(@Headers('authorization') h: unknown, @Body() body: unknown) {
    return this.service.verify(await this.staff.authenticate(h), body);
  }
}
