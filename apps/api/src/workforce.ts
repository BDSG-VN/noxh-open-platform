import {
  Inject,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Database } from './database';
import { sha } from './identity-crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from 'jose';
export interface Staff {
  subject: string;
  organizationId: string;
  role: 'org_admin' | 'project_manager';
  permissions?: string[];
}
export function organizationId() {
  const id = process.env.AUTH_ORGANIZATION_ID ?? '';
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
    throw new ServiceUnavailableException('Chưa cấu hình tổ chức');
  return id;
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
        audience: 'noxh-api',
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
    const access = payload.realm_access as { roles?: unknown } | undefined;
    const roles = Array.isArray(access?.roles) ? access.roles : [];
    const role = roles.includes('org_admin') ? 'org_admin' : undefined;
    if (!role) throw new ForbiddenException('Tài khoản chưa có quyền quản trị');
    if (
      (
        await this.db.query(
          'SELECT token_hash FROM identity_private.revoked_staff_sessions WHERE token_hash=$1 AND expires_at>now()',
          [sha(header.slice(7))],
        )
      ).length
    )
      throw new UnauthorizedException('Phiên nhân sự đã đăng xuất');
    return {
      subject: payload.sub!,
      organizationId: organizationId(),
      role,
      permissions: roles.filter((r): r is string => r === 'form_legal_approver'),
    };
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
