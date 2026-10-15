import { Body, Controller, Get, Headers, Inject, Param, Post, Put } from '@nestjs/common';
import { PrivacyService } from './privacy-service';
import { PhoneService } from './phone-service';
import { WorkforceAuth, organizationId } from './workforce';
import { version } from './admin-service';
@Controller('api/v1')
export class PrivacyController {
  constructor(
    @Inject(PrivacyService) readonly service: PrivacyService,
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
  ) {}
  @Get('privacy/notice') async notice() {
    return { notice: await this.service.current(organizationId()) };
  }
  @Get('citizen/privacy') async workspace(@Headers('authorization') h: unknown) {
    return this.service.workspace(await this.citizen.authenticate(h));
  }
  @Post('citizen/privacy/consent') async accept(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.choose(await this.citizen.authenticate(h), b);
  }
  @Post('citizen/privacy/withdraw') async withdraw(@Headers('authorization') h: unknown) {
    return this.service.withdraw(await this.citizen.authenticate(h));
  }
  @Put('citizen/privacy/restriction') async restriction(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.restrict(await this.citizen.authenticate(h), b);
  }
  @Post('citizen/privacy/requests') async request(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.request(await this.citizen.authenticate(h), b);
  }
  @Get('admin/privacy/notices') async notices(@Headers('authorization') h: unknown) {
    return this.service.notices(await this.staff.authenticate(h));
  }
  @Post('admin/privacy/notices') async draft(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.draft(await this.staff.authenticate(h), b);
  }
  @Post('admin/privacy/notices/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.review(await this.staff.authenticate(h), id, b);
  }
  @Get('admin/privacy/requests') async requests(@Headers('authorization') h: unknown) {
    return this.service.requests(await this.staff.authenticate(h));
  }
  @Put('admin/privacy/requests/:id') async respond(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.respond(await this.staff.authenticate(h), id, b, version(v));
  }
}
