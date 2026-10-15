import { Body, Controller, Get, Headers, Inject, Param, Post, Put } from '@nestjs/common';
import { OperationsService } from './operations-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
@Controller('api/v1/admin/operations')
export class OperationsController {
  constructor(
    @Inject(WorkforceAuth) readonly auth: WorkforceAuth,
    @Inject(OperationsService) readonly service: OperationsService,
  ) {}
  @Get('projects') async projects(@Headers('authorization') h: unknown) {
    return { items: await this.service.projects(await this.auth.authenticate(h)) };
  }
  @Get('employees') async employees(@Headers('authorization') h: unknown) {
    return { items: await this.service.employees(await this.auth.authenticate(h)) };
  }
  @Post('employees') async employee(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.saveEmployee(await this.auth.authenticate(h), b);
  }
  @Put('employees/:id') async changeEmployee(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.saveEmployee(await this.auth.authenticate(h), b, id, version(v));
  }
  @Get('projects/:project/workflow') async workflow(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.workflow(await this.auth.authenticate(h), p);
  }
  @Post('projects/:project/workflow') async initialize(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return this.service.initialize(await this.auth.authenticate(h), p);
  }
  @Post('projects/:project/workflow/activate') async activate(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.activate(await this.auth.authenticate(h), p, b, version(v));
  }
  @Put('projects/:project/workflow/tasks/:code') async task(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('code') c: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.updateTask(await this.auth.authenticate(h), p, c, b, version(v));
  }
  @Post('projects/:project/workflow/tasks/:code/review') async taskReview(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('code') c: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.completeTask(await this.auth.authenticate(h), p, c, version(v));
  }
  @Get('projects/:project/records') async records(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return { items: await this.service.records(await this.auth.authenticate(h), p) };
  }
  @Post('projects/:project/records') async record(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.saveRecord(await this.auth.authenticate(h), p, b);
  }
  @Post('projects/:project/records/:id/review') async recordReview(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.reviewRecord(await this.auth.authenticate(h), p, id, b, version(v));
  }
  @Get('projects/:project/journals') async journals(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
  ) {
    return { items: await this.service.journals(await this.auth.authenticate(h), p) };
  }
  @Post('projects/:project/journals') async journal(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Body() b: unknown,
  ) {
    return this.service.createJournal(await this.auth.authenticate(h), p, b);
  }
  @Post('projects/:project/journals/:id/post') async postJournal(
    @Headers('authorization') h: unknown,
    @Param('project') p: string,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.postJournal(await this.auth.authenticate(h), p, id, version(v));
  }
}
