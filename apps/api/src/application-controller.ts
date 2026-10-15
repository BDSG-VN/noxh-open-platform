import { Body, Controller, Delete, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApplicationService } from './application-service';
import { DocumentService } from './document-service';
import { FormService } from './form-service';
import { PhoneService } from './phone-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
@Controller('api/v1')
export class ApplicationController {
  constructor(
    @Inject(ApplicationService) readonly service: ApplicationService,
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(DocumentService) readonly documents: DocumentService,
    @Inject(FormService) readonly forms: FormService,
  ) {}
  @Get('dossiers/:id/submission') async workspace(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.submissionWorkspace(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/applications') async submit(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.service.submit(await this.citizen.authenticate(h), id, b, key);
  }
  @Get('citizen/applications') async mine(@Headers('authorization') h: unknown) {
    return this.service.mine(await this.citizen.authenticate(h));
  }
  @Get('citizen/applications/:id') async detail(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.detail(await this.citizen.authenticate(h), id);
  }
  @Delete('citizen/applications/:id') async withdraw(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.withdraw(await this.citizen.authenticate(h), id, version(v));
  }
  @Post('citizen/applications/:id/supplements') async supplement(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.supplement(await this.citizen.authenticate(h), id, b, version(v));
  }
  @Post('citizen/applications/:id/appeals') async appeal(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.service.appeal(await this.citizen.authenticate(h), id, b);
  }
  @Get('admin/applications') async list(@Headers('authorization') h: unknown) {
    return this.service.list(await this.staff.authenticate(h));
  }
  @Get('admin/applications/:id') async staffDetail(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.service.staffDetail(await this.staff.authenticate(h), id);
  }
  @Post('admin/applications/:id/assign') async assign(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.assign(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/applications/:id/supplement-request') async request(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.requestSupplement(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/applications/:id/recommend') async recommend(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.recommend(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/applications/:id/decide') async decide(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.decide(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/applications/:id/reopen') async reopen(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reopen(await this.staff.authenticate(h), id, b, version(v));
  }
  @Post('admin/applications/:id/appeals/:appeal/respond') async respond(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('appeal') appeal: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.respondAppeal(await this.staff.authenticate(h), id, appeal, b, version(v));
  }
  @Get('admin/applications/:id/documents/:document/download') async document(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
    @Res() res: Response,
  ) {
    const s = await this.staff.authenticate(h);
    await this.service.authorizeDocument(s, id, doc);
    const f = await this.documents.readForAuthorizedStaff(doc, s.organizationId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' +
        f.filename +
        ({ 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' }[f.mime] ?? '') +
        '"',
    );
    res.send(Buffer.from(f.bytes));
  }
  @Get('admin/applications/:id/forms/:form/download') async form(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('form') form: string,
    @Res() res: Response,
  ) {
    const s = await this.staff.authenticate(h);
    await this.service.authorizeForm(s, id, form);
    const f = await this.forms.readForAuthorizedStaff(form, s.organizationId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="submitted-form.pdf"');
    res.send(Buffer.from(f.bytes));
  }
}
