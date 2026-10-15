import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { WorkforceAuth } from './workforce';
import { InternalFileService } from './internal-file-service';
@Controller('api/v1/admin/operations/projects/:project/files')
export class InternalFileController {
  constructor(
    @Inject(WorkforceAuth) readonly staff: WorkforceAuth,
    @Inject(InternalFileService) readonly service: InternalFileService,
  ) {}
  @Get() async list(@Headers('authorization') h: unknown, @Param('project') p: string) {
    return this.service.list(await this.staff.authenticate(h), p);
  }
  @Post() async upload(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.upload(await this.staff.authenticate(h), p, b);
  }
  @Post(':file/scan') async scan(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('file') f: string,
  ) {
    return this.service.scan(await this.staff.authenticate(h), p, f);
  }
  @Get(':file/download') async download(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('file') f: string,
    @Res() res: Response,
  ) {
    const file = await this.service.download(await this.staff.authenticate(h), p, f);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', 'attachment; filename="' + file.filename + '"');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.bytes);
  }
}
