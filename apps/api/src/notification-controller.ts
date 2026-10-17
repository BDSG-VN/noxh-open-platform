import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { NotificationService } from './notification-service';
import { NotificationDeliveryService } from './notification-delivery-service';
import { WorkforceAuth } from './workforce';
import { PhoneService } from './phone-service';
import { version } from './admin-service';
@Controller('api/v1')
export class NotificationController {
  constructor(
    @Inject(NotificationService) readonly service: NotificationService,
    @Inject(NotificationDeliveryService) readonly delivery: NotificationDeliveryService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(PhoneService) readonly phone: PhoneService,
  ) {}
  @Get('admin/notifications/projects/:project/workspace') async workspace(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.workspace(await this.staff.authenticate(h), p);
  }
  @Post('admin/notifications/projects/:project/templates') async draft(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.draft(await this.staff.authenticate(h), p, b);
  }
  @Post('admin/notifications/projects/:project/templates/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/notifications/projects/:project/queue') async queue(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.queue(await this.staff.authenticate(h), p, b);
  }
  @Post('admin/notifications/projects/:project/messages/:id/deliver') async deliver(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.deliver(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/notifications/projects/:project/transports') async configure(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.configure(await this.staff.authenticate(h), p, b, version(v));
  }
  @Get('admin/notifications/providers') async providers(@Headers('authorization') h: unknown) {
    return this.delivery.providers(await this.staff.authenticate(h));
  }
  @Post('admin/notifications/providers/:channel') async configureProvider(
    @Headers('authorization') h: unknown,
    @Param('channel') channel: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.delivery.configureProvider(
      await this.staff.authenticate(h),
      channel,
      b,
      version(v),
    );
  }
  @Get('admin/notifications/projects/:project/deliveries') async deliveries(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.delivery.deliveries(await this.staff.authenticate(h), p);
  }
  @Post('admin/notifications/projects/:project/deliveries/:id/requeue') async requeue(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.delivery.requeue(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Get('citizen/notifications/workspace') async citizen(@Headers('authorization') h: unknown) {
    return this.service.citizenWorkspace(await this.phone.authenticate(h));
  }
  @Post('citizen/notifications/projects/:project/preferences') async preference(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.preference(await this.phone.authenticate(h), p, b, version(v));
  }
  @Post('citizen/notifications/messages/:id/read') async read(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.read(await this.phone.authenticate(h), id, b, version(v));
  }
}
