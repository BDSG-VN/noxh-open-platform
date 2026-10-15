import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { WorkforceAuth } from './workforce';
/** New workforce memberships never inherit old organization-admin routes. */
@Injectable()
export class WorkforceAccessGuard implements CanActivate {
  constructor(@Inject(WorkforceAuth) readonly workforce: WorkforceAuth) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const path = request.path.replace(/\/$/, '');
    if (!path.startsWith('/api/v1/admin/') && path !== '/api/v1/admin') return true;
    const staff = await this.workforce.authenticate(request.headers.authorization);
    if (staff.role === 'org_admin') return true;
    if (path === '/api/v1/admin/me' && request.method === 'GET') return true;
    if (path === '/api/v1/admin/logout' && request.method === 'POST') return true;
    if (path.startsWith('/api/v1/admin/operations/')) return true;
    if (path.startsWith('/api/v1/admin/inventory/')) return true;
    if (path === '/api/v1/admin/applications' || path.startsWith('/api/v1/admin/applications/'))
      return true;
    throw new ForbiddenException('Nhân viên chỉ được truy cập phân hệ và dự án đã được cấp quyền');
  }
}
