import {
  DeclarationSchema,
  PrivacyChoiceSchema,
  type Declaration,
  type DossierDetail,
  type Project,
  type PrivacyWorkspace,
  type ChannelAuthProvider,
  type ZaloChallenge,
  type ZaloExchangeResult,
} from '@noxh/contracts';
// Presentation only. The server, not userAgent or client profile data, verifies identity.
export const isZaloEnvironment = (userAgent: string) => /Zalo/i.test(userAgent);
export interface MiniDashboard {
  phoneMasked: string | null;
  legalIdentityVerified: false;
  dossiers: {
    id: string;
    project_id: string;
    project_name: string;
    status: string;
    version: number;
  }[];
}
export class ZaloChannel implements ChannelAuthProvider {
  readonly provider = 'zalo' as const;
  private sessionToken?: string;
  private phoneSession?: string;
  private sdkToken?: string;
  private phoneChallenge?: ZaloChallenge;
  private linkChallenge?: ZaloChallenge;
  private readonly base: string;
  private readonly pending = new Set<AbortController>();
  private epoch = 0;
  private linking = false;
  constructor(
    origin = import.meta.env.VITE_API_ORIGIN ?? '',
    private readonly send: typeof fetch = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('Chưa cấu hình địa chỉ API cho Mini App.');
    }
    if (
      url.origin !== origin.replace(/\/$/, '') ||
      url.username ||
      url.password ||
      !(
        url.protocol === 'https:' ||
        (import.meta.env.DEV &&
          url.protocol === 'http:' &&
          ['localhost', '127.0.0.1'].includes(url.hostname))
      )
    )
      throw new Error('Địa chỉ API phải là origin HTTPS được cấu hình cho Mini App.');
    this.base = url.origin;
  }
  private async response(
    path: string,
    body?: unknown,
    auth?: string,
    options: { method?: string; version?: number; timeout?: number } = {},
  ) {
    const controller = new AbortController(),
      epoch = this.epoch;
    const timeout = globalThis.setTimeout(() => controller.abort(), options.timeout ?? 20000);
    this.pending.add(controller);
    try {
      const result = await this.send(this.base + '/api/v1/' + path, {
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        credentials: 'omit',
        redirect: 'error',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
          ...(options.version === undefined ? {} : { 'If-Match': String(options.version) }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      return {
        response: result,
        release: () => {
          globalThis.clearTimeout(timeout);
          this.pending.delete(controller);
        },
      };
    } catch (e) {
      globalThis.clearTimeout(timeout);
      this.pending.delete(controller);
      throw e;
    }
  }
  private async api(
    path: string,
    body?: unknown,
    auth?: string,
    options: { method?: string; version?: number; timeout?: number } = {},
  ) {
    const epoch = this.epoch,
      handle = await this.response(path, body, auth, options);
    try {
      const result = await handle.response.json();
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      if (!handle.response.ok) throw new Error(result.detail ?? 'Chưa kết nối được. Hãy thử lại.');
      return result;
    } finally {
      handle.release();
    }
  }
  async status() {
    return this.api('auth/zalo/status') as Promise<{ enabled: boolean }>;
  }
  async exchange(
    accessToken: string,
  ): Promise<{ sessionEstablished: boolean; needsLink?: boolean }> {
    const closing = this.logout(),
      epoch = this.epoch;
    await closing;
    if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
    const challenge: ZaloChallenge = await this.api('auth/zalo/challenges', {});
    if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
    const result: ZaloExchangeResult = await this.api('auth/zalo/exchange', {
      challengeId: challenge.challengeId,
      challengeProof: challenge.challengeProof,
      accessToken,
      accepted: true,
    });
    if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
    if (result.sessionEstablished) {
      this.sessionToken = result.sessionToken;
      this.sdkToken = undefined;
      this.phoneSession = undefined;
      this.linkChallenge = undefined;
      return { sessionEstablished: true };
    }
    this.sdkToken = accessToken;
    return { sessionEstablished: false, needsLink: result.needsLink };
  }
  async requestPhone(phone: string, accepted: boolean) {
    if (!accepted) throw new Error('Cần đồng ý xác thực số điện thoại để liên kết.');
    return this.linkOperation(async () => {
      const old = this.phoneSession,
        epoch = this.epoch;
      this.linkChallenge = undefined;
      this.phoneChallenge = undefined;
      if (old) await this.revoke(old);
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      this.phoneSession = undefined;
      const challenge = await this.api('auth/phone/request', { phone, accepted: true });
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      this.phoneChallenge = challenge;
      return { expiresIn: this.phoneChallenge!.expiresIn };
    });
  }
  async verifyPhone(code: string) {
    return this.linkOperation(async () => {
      const epoch = this.epoch;
      if (!this.phoneChallenge) throw new Error('Hãy yêu cầu mã xác thực trước.');
      const result = await this.api('auth/phone/verify', {
        challengeId: this.phoneChallenge.challengeId,
        challengeProof: this.phoneChallenge.challengeProof,
        code,
      });
      if (typeof result.sessionToken !== 'string')
        throw new Error('Phiên điện thoại không hợp lệ.');
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      this.phoneSession = result.sessionToken;
      this.phoneChallenge = undefined;
    });
  }
  async startLink(accepted: boolean) {
    return this.linkOperation(async () => {
      const epoch = this.epoch;
      if (!accepted || !this.phoneSession || !this.sdkToken)
        throw new Error('Cần xác thực lại điện thoại và đồng ý liên kết.');
      const challenge = await this.api(
        'auth/link/start',
        { accessToken: this.sdkToken, accepted: true },
        this.phoneSession,
      );
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      this.linkChallenge = challenge;
      return this.linkChallenge;
    });
  }
  async confirmLink(accepted: boolean) {
    return this.linkOperation(async () => {
      const epoch = this.epoch;
      if (!accepted || !this.phoneSession || !this.sdkToken || !this.linkChallenge)
        throw new Error('Cần xem và xác nhận yêu cầu liên kết.');
      await this.api(
        'auth/link/confirm',
        {
          challengeId: this.linkChallenge.challengeId,
          challengeProof: this.linkChallenge.challengeProof,
          accessToken: this.sdkToken,
          accepted: true,
        },
        this.phoneSession,
      );
      if (epoch !== this.epoch) throw new Error('Phiên đã đóng. Hãy đăng nhập lại.');
      this.linkChallenge = undefined;
      return this.exchange(this.sdkToken);
    });
  }
  private async linkOperation<T>(action: () => Promise<T>) {
    if (this.linking) throw new Error('Đang xác thực hoặc liên kết. Hãy chờ thao tác hiện tại.');
    this.linking = true;
    try {
      return await action();
    } finally {
      this.linking = false;
    }
  }
  async dashboard(): Promise<MiniDashboard> {
    if (!this.sessionToken) throw new Error('Cần đăng nhập Zalo trước.');
    return this.api('citizen/dashboard', undefined, this.sessionToken);
  }
  async dossier(id: string): Promise<DossierDetail> {
    this.uuid(id);
    return this.api('dossiers/' + id, undefined, this.ownerToken());
  }
  private ownerToken() {
    if (!this.sessionToken) throw new Error('Cần đăng nhập Zalo trước.');
    return this.sessionToken;
  }
  async projects(): Promise<{ items: Project[] }> {
    return this.api('projects');
  }
  async privacy(): Promise<PrivacyWorkspace> {
    return this.api('citizen/privacy', undefined, this.ownerToken());
  }
  async acceptPrivacy(noticeId: string, contentHash: string) {
    return this.api(
      'citizen/privacy/consent',
      PrivacyChoiceSchema.parse({ noticeId, contentHash, accepted: true }),
      this.ownerToken(),
    );
  }
  async withdrawPrivacy() {
    return this.api('citizen/privacy/withdraw', {}, this.ownerToken());
  }
  async createDossier(projectId: string): Promise<{ id: string }> {
    this.uuid(projectId);
    return this.api('citizen/dossiers', { projectId }, this.ownerToken());
  }
  async saveDeclaration(
    id: string,
    declaration: Declaration,
    version: number,
  ): Promise<{ version: number }> {
    this.uuid(id);
    return this.api(
      'dossiers/' + id + '/declarations',
      DeclarationSchema.parse(declaration),
      this.ownerToken(),
      { method: 'PATCH', version },
    );
  }
  private uuid(id: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
      throw new Error('Mã hồ sơ hoặc chứng cứ không hợp lệ.');
  }
  async dossierAction<T>(
    id: string,
    resource: string,
    body?: unknown,
    method?: string,
  ): Promise<T> {
    this.uuid(id);
    if (
      !/^(?:documents(?:\/[a-f0-9-]{36}(?:\/(?:scan|extract))?)?|extractions\/[a-f0-9-]{36}\/accept|form-workspace|generated-forms(?:\/[a-f0-9-]{36}(?:\/confirm)?)?)$/.test(
        resource,
      )
    )
      throw new Error('Thao tác không thuộc hồ sơ.');
    return this.api('dossiers/' + id + '/' + resource, body, this.ownerToken(), {
      method,
      timeout: resource.endsWith('/extract') ? 90000 : 40000,
    });
  }
  async file(id: string, resource: string): Promise<Blob> {
    this.uuid(id);
    if (
      !/^(?:documents\/[a-f0-9-]{36}\/download|generated-forms\/[a-f0-9-]{36}\/download|form-packet)$/.test(
        resource,
      )
    )
      throw new Error('Tệp không thuộc luồng tải hồ sơ.');
    const epoch = this.epoch,
      handle = await this.response(
        'dossiers/' + id + '/' + resource,
        undefined,
        this.ownerToken(),
        { timeout: 45000 },
      );
    const response = handle.response;
    try {
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail ?? 'Chưa tải được tệp.');
      }
      const mime = (response.headers.get('Content-Type') ?? '').split(';')[0]!;
      if (!['application/pdf', 'application/zip', 'image/jpeg', 'image/png'].includes(mime))
        throw new Error('Định dạng tệp tải về không hợp lệ.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Không có nội dung tệp.');
      const parts: ArrayBuffer[] = [];
      let size = 0;
      for (;;) {
        const chunk = await reader.read();
        if (epoch !== this.epoch) {
          await reader.cancel();
          throw new Error('Phiên đã đóng.');
        }
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 21 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Tệp vượt giới hạn tải của Mini App.');
        }
        parts.push(new Uint8Array(chunk.value).buffer);
      }
      return new Blob(parts, { type: mime });
    } finally {
      handle.release();
    }
  }
  async logout() {
    const tokens = [
      ...new Set([this.sessionToken, this.phoneSession].filter((v): v is string => Boolean(v))),
    ];
    this.clear();
    const results = await Promise.allSettled(tokens.map((token) => this.revoke(token)));
    if (results.some((r) => r.status === 'rejected'))
      throw new Error(
        'Đã xóa phiên trên thiết bị; chưa xác nhận thu hồi phiên máy chủ. Phiên sẽ tự hết hạn, bạn có thể đăng nhập lại để kiểm tra.',
      );
  }
  private async revoke(token: string) {
    const handle = await this.response('auth/logout', {}, token);
    try {
      if (!handle.response.ok && handle.response.status !== 401)
        throw new Error('Chưa xác nhận thu hồi phiên điện thoại cũ. Hãy đăng nhập lại.');
      await handle.response.body?.cancel();
    } finally {
      handle.release();
    }
  }
  clear() {
    this.epoch++;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.sessionToken = undefined;
    this.phoneSession = undefined;
    this.sdkToken = undefined;
    this.phoneChallenge = undefined;
    this.linkChallenge = undefined;
  }
}
export async function requestZaloToken() {
  const { getAccessToken } = await import('zmp-sdk');
  return getAccessToken();
}
