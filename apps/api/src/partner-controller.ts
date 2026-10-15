import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Put } from '@nestjs/common';
import { PhoneService } from './phone-service';
import { WorkforceAuth } from './workforce';
import { PartnerService } from './partner-service';
import { version } from './admin-service';
@Controller('api/v1')
export class PartnerController {
  constructor(
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(PartnerService) readonly service: PartnerService,
  ) {}
  @Get('admin/partners') async list(@Headers('authorization') h: unknown) {
    return { items: await this.service.list(await this.staff.authenticate(h)) };
  }
  @Post('admin/partners') async create(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.create(await this.staff.authenticate(h), b);
  }
  @Put('admin/partners/:id') async update(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.update(await this.staff.authenticate(h), id, b, version(v));
  }
  @Get('admin/partners/:id/members') async members(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.members(await this.staff.authenticate(h), id);
  }
  @Post('admin/partners/:id/members') async add(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.addMember(await this.staff.authenticate(h), id, b);
  }
  @Put('admin/partners/:id/members/:member') async edit(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('member') member: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.updateMember(await this.staff.authenticate(h), id, member, b, version(v));
  }
  @Get('admin/partner-campaigns') async campaigns(@Headers('authorization') h: unknown) {
    return { items: await this.service.campaigns(await this.staff.authenticate(h)) };
  }
  @Post('admin/partner-campaigns/:id/review') async review(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewCampaign(await this.staff.authenticate(h), id, b, version(v));
  }
  @Get('partner/workspace') async workspace(@Headers('authorization') h: unknown) {
    return this.service.workspace(await this.citizen.authenticate(h));
  }
  @Post('partner/members') async invite(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.inviteMember(await this.citizen.authenticate(h), b);
  }
  @Put('partner/members/:id') async member(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.editMember(await this.citizen.authenticate(h), id, b, version(v));
  }
  @Post('partner/campaigns') async save(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.saveCampaign(await this.citizen.authenticate(h), b);
  }
  @Put('partner/campaigns/:id') async campaign(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.saveCampaign(await this.citizen.authenticate(h), b, id, version(v));
  }
  @Post('partner/campaigns/:id/submit') async submit(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.submitCampaign(await this.citizen.authenticate(h), id, version(v));
  }
  @Get('partner/leads') async leads(@Headers('authorization') h: unknown) {
    return { items: await this.service.leads(await this.citizen.authenticate(h)) };
  }
  @Put('partner/leads/:id') async lead(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.updateLead(await this.citizen.authenticate(h), id, b, version(v));
  }
  @Post('partner/leads/:id/assign') async assign(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.assign(await this.citizen.authenticate(h), id, b, version(v));
  }
  @Get('campaigns/:id') async publicCampaign(@Param('id') id: string) {
    return this.service.campaign(id);
  }
  @Post('citizen/consultations/:campaign') async consult(
    @Headers('authorization') h: unknown,
    @Param('campaign') id: string,
    @Body() b: unknown,
  ) {
    return this.service.consult(await this.citizen.authenticate(h), id, b);
  }
  @Get('citizen/consultations') async mine(@Headers('authorization') h: unknown) {
    return { items: await this.service.myConsultations(await this.citizen.authenticate(h)) };
  }
  @Delete('citizen/consultations/:id') async withdraw(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.withdraw(await this.citizen.authenticate(h), id, version(v));
  }
}
