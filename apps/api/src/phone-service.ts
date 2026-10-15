import {
  Inject,
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { randomInt, randomBytes, randomUUID, createHmac } from 'node:crypto';
import { Database } from './database';
import { digest, normalizePhone, safeEqual, seal, unseal, sha } from './identity-crypto';
import { organizationId } from './workforce';
import { event, uuid, record, text } from './admin-service';
export interface DeliverySettings {
  templateId: string;
  otpParameter: string;
  accessToken: string;
  appSecret: string;
}
@Injectable()
export class ZaloDelivery {
  async send(settings: DeliverySettings, phone: string, code: string, trackingId: string) {
    try {
      const response = await fetch('https://business.openapi.zalo.me/message/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', access_token: settings.accessToken },
        body: JSON.stringify({
          phone,
          template_id: settings.templateId,
          template_data: { [settings.otpParameter]: code },
          tracking_id: trackingId,
          appsecret_proof: createHmac('sha256', settings.appSecret)
            .update(settings.accessToken)
            .digest('hex'),
        }),
        signal: AbortSignal.timeout(8000),
      });
      const value = (await response.json()) as { error?: number };
      if (!response.ok || value.error !== 0) throw new Error('provider rejected');
    } catch {
      throw new ServiceUnavailableException(
        'Không gửi được mã qua Zalo. Hãy thử lại sau hoặc liên hệ chủ đầu tư.',
      );
    }
  }
}
export interface Citizen {
  organizationId: string;
  userId: string;
}
@Injectable()
export class PhoneService {
  constructor(
    @Inject(Database) readonly db: Database,
    @Inject(ZaloDelivery) readonly delivery: ZaloDelivery,
  ) {}
  clock = () => Date.now();
  private async settings(org: string): Promise<DeliverySettings> {
    const [r] = await this.db.query(
      'SELECT * FROM identity_private.zalo_settings WHERE organization_id=$1',
      [org],
    );
    if (!r?.enabled)
      throw new ServiceUnavailableException('Chủ đầu tư chưa kích hoạt xác thực Zalo');
    const secrets = JSON.parse(unseal(String(r.secret_cipher), 'zalo:' + org)) as {
      accessToken: string;
      appSecret: string;
    };
    return { templateId: String(r.template_id), otpParameter: String(r.otp_parameter), ...secrets };
  }
  async request(body: unknown, peer: string) {
    const b = record(body);
    if (b.accepted !== true)
      throw new BadRequestException('Cần đồng ý dùng số điện thoại để xác thực');
    const phone = normalizePhone(b.phone);
    const org = organizationId();
    const settings = await this.settings(org);
    const ref = digest('phone', org + ':' + phone);
    const id = randomUUID(),
      code = String(randomInt(0, 1000000)).padStart(6, '0'),
      proof = randomBytes(32).toString('base64url');
    const now = this.clock(),
      expires = new Date(now + 300000).toISOString();
    await this.db.tx(async (q) => {
      const keys = [
        ['phone:' + ref, 5],
        ['peer:' + digest('peer', peer), 100],
      ] as const;
      for (const [key, max] of [...keys].sort((a, b) => a[0].localeCompare(b[0]))) {
        await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const old = (
          await q.query('SELECT * FROM identity_private.auth_limits WHERE key=$1 FOR UPDATE', [key])
        ).rows[0];
        const active = old && now - new Date(String(old.window_at)).getTime() < 3600000;
        if (
          active &&
          (Number(old.requests) >= max ||
            (key.startsWith('phone:') &&
              now - new Date(String(old.last_request_at)).getTime() < 60000))
        )
          throw new HttpException('Vui lòng chờ trước khi yêu cầu mã mới', 429);
        await q.query(
          'INSERT INTO identity_private.auth_limits(key,window_at,requests,last_request_at) VALUES($1,$2,1,$2) ON CONFLICT(key) DO UPDATE SET window_at=$3,requests=$4,last_request_at=$2',
          [
            key,
            new Date(now).toISOString(),
            active ? old.window_at : new Date(now).toISOString(),
            active ? Number(old.requests) + 1 : 1,
          ],
        );
      }
      await q.query(
        "UPDATE identity_private.phone_challenges SET status='superseded' WHERE organization_id=$1 AND phone_ref=$2 AND status IN('pending','sent')",
        [org, ref],
      );
      await q.query(
        "INSERT INTO identity_private.phone_challenges(id,organization_id,phone_ref,phone_cipher,otp_digest,proof_digest,status,expires_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)",
        [
          id,
          org,
          ref,
          seal(phone, 'phone:' + org),
          digest('otp', id + ':' + code),
          sha(proof),
          expires,
        ],
      );
      await event(
        q,
        { organizationId: org, subject: 'anonymous' },
        'phone.challenge.requested',
        id,
      );
    });
    try {
      await this.delivery.send(settings, phone, code, id);
      await this.db.query(
        "UPDATE identity_private.phone_challenges SET status='sent' WHERE id=$1 AND status='pending'",
        [id],
      );
    } catch {
      await this.db.query(
        "UPDATE identity_private.phone_challenges SET status='failed' WHERE id=$1",
        [id],
      );
      throw new ServiceUnavailableException(
        'Không gửi được mã Zalo. Chưa có phiên đăng nhập nào được tạo.',
      );
    }
    return { challengeId: id, challengeProof: proof, expiresIn: 300, retryAfter: 60 };
  }
  async verify(body: unknown) {
    const b = record(body),
      id = uuid(b.challengeId),
      code = text(b.code, 6),
      proof = text(b.challengeProof, 128);
    if (!/^\d{6}$/.test(code)) throw new UnauthorizedException('Mã xác thực không hợp lệ');
    const org = organizationId();
    await this.settings(org);
    const now = this.clock();
    const token = randomBytes(32).toString('base64url');
    const outcome = await this.db.tx(async (q) => {
      const r = (
        await q.query(
          'SELECT * FROM identity_private.phone_challenges WHERE id=$1 AND organization_id=$2 FOR UPDATE',
          [id, org],
        )
      ).rows[0];
      if (
        !r ||
        r.status !== 'sent' ||
        Number(r.attempts) >= 5 ||
        new Date(String(r.expires_at)).getTime() <= now ||
        !safeEqual(String(r.proof_digest), sha(proof))
      )
        return false;
      if (!safeEqual(String(r.otp_digest), digest('otp', id + ':' + code))) {
        await q.query(
          "UPDATE identity_private.phone_challenges SET attempts=attempts+1,status=CASE WHEN attempts+1>=5 THEN 'locked' ELSE status END WHERE id=$1",
          [id],
        );
        return false;
      }
      await q.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'account:' + String(r.phone_ref),
      ]);
      let account = (
        await q.query(
          'SELECT user_id FROM identity_private.phone_accounts WHERE organization_id=$1 AND phone_ref=$2',
          [org, r.phone_ref],
        )
      ).rows[0];
      if (!account) {
        const userId = randomUUID();
        await q.query("INSERT INTO users(id,organization_id,status) VALUES($1,$2,'active')", [
          userId,
          org,
        ]);
        await q.query(
          'INSERT INTO identity_private.phone_accounts(organization_id,user_id,phone_ref,phone_cipher) VALUES($1,$2,$3,$4)',
          [org, userId, r.phone_ref, r.phone_cipher],
        );
        account = { user_id: userId };
      }
      const user = (
        await q.query('SELECT status FROM users WHERE id=$1 AND organization_id=$2', [
          account.user_id,
          org,
        ])
      ).rows[0];
      if (user?.status !== 'active') return false;
      await q.query("UPDATE identity_private.phone_challenges SET status='consumed' WHERE id=$1", [
        id,
      ]);
      await q.query(
        'INSERT INTO identity_private.citizen_sessions(token_hash,organization_id,user_id,expires_at) VALUES($1,$2,$3,$4)',
        [sha(token), org, account.user_id, new Date(now + 3600000).toISOString()],
      );
      await q.query(
        "INSERT INTO consent_records(id,organization_id,user_id,purpose,notice_version,granted_at) VALUES($1,$2,$3,'phone-authentication','phone-login-v1',$4)",
        [randomUUID(), org, account.user_id, new Date(now).toISOString()],
      );
      await event(
        q,
        { organizationId: org, subject: String(account.user_id) },
        'citizen.login',
        String(account.user_id),
      );
      return true;
    });
    if (!outcome)
      throw new UnauthorizedException('Mã đã hết hạn, không đúng hoặc không còn sử dụng được');
    return { sessionToken: token, expiresIn: 3600 };
  }
  async authenticate(header: unknown): Promise<Citizen> {
    if (typeof header !== 'string' || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header))
      throw new UnauthorizedException('Yêu cầu đăng nhập khách hàng');
    const [r] = await this.db.query(
      "SELECT s.organization_id,s.user_id FROM identity_private.citizen_sessions s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id WHERE s.token_hash=$1 AND s.organization_id=$2 AND s.revoked_at IS NULL AND s.expires_at>$3 AND u.status='active'",
      [sha(header.slice(7)), organizationId(), new Date(this.clock()).toISOString()],
    );
    if (!r) throw new UnauthorizedException('Phiên đã hết hạn hoặc bị thu hồi');
    return { organizationId: String(r.organization_id), userId: String(r.user_id) };
  }
  async logout(header: unknown) {
    const citizen = await this.authenticate(header);
    await this.db.query(
      'UPDATE identity_private.citizen_sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2',
      [sha(String(header).slice(7)), citizen.userId],
    );
    return { loggedOut: true };
  }
  async dashboard(c: Citizen) {
    const [a] = await this.db.query(
      'SELECT phone_cipher FROM identity_private.phone_accounts WHERE organization_id=$1 AND user_id=$2',
      [c.organizationId, c.userId],
    );
    const phone = a ? unseal(String(a.phone_cipher), 'phone:' + c.organizationId) : '';
    const dossiers = await this.db.query(
      'SELECT d.id,d.project_id,p.name AS project_name,d.status,d.phase,d.version FROM prep_dossiers d JOIN projects p ON p.id=d.project_id AND p.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.owner_user_id=$2 ORDER BY d.created_at DESC',
      [c.organizationId, c.userId],
    );
    return {
      userId: c.userId,
      phoneMasked: phone ? '0' + phone.slice(2, 4) + '••••' + phone.slice(-3) : null,
      phoneVerified: true,
      legalIdentityVerified: false,
      dossiers,
      officialSubmissionAvailable: false,
    };
  }
  async createDossier(c: Citizen, body: unknown) {
    const b = record(body),
      projectId = uuid(b.projectId);
    return this.db.tx(async (q) => {
      if (
        !(
          await q.query(
            "SELECT id FROM projects WHERE id=$1 AND organization_id=$2 AND publication_status='published' AND archived_at IS NULL",
            [projectId, c.organizationId],
          )
        ).rows.length
      )
        throw new BadRequestException('Dự án chưa công bố hoặc ngoài phạm vi');
      await q.query(
        "INSERT INTO prep_dossiers(id,organization_id,project_id,owner_user_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,project_id,owner_user_id) WHERE status='draft' DO NOTHING",
        [randomUUID(), c.organizationId, projectId, c.userId],
      );
      const dossier = (
        await q.query(
          "SELECT id,status,phase FROM prep_dossiers WHERE organization_id=$1 AND project_id=$2 AND owner_user_id=$3 AND status='draft'",
          [c.organizationId, projectId, c.userId],
        )
      ).rows[0];
      await event(
        q,
        { organizationId: c.organizationId, subject: c.userId },
        'dossier.prepared',
        String(dossier?.id),
      );
      return dossier;
    });
  }
}
