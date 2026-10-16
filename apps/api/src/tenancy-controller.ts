import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { TenancyService } from './tenancy-service';
import { WorkforceAuth } from './workforce';
import { PhoneService } from './phone-service';
import { version } from './admin-service';
@Controller('api/v1')
export class TenancyController {
  constructor(
    @Inject(TenancyService) readonly service: TenancyService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(PhoneService) readonly phone: PhoneService,
  ) {}
  @Get('admin/tenancy/projects/:project/contracts') async list(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.list(await this.staff.authenticate(h), p);
  }
  @Get('admin/tenancy/projects/:project/options') async options(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.options(await this.staff.authenticate(h), p);
  }
  @Get('admin/tenancy/projects/:project/contracts/:id') async detail(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
  ) {
    return this.service.detail(await this.staff.authenticate(h), p, id);
  }
  @Post('admin/tenancy/projects/:project/contracts') async draft(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.draft(await this.staff.authenticate(h), p, b);
  }
  @Post('admin/tenancy/projects/:project/contracts/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/tenancy/projects/:project/contracts/:id/payments') async payment(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.payment(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/tenancy/projects/:project/payments/:id/review') async reviewPayment(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewPayment(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/tenancy/projects/:project/contracts/:id/actions') async action(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.propose(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Post('admin/tenancy/projects/:project/actions/:id/review') async reviewAction(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewAction(await this.staff.authenticate(h), p, id, b, version(v));
  }
  @Get('citizen/tenancy/contracts') async citizen(@Headers('authorization') h: unknown) {
    return this.service.citizenList(await this.phone.authenticate(h));
  }
  @Get('citizen/tenancy/contracts/:id') async citizenDetail(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.citizenDetail(await this.phone.authenticate(h), id);
  }
  @Post('citizen/tenancy/contracts/:id/confirm') async confirm(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.confirm(await this.phone.authenticate(h), id, b, version(v));
  }
  @Post('citizen/tenancy/actions/:id/confirm') async confirmAction(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.confirmAction(await this.phone.authenticate(h), id, b, version(v));
  }
}
