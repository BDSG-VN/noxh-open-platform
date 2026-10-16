import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import {
  ZaloIdentitySettingsSchema,
  ZaloExchangeSchema,
  ZaloLinkStartSchema,
} from '@noxh/contracts';
import { Database, type Row, type Sql } from './database';
import { PhoneService, type Citizen } from './phone-service';
import { organizationId, type Staff } from './workforce';
import { event, record, uuid } from './admin-service';
import { digest, safeEqual, seal, sha, unseal } from './identity-crypto';

/** Official Mini App server profile protocol; OA/ZBS credentials never enter this adapter. */
@Injectable()
export class ZaloIdentityTransport {
  async profile(accessToken: string, appSecret: string): Promise<{ subject: string }> {
    try {
      const response = await fetch('https://graph.zalo.me/v2.0/me?fields=id', {
        method: 'GET',
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        headers: {
          access_token: accessToken,
          appsecret_proof: createHmac('sha256', appSecret).update(accessToken).digest('hex'),
        },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw Error('provider-denied');
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error('empty');
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const value = await reader.read();
        if (value.done) break;
        size += value.value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw Error('oversize');
        }
        chunks.push(value.value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        !result ||
        result.error !== 0 ||
        typeof result.id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(result.id)
      )
        throw Error('invalid-profile');
      return { subject: result.id };
    } catch {
      throw new UnauthorizedException(
        'Chưa xác minh được tài khoản Zalo của ứng dụng này. Vui lòng thử lại hoặc dùng đăng nhập số điện thoại.',
      );
    }
  }
}
@Injectable()
export class ZaloIdentityService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(PhoneService) readonly phone: PhoneService,
    @Inject(ZaloIdentityTransport) readonly transport: ZaloIdentityTransport,
  ) {}
  private admin(s: Staff) {
    if (s.role !== 'org_admin')
      throw new ForbiddenException('Chỉ quản trị tổ chức cấu hình đăng nhập Mini App');
  }
  private secretScope(org: string, app: string) {
    return 'zalo-miniapp:' + org + ':' + app;
  }
  async settings(s: Staff) {
    this.admin(s);
    const [r] = await this.db.query(
      'SELECT enabled,app_id,version FROM identity_private.zalo_identity_settings WHERE organization_id=$1',
      [s.organizationId],
    );
    return {
      enabled: r?.enabled === true,
      appId: String(r?.app_id ?? ''),
      version: Number(r?.version ?? 0),
      hasSecret: Boolean(r),
      deploymentEnabled: process.env.ZALO_MINIAPP_ENABLED === 'true',
    };
  }
  async configure(s: Staff, body: unknown, expected: number) {
    this.admin(s);
    const parsed = ZaloIdentitySettingsSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Kiểm tra Zalo App ID, khóa bí mật và trạng thái');
    const b = parsed.data;
    if (b.enabled && process.env.ZALO_MINIAPP_ENABLED !== 'true')
      throw new ServiceUnavailableException('Hạ tầng chưa cho phép đăng nhập Mini App');
    return this.db.tx(async (q) => {
      await q.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [s.organizationId]);
      const r = (
        await q.query(
          'SELECT * FROM identity_private.zalo_identity_settings WHERE organization_id=$1 FOR UPDATE',
          [s.organizationId],
        )
      ).rows[0];
      if (Number(r?.version ?? 0) !== expected)
        throw new ConflictException('Cấu hình đã thay đổi. Tải lại trước khi lưu.');
      if (!b.appSecret && (!r || r.app_id !== b.appId))
        throw new BadRequestException('Cần khóa bí mật đúng Zalo App ID cho cấu hình mới');
      const cipher = b.appSecret
        ? seal(b.appSecret, this.secretScope(s.organizationId, b.appId))
        : r!.secret_cipher;
      await q.query(
        'INSERT INTO identity_private.zalo_identity_settings(organization_id,app_id,secret_cipher,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET app_id=$2,secret_cipher=$3,enabled=$4,version=zalo_identity_settings.version+1,updated_at=now()',
        [s.organizationId, b.appId, cipher, b.enabled],
      );
      await q.query(
        "UPDATE identity_private.citizen_sessions SET revoked_at=now() WHERE organization_id=$1 AND auth_method='zalo-miniapp' AND revoked_at IS NULL",
        [s.organizationId],
      );
      await q.query(
        'UPDATE identity_private.zalo_identity_challenges SET consumed_at=now() WHERE organization_id=$1 AND consumed_at IS NULL',
        [s.organizationId],
      );
      await event(q, s, 'zalo-miniapp.configured', s.organizationId);
      return { saved: true, version: expected + 1 };
    });
  }
  async status() {
    const [r] = await this.db.query(
      'SELECT enabled FROM identity_private.zalo_identity_settings WHERE organization_id=$1',
      [organizationId()],
    );
    return {
      enabled: process.env.ZALO_MINIAPP_ENABLED === 'true' && r?.enabled === true,
      phoneLinkRequired: true,
      legalIdentityVerified: false,
    };
  }
  private async active(q: Sql, org: string) {
    if (process.env.ZALO_MINIAPP_ENABLED !== 'true')
      throw new ServiceUnavailableException('Đăng nhập Mini App chưa được kích hoạt');
    const r = (
      await q.query(
        'SELECT * FROM identity_private.zalo_identity_settings WHERE organization_id=$1 FOR SHARE',
        [org],
      )
    ).rows[0];
    if (!r?.enabled)
      throw new ServiceUnavailableException('Chủ đầu tư chưa kích hoạt đăng nhập Mini App');
    return r;
  }
  private current(r: Row, expected: Row) {
    if (r.app_id !== expected.app_id || r.version !== expected.version)
      throw new ConflictException('Cấu hình ứng dụng đã thay đổi; bắt đầu lại đăng nhập');
  }
  private async rate(org: string, peer: string, operation: string, token?: string) {
    const keys: [string, number][] = [['zalo-peer:' + digest('zalo-peer', org + ':' + peer), 100]];
    if (token) keys.push(['zalo-token:' + digest('zalo-token', org + ':' + token), 20]);
    const now = new Date(this.phone.clock()).toISOString();
    const limited = await this.db.tx(async (q) => {
      for (const [key, max] of keys.sort((a, b) => a[0].localeCompare(b[0]))) {
        await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const old = (
          await q.query('SELECT * FROM identity_private.auth_limits WHERE key=$1 FOR UPDATE', [key])
        ).rows[0];
        const active =
          old && this.phone.clock() - new Date(String(old.window_at)).getTime() < 3600000;
        if (active && Number(old.requests) >= max) return true;
        await q.query(
          'INSERT INTO identity_private.auth_limits(key,window_at,requests,last_request_at) VALUES($1,$2,1,$2) ON CONFLICT(key) DO UPDATE SET window_at=$3,requests=$4,last_request_at=$2',
          [key, now, active ? old.window_at : now, active ? Number(old.requests) + 1 : 1],
        );
      }
      return false;
    });
    void operation;
    if (limited) throw new HttpException('Đã đạt hạn mức xác thực. Vui lòng thử lại sau.', 429);
  }
  private makeChallenge() {
    return {
      id: randomUUID(),
      proof: randomBytes(32).toString('base64url'),
      expires: new Date(this.phone.clock() + 120000).toISOString(),
    };
  }
  async challenge(body: unknown, peer: string) {
    if (Object.keys(record(body)).length)
      throw new BadRequestException('Yêu cầu không nhận định danh từ trình duyệt');
    const org = organizationId();
    await this.rate(org, peer, 'challenge');
    return this.db.tx(async (q) => {
      const cfg = await this.active(q, org),
        c = this.makeChallenge();
      await q.query(
        "INSERT INTO identity_private.zalo_identity_challenges(id,organization_id,purpose,app_id,config_version,proof_hash,expires_at) VALUES($1,$2,'exchange',$3,$4,$5,$6)",
        [c.id, org, cfg.app_id, cfg.version, sha(c.proof), c.expires],
      );
      return { challengeId: c.id, challengeProof: c.proof, expiresIn: 120 };
    });
  }
  private async challengeRow(q: Sql, org: string, id: string, proof: string, purpose: string) {
    const r = (
      await q.query(
        'SELECT * FROM identity_private.zalo_identity_challenges WHERE id=$1 AND organization_id=$2 AND purpose=$3 FOR UPDATE',
        [uuid(id), org, purpose],
      )
    ).rows[0];
    if (
      !r ||
      r.consumed_at ||
      Number(r.attempts) >= 5 ||
      new Date(String(r.expires_at)).getTime() <= this.phone.clock()
    )
      return null;
    if (!safeEqual(String(r.proof_hash), sha(proof))) {
      await q.query(
        'UPDATE identity_private.zalo_identity_challenges SET attempts=attempts+1 WHERE id=$1',
        [r.id],
      );
      return null;
    }
    return r;
  }
  private subject(org: string, app: string, profile: { subject: string }) {
    return digest('zalo-subject', org + ':' + app + ':' + profile.subject);
  }
  private async freshPhone(q: Sql, header: unknown) {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
      throw new UnauthorizedException('Cần đăng nhập lại bằng mã điện thoại trước khi liên kết');
    const hash = sha(header.slice(7)),
      org = organizationId();
    const r = (
      await q.query(
        "SELECT s.user_id FROM identity_private.citizen_sessions s JOIN users u ON u.organization_id=s.organization_id AND u.id=s.user_id JOIN identity_private.phone_accounts a ON a.organization_id=s.organization_id AND a.user_id=s.user_id WHERE s.token_hash=$1 AND s.organization_id=$2 AND s.auth_method='phone-otp' AND s.revoked_at IS NULL AND s.expires_at>$3 AND s.created_at>=$4 AND u.status='active' FOR SHARE OF s,u,a",
        [
          hash,
          org,
          new Date(this.phone.clock()).toISOString(),
          new Date(this.phone.clock() - 300000).toISOString(),
        ],
      )
    ).rows[0];
    if (!r)
      throw new UnauthorizedException(
        'Liên kết cần phiên xác thực mã điện thoại trong 5 phút gần nhất',
      );
    return { organizationId: org, userId: String(r.user_id), sessionHash: hash };
  }
  async exchange(body: unknown, peer: string) {
    const p = ZaloExchangeSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần token và yêu cầu đăng nhập đúng định dạng');
    const b = p.data,
      org = organizationId();
    await this.rate(org, peer, 'exchange', b.accessToken);
    const initial = await this.db.tx(async (q) => {
      const cfg = await this.active(q, org),
        nonce = await this.challengeRow(q, org, b.challengeId, b.challengeProof, 'exchange');
      if (nonce && (nonce.app_id !== cfg.app_id || nonce.config_version !== cfg.version))
        return null;
      return nonce ? cfg : null;
    });
    if (!initial) throw new UnauthorizedException('Yêu cầu đăng nhập hết hạn hoặc không đúng');
    const profile = await this.transport.profile(
      b.accessToken,
      unseal(String(initial.secret_cipher), this.secretScope(org, String(initial.app_id))),
    );
    const result = await this.db.tx(async (q) => {
      const cfg = await this.active(q, org);
      this.current(cfg, initial);
      const nonce = await this.challengeRow(q, org, b.challengeId, b.challengeProof, 'exchange');
      if (!nonce) return null;
      await q.query(
        'UPDATE identity_private.zalo_identity_challenges SET consumed_at=now() WHERE id=$1',
        [nonce.id],
      );
      const link = (
        await q.query(
          'SELECT user_id FROM identity_private.zalo_identity_links WHERE organization_id=$1 AND app_id=$2 AND subject_ref=$3 FOR SHARE',
          [org, cfg.app_id, this.subject(org, String(cfg.app_id), profile)],
        )
      ).rows[0];
      if (!link)
        return {
          sessionEstablished: false as const,
          needsLink: true as const,
          legalIdentityVerified: false as const,
        };
      const c: Citizen = { organizationId: org, userId: String(link.user_id) };
      const session = await this.phone.issueChannelSession(
        q,
        c,
        String(cfg.app_id),
        Number(cfg.version),
      );
      await event(
        q,
        { organizationId: org, subject: c.userId },
        'zalo-miniapp.login',
        nonce.id as string,
      );
      return {
        sessionEstablished: true as const,
        ...session,
        legalIdentityVerified: false as const,
      };
    });
    if (!result) throw new UnauthorizedException('Yêu cầu đăng nhập đã được dùng hoặc hết hạn');
    return result;
  }
  async startLink(header: unknown, body: unknown, peer: string) {
    const p = ZaloLinkStartSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần đồng ý liên kết và token Zalo hợp lệ');
    const org = organizationId();
    await this.rate(org, peer, 'link', p.data.accessToken);
    const initial = await this.db.tx(async (q) => {
      const cfg = await this.active(q, org);
      await this.freshPhone(q, header);
      return cfg;
    });
    const profile = await this.transport.profile(
      p.data.accessToken,
      unseal(String(initial.secret_cipher), this.secretScope(org, String(initial.app_id))),
    );
    return this.db.tx(async (q) => {
      const cfg = await this.active(q, org);
      this.current(cfg, initial);
      const c = await this.freshPhone(q, header),
        subject = this.subject(org, String(cfg.app_id), profile);
      await this.assertLink(q, c, String(cfg.app_id), subject);
      const challenge = this.makeChallenge();
      await q.query(
        "INSERT INTO identity_private.zalo_identity_challenges(id,organization_id,purpose,app_id,config_version,proof_hash,user_id,session_hash,token_hash,subject_ref,expires_at) VALUES($1,$2,'link',$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          challenge.id,
          org,
          cfg.app_id,
          cfg.version,
          sha(challenge.proof),
          c.userId,
          c.sessionHash,
          sha(p.data.accessToken),
          subject,
          challenge.expires,
        ],
      );
      await event(
        q,
        { organizationId: org, subject: c.userId },
        'zalo-miniapp.link-proposed',
        challenge.id,
      );
      return {
        challengeId: challenge.id,
        challengeProof: challenge.proof,
        expiresIn: 120,
        notice:
          'Liên kết tài khoản Zalo này với tài khoản điện thoại vừa xác thực. Không chuyển hoặc gộp dữ liệu của tài khoản khác.',
      };
    });
  }
  private async assertLink(q: Sql, c: Citizen, app: string, subject: string) {
    await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      'zalo-link:' + c.organizationId + ':' + app,
    ]);
    const rows = (
      await q.query(
        'SELECT user_id,subject_ref FROM identity_private.zalo_identity_links WHERE organization_id=$1 AND app_id=$2 AND(user_id=$3 OR subject_ref=$4) FOR SHARE',
        [c.organizationId, app, c.userId, subject],
      )
    ).rows;
    if (rows.some((r) => r.user_id !== c.userId || r.subject_ref !== subject))
      throw new ConflictException(
        'Định danh đã liên kết với tài khoản khác. Cần xử lý đối chiếu riêng, không tự gộp tài khoản.',
      );
  }
  async confirmLink(header: unknown, body: unknown, peer: string) {
    const p = ZaloExchangeSchema.safeParse(body);
    if (!p.success) throw new BadRequestException('Cần đọc và xác nhận yêu cầu liên kết hợp lệ');
    const b = p.data,
      org = organizationId();
    await this.rate(org, peer, 'confirm-link', b.accessToken);
    const initial = await this.db.tx(async (q) => {
      const cfg = await this.active(q, org),
        c = await this.freshPhone(q, header),
        nonce = await this.challengeRow(q, org, b.challengeId, b.challengeProof, 'link');
      return nonce &&
        nonce.user_id === c.userId &&
        nonce.session_hash === c.sessionHash &&
        nonce.token_hash === sha(b.accessToken) &&
        nonce.app_id === cfg.app_id &&
        nonce.config_version === cfg.version
        ? cfg
        : null;
    });
    if (!initial)
      throw new UnauthorizedException('Yêu cầu liên kết không đúng phiên, đã hết hạn hoặc đã dùng');
    const profile = await this.transport.profile(
      b.accessToken,
      unseal(String(initial.secret_cipher), this.secretScope(org, String(initial.app_id))),
    );
    const outcome = await this.db.tx(async (q) => {
      const cfg = await this.active(q, org);
      this.current(cfg, initial);
      const c = await this.freshPhone(q, header),
        nonce = await this.challengeRow(q, org, b.challengeId, b.challengeProof, 'link');
      const subject = this.subject(org, String(cfg.app_id), profile);
      if (
        !nonce ||
        nonce.user_id !== c.userId ||
        nonce.session_hash !== c.sessionHash ||
        nonce.token_hash !== sha(b.accessToken) ||
        nonce.subject_ref !== subject
      )
        return false;
      await this.assertLink(q, c, String(cfg.app_id), subject);
      await q.query(
        'INSERT INTO identity_private.zalo_identity_links(id,organization_id,app_id,subject_ref,user_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,app_id,subject_ref) DO NOTHING',
        [randomUUID(), org, cfg.app_id, subject, c.userId],
      );
      await q.query(
        'UPDATE identity_private.zalo_identity_challenges SET consumed_at=now() WHERE id=$1',
        [nonce.id],
      );
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,'zalo-channel-link','zalo-link-v1',now())",
        [randomUUID(), org, c.userId],
      );
      await event(
        q,
        { organizationId: org, subject: c.userId },
        'zalo-miniapp.link-confirmed',
        String(nonce.id),
      );
      return true;
    });
    if (!outcome) throw new UnauthorizedException('Yêu cầu liên kết đã được dùng hoặc không đúng');
    return { linked: true, legalIdentityVerified: false };
  }
}
