import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PhoneService } from './phone-service';
import { PrivacyService } from './privacy-service';
@Injectable()
export class PrivacyGuard implements CanActivate {
  constructor(
    @Inject(PhoneService) readonly citizen: PhoneService,
    @Inject(PrivacyService) readonly privacy: PrivacyService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const r = context.switchToHttp().getRequest<Request>();
    const path = r.path.replace(/\/$/, '');
    const isWrite = !['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(r.method);
    const protectedPath =
      /^\/api\/v1\/(?:dossiers\/|citizen\/dossiers$|citizen\/consultations\/|citizen\/inventory\/|citizen\/applications\/[a-f0-9-]+\/supplements$)/.test(
        path,
      );
    if (isWrite && protectedPath)
      await this.privacy.assertProcessing(await this.citizen.authenticate(r.headers.authorization));
    return true;
  }
}
