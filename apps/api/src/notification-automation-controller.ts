import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { NotificationAutomationService } from './notification-automation-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
@Controller('api/v1/admin/notifications/projects/:project/automation')
export class NotificationAutomationController {
  constructor(
    @Inject(NotificationAutomationService) readonly service: NotificationAutomationService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
  ) {}
  @Get() async workspace(@Headers('authorization') h: unknown, @Param('project') p: string) {
    return this.service.workspace(await this.staff.authenticate(h), p);
  }
  @Post('policies') async draft(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.draft(await this.staff.authenticate(h), p, b);
  }
  @Post('policies/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), p, id, b, version(v));
  }
}
