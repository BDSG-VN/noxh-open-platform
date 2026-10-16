import { Body, Controller, Get, Headers, Inject, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ZaloIdentityService } from './zalo-identity-service';
import { WorkforceAuth } from './workforce';
import { version } from './admin-service';
import { clientPeer } from './client-peer';
@Controller('api/v1')
export class ZaloIdentityController {
  constructor(
    @Inject(ZaloIdentityService) readonly service: ZaloIdentityService,
    @Inject(WorkforceAuth) readonly workforce: WorkforceAuth,
  ) {}
  @Get('auth/zalo/status') status() {
    return this.service.status();
  }
  @Post('auth/zalo/challenges') challenge(@Body() b: unknown, @Req() r: Request) {
    return this.service.challenge(b, clientPeer(r));
  }
  @Post('auth/zalo/exchange') exchange(@Body() b: unknown, @Req() r: Request) {
    return this.service.exchange(b, clientPeer(r));
  }
  @Post('auth/link/start') start(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.startLink(h, b, clientPeer(r));
  }
  @Post('auth/link/confirm') confirm(
    @Headers('authorization') h: unknown,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.service.confirmLink(h, b, clientPeer(r));
  }
  @Get('admin/settings/zalo-miniapp') async settings(@Headers('authorization') h: unknown) {
    return this.service.settings(await this.workforce.authenticate(h));
  }
  @Put('admin/settings/zalo-miniapp') async configure(
    @Headers('authorization') h: unknown,
    @Headers('if-match') v: unknown,
    @Body() b: unknown,
  ) {
    return this.service.configure(await this.workforce.authenticate(h), b, version(v));
  }
}
