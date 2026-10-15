import { Body, Controller, Get, Headers, Inject, Param, Post } from '@nestjs/common';
import { LotteryService } from './lottery-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
@Controller('api/v1')
export class LotteryController {
  constructor(
    @Inject(LotteryService) readonly service: LotteryService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
  ) {}
  @Get('admin/lotteries') async list(@Headers('authorization') h: unknown) {
    return this.service.list(await this.staff.authenticate(h));
  }
  @Post('admin/lotteries') async create(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.create(await this.staff.authenticate(h), b);
  }
  @Post('admin/lotteries/priority-calculation') async calculate(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    await this.staff.authenticate(h);
    return this.service.calculate(b);
  }
  @Post('admin/lotteries/eligibility-evidence') async eligible(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.eligibilityEvidence(await this.staff.authenticate(h), b);
  }
  @Get('admin/lotteries/cohorts') async cohorts(@Headers('authorization') h: unknown) {
    return { items: await this.service.cohorts(await this.staff.authenticate(h)) };
  }
  @Get('admin/lotteries/cohort-source/:round/:mode') async cohortSource(
    @Headers('authorization') h: unknown,
    @Param('round') round: string,
    @Param('mode') mode: string,
  ) {
    return this.service.cohortSource(await this.staff.authenticate(h), round, mode);
  }
  @Post('admin/lotteries/cohorts') async draftCohort(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
  ) {
    return this.service.draftCohort(await this.staff.authenticate(h), b);
  }
  @Post('admin/lotteries/cohorts/:id/review') async reviewCohort(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewCohort(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/lotteries/cohorts/:id/void') async voidCohort(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.voidCohort(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/lotteries/:id/:action') async transition(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.transition(await this.staff.authenticate(h), id, action, b, version(v));
  }
  @Get('lotteries') async publicList() {
    return this.service.publicList();
  }
  @Get('lotteries/:id') async publicOne(@Param('id') id: string) {
    return this.service.publicOne(id);
  }
}
