import { Controller, Get, Post, Body, Headers, Inject, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PhoneService } from './phone-service';
import { clientPeer } from './client-peer';
@Controller('api/v1')
export class PhoneController {
  constructor(@Inject(PhoneService) readonly service: PhoneService) {}
  @Post('auth/phone/request') request(@Body() body: unknown, @Req() req: Request) {
    return this.service.request(body, clientPeer(req));
  }
  @Post('auth/phone/verify') verify(@Body() body: unknown) {
    return this.service.verify(body);
  }
  @Post('auth/logout') logout(@Headers('authorization') h: unknown) {
    return this.service.logout(h);
  }
  @Get('citizen/dashboard') async dashboard(@Headers('authorization') h: unknown) {
    return this.service.dashboard(await this.service.authenticate(h));
  }
  @Post('citizen/dossiers') async create(@Headers('authorization') h: unknown, @Body() b: unknown) {
    return this.service.createDossier(await this.service.authenticate(h), b);
  }
}
