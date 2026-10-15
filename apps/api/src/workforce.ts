import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Database } from './database';
import { sha } from './identity-crypto';
import { employeePermissions, sensitivePermissions } from '@noxh/contracts';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
export interface Staff {
  subject: string;
  organizationId: string;
  role: 'org_admin' | 'project_manager' | 'staff';
  permissions?: string[];
  employeeId?: string;
  department?: string;
  projectIds?: string[];
}
export function organizationId() {
  const id = process.env.AUTH_ORGANIZATION_ID ?? '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new ServiceUnavailableException('Chưa cấu hình tổ chức');
  return id.toLowerCase();
}
@Injectable()
export class WorkforceAuth {
  constructor(@Inject(Database) readonly db: Database) {}
  testKey?: JWTVerifyGetKey;
  private jwks?: JWTVerifyGetKey;
  async authenticate(header: unknown): Promise<Staff> {
    const issuer = process.env.WORKFORCE_ISSUER;
    if (!issuer) throw new ServiceUnavailableException('Chưa cấu hình đăng nhập nhân sự');
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 16000)
      throw new UnauthorizedException('Yêu cầu đăng nhập nhân sự');
    const jwksUrl = process.env.WORKFORCE_JWKS_URL ?? issuer + '/protocol/openid-connect/certs';
    let payload: JWTPayload;
    try {
      const url = new URL(jwksUrl);
      if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:')
        throw new Error('TLS required');
      this.jwks ??= createRemoteJWKSet(url, { timeoutDuration: 3000, cooldownDuration: 30000 });
      ({ payload } = await jwtVerify(header.slice(7), this.testKey ?? this.jwks, {
        issuer,
        audience: process.env.WORKFORCE_AUDIENCE ?? 'noxh-api',
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
        maxTokenAge: '30m',
      }));
    } catch {
      throw new UnauthorizedException('Phiên nhân sự không hợp lệ hoặc hết hạn');
    }
    if (payload.azp !== (process.env.WORKFORCE_CLIENT_ID ?? 'noxh-investor'))
      throw new ForbiddenException('Sai ứng dụng đăng nhập');
    const amr = Array.isArray(payload.amr) ? payload.amr : [];
    if (!amr.includes('otp'))
      throw new ForbiddenException('Nhân sự cần xác thực MFA bằng OTP của Keycloak');
    if (typeof payload.sub !== 'string' || !payload.sub.length || payload.sub.length > 200)
      throw new UnauthorizedException('Thiếu định danh nhân sự');
    if (
      (
        await this.db.query(
          'SELECT token_hash FROM identity_private.revoked_staff_sessions WHERE token_hash=$1 AND expires_at>now()',
          [sha(header.slice(7))],
        )
      ).length
    )
      throw new UnauthorizedException('Phiên nhân sự đã đăng xuất');
    const membershipConfigured =
      process.env.WORKFORCE_MEMBERSHIP_ENDPOINT !== undefined ||
      process.env.WORKFORCE_MEMBERSHIP_KEY !== undefined;
    const delegatedAccess = membershipConfigured
      ? await this.membership(payload.sub, sha(header.slice(7)))
      : undefined;
    const access = payload.realm_access as { roles?: unknown } | undefined;
    const roles = Array.isArray(access?.roles) ? access.roles : [];
    const signedPermissions = membershipConfigured
      ? []
      : roles.filter(
          (r): r is string =>
            typeof r === 'string' && (sensitivePermissions as readonly string[]).includes(r),
        );
    const role =
      delegatedAccess?.role ??
      (roles.includes('org_admin')
        ? 'org_admin'
        : roles.includes('noxh_staff')
          ? 'staff'
          : undefined);
    if (!role) throw new ForbiddenException('Tài khoản chưa có quyền nhân sự');
    if (role === 'staff') {
      const [employee] = await this.db.query(
        "SELECT id,department,permissions FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2 AND status='active'",
        [organizationId(), payload.sub!],
      );
      if (!employee)
        throw new ForbiddenException('Tài khoản chưa được cấp quyền hoặc đã bị tạm dừng');
      const projects = await this.db.query(
        'SELECT project_id FROM investor_employee_projects WHERE organization_id=$1 AND employee_id=$2',
        [organizationId(), employee.id],
      );
      // Some domain services reload the local grants themselves. Deny a stale
      // broader local grant instead of relying only on the returned intersection.
      if (
        delegatedAccess?.projectIds.length &&
        projects.some((p) => !delegatedAccess.projectIds.includes(String(p.project_id)))
      )
        throw new ForbiddenException('Quyền dự án nội bộ cần được đồng bộ với tổ chức');
      return {
        subject: payload.sub!,
        organizationId: organizationId(),
        role,
        employeeId: String(employee.id),
        department: String(employee.department),
        projectIds: projects
          .map((p) => String(p.project_id))
          .filter(
            (id) => !delegatedAccess?.projectIds.length || delegatedAccess.projectIds.includes(id),
          ),
        permissions: [
          ...new Set([...this.localPermissions(employee.permissions), ...signedPermissions]),
        ],
      };
    }
    // A tenant admin can configure the instance before an employee profile exists.
    // Sensitive duties still require an explicit active local grant; realm roles
    // never supply them when provider membership is enabled.
    const [employee] = await this.db.query(
      "SELECT permissions FROM identity_private.investor_employees WHERE organization_id=$1 AND subject=$2 AND status='active'",
      [organizationId(), payload.sub],
    );
    return {
      subject: payload.sub!,
      organizationId: organizationId(),
      role,
      permissions: [
        ...new Set([...this.localPermissions(employee?.permissions), ...signedPermissions]),
      ],
    };
  }
  private localPermissions(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter(
          (p): p is string =>
            typeof p === 'string' && (employeePermissions as readonly string[]).includes(p),
        )
      : [];
  }
  private async membership(
    subject: string,
    tokenHash: string,
  ): Promise<{ role: 'org_admin' | 'staff'; projectIds: string[] }> {
    // A provider gateway can remove membership immediately, including for existing JWTs.
    // It never supplies database/project permissions, which remain local to this instance.
    const endpoint = process.env.WORKFORCE_MEMBERSHIP_ENDPOINT;
    const key = process.env.WORKFORCE_MEMBERSHIP_KEY ?? '';
    let url: URL;
    try {
      url = new URL(endpoint ?? '');
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.search ||
        !/^[A-Za-z0-9_-]{43,200}$/.test(key)
      )
        throw Error('Invalid gateway');
    } catch {
      throw new ServiceUnavailableException('Chưa cấu hình cổng phân quyền tổ chức');
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ organizationId: organizationId(), subject, tokenHash }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.status === 401 || response.status === 403 || response.status === 404)
        throw new ForbiddenException('Tài khoản chưa có quyền trong tổ chức hoặc đã bị thu hồi');
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('application/json') ||
        Number(response.headers.get('content-length') ?? 0) > 4096 ||
        !response.body
      )
        throw Error('Invalid response');
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          throw Error('Oversized response');
        }
        chunks.push(chunk.value);
      }
      const access = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      if (
        access.organizationId !== organizationId() ||
        access.subject !== subject ||
        access.active !== true ||
        !['org_admin', 'staff'].includes(String(access.role))
      )
        throw new ForbiddenException('Quyền tổ chức không hợp lệ');
      if (
        !Array.isArray(access.projectIds) ||
        access.projectIds.length > 100 ||
        !access.projectIds.every((id) => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id))
      )
        throw new ForbiddenException('Phạm vi dự án không hợp lệ');
      return { role: access.role as 'org_admin' | 'staff', projectIds: access.projectIds };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException('Không xác minh được quyền tổ chức');
    }
  }
  async logout(header: unknown) {
    await this.authenticate(header);
    await this.db.query(
      "INSERT INTO identity_private.revoked_staff_sessions(token_hash,expires_at) VALUES($1,now()+interval '30 minutes') ON CONFLICT DO NOTHING",
      [sha(String(header).slice(7))],
    );
    return { loggedOut: true };
  }
}
