import { Body, Controller, Get, Headers, Inject, Param, Post, Delete, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PhoneService } from './phone-service';
import { WorkforceAuth } from './workforce';
import { DocumentService } from './document-service';
import { FormService } from './form-service';
import { DocumentOcrService } from './document-ocr-service';
import { version } from './admin-service';
@Controller('api/v1')
export class DocumentController {
  constructor(
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(DocumentService) readonly docs: DocumentService,
    @Inject(FormService) readonly forms: FormService,
    @Inject(DocumentOcrService) readonly ocr: DocumentOcrService,
  ) {}
  @Get('dossiers/:id/ocr-jobs') async ocrJobs(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.ocr.workspace(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/documents/:document/ocr') async requestOcr(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
    @Body() b: unknown,
  ) {
    return this.ocr.request(await this.citizen.authenticate(h), id, doc, b);
  }
  @Get('dossiers/:id/ocr-jobs/:job') async ocrJob(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('job') job: string,
  ) {
    return this.ocr.detail(await this.citizen.authenticate(h), id, job);
  }
  @Post('dossiers/:id/ocr-jobs/:job/cancel') async cancelOcr(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('job') job: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.ocr.cancel(await this.citizen.authenticate(h), id, job, version(v));
  }
  @Get('admin/ocr/queue') async ocrQueue(@Headers('authorization') h: unknown) {
    return this.ocr.health(await this.staff.authenticate(h));
  }
  @Post('admin/ocr/jobs/:job/requeue') async requeueOcr(
    @Headers('authorization') h: unknown,
    @Param('job') job: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.ocr.requeue(await this.staff.authenticate(h), job, b, version(v));
  }
  @Get('dossiers/:id/documents') async list(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.docs.workspace(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/documents') async upload(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.docs.upload(await this.citizen.authenticate(h), id, b);
  }
  @Post('dossiers/:id/documents/:document/scan') async scan(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
  ) {
    return this.docs.scan(await this.citizen.authenticate(h), id, doc);
  }
  @Post('dossiers/:id/documents/:document/extract') async extract(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
    @Body() b: unknown,
  ) {
    return this.docs.extract(await this.citizen.authenticate(h), id, doc, b);
  }
  @Post('dossiers/:id/extractions/:extraction/accept') async accept(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('extraction') extraction: string,
    @Body() b: unknown,
  ) {
    return this.docs.accept(await this.citizen.authenticate(h), id, extraction, b);
  }
  @Delete('dossiers/:id/documents/:document') async remove(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
  ) {
    return this.docs.remove(await this.citizen.authenticate(h), id, doc);
  }
  @Get('dossiers/:id/documents/:document/download') async download(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('document') doc: string,
    @Res() res: Response,
  ) {
    return this.send(res, await this.docs.download(await this.citizen.authenticate(h), id, doc));
  }
  @Get('admin/projects/:project/form-mappings') async mappings(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
  ) {
    return this.forms.mappings(await this.staff.authenticate(h), project);
  }
  @Post('admin/projects/:project/form-mappings') async draft(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
    @Body() b: unknown,
  ) {
    return this.forms.draft(await this.staff.authenticate(h), project, b);
  }
  @Get('admin/projects/:project/form-mappings/:mapping/preview')
  async preview(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
    @Param('mapping') mapping: string,
    @Res() res: Response,
  ) {
    return this.send(
      res,
      await this.forms.preview(await this.staff.authenticate(h), project, mapping),
    );
  }
  @Post('admin/projects/:project/form-mappings/:mapping/review') async review(
    @Headers('authorization') h: unknown,
    @Param('project') project: string,
    @Param('mapping') mapping: string,
    @Body() b: unknown,
  ) {
    return this.forms.review(await this.staff.authenticate(h), project, mapping, b);
  }
  @Get('dossiers/:id/form-workspace') async formWorkspace(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
  ) {
    return this.forms.workspace(await this.citizen.authenticate(h), id);
  }
  @Post('dossiers/:id/generated-forms') async generate(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.forms.generate(await this.citizen.authenticate(h), id, b);
  }
  @Get('dossiers/:id/form-packet')
  async packet(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    return this.send(res, await this.forms.packet(await this.citizen.authenticate(h), id));
  }
  @Get('dossiers/:id/generated-forms/:form') async detail(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('form') form: string,
  ) {
    return this.forms.detail(await this.citizen.authenticate(h), id, form);
  }
  @Post('dossiers/:id/generated-forms/:form/confirm') async confirm(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('form') form: string,
    @Body() b: unknown,
  ) {
    return this.forms.confirm(await this.citizen.authenticate(h), id, form, b);
  }
  @Get('dossiers/:id/generated-forms/:form/download') async formDownload(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Param('form') form: string,
    @Res() res: Response,
  ) {
    return this.send(res, await this.forms.download(await this.citizen.authenticate(h), id, form));
  }
  private send(res: Response, file: { bytes: Uint8Array; mime: string; filename: string }) {
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', 'attachment; filename="' + file.filename + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.from(file.bytes));
  }
}
