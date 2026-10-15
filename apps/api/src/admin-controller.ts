import { Controller, Get, Post, Put, Delete, Param, Body, Headers, Inject } from '@nestjs/common';
import { WorkforceAuth } from './workforce';
import { AdminService, version } from './admin-service';
@Controller('api/v1/admin')
export class AdminController {
  constructor(
    @Inject(WorkforceAuth) readonly auth: WorkforceAuth,
    @Inject(AdminService) readonly service: AdminService,
  ) {}
  @Post('logout') async logout(@Headers('authorization') h: unknown) {
    return this.auth.logout(h);
  }
  @Get('me') async me(@Headers('authorization') h: unknown) {
    return this.auth.authenticate(h);
  }
  @Get('dashboard') async dashboard(@Headers('authorization') h: unknown) {
    return this.service.dashboard(await this.auth.authenticate(h));
  }
  @Get('projects') async projects(@Headers('authorization') h: unknown) {
    return { items: await this.service.projects(await this.auth.authenticate(h)) };
  }
  @Post('projects') async create(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.createProject(await this.auth.authenticate(h), b);
  }
  @Put('projects/:id') async update(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.updateProject(await this.auth.authenticate(h), id, b, version(v));
  }
  @Delete('projects/:id') async archive(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.updateProject(await this.auth.authenticate(h), id, {}, version(v), true);
  }
  @Get('rounds') async rounds(@Headers('authorization') h: unknown) {
    return { items: await this.service.rounds(await this.auth.authenticate(h)) };
  }
  @Post('rounds') async round(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.saveRound(await this.auth.authenticate(h), b);
  }
  @Put('rounds/:id') async changeRound(
    @Headers('authorization') h: unknown,
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.saveRound(await this.auth.authenticate(h), b, id, version(v));
  }
  @Get('settings/zalo') async settings(@Headers('authorization') h: unknown) {
    return this.service.settings(await this.auth.authenticate(h));
  }
  @Put('settings/zalo') async saveSettings(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
    @Headers('if-match') v: unknown,
  ) {
    return this.service.saveSettings(await this.auth.authenticate(h), b, version(v));
  }
}
