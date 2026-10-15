export class BffError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assertOrigin(request: Request, origin: string) {
  if (request.headers.get('origin') !== origin)
    throw new BffError(403, 'Nguồn yêu cầu không hợp lệ');
}
export async function jsonBody(request: Request, max = 16384): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new BffError(415, 'Yêu cầu JSON');
  const reader = request.body?.getReader();
  if (!reader) throw new BffError(400, 'Thiếu dữ liệu');
  let content = '',
    bytes = 0;
  const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > max) {
      await reader.cancel();
      throw new BffError(413, 'Dữ liệu quá lớn');
    }
    content += decoder.decode(part.value, { stream: true });
  }
  content += decoder.decode();
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new BffError(400, 'JSON không hợp lệ');
  }
}
export async function api(
  path: string,
  token?: string,
  method = 'GET',
  body?: unknown,
  version?: string,
  timeoutMs = 12000,
  idempotencyKey?: string,
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (version) headers['If-Match'] = version;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return fetch((process.env.INTERNAL_API_URL ?? 'http://localhost:4000') + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
}
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
export function bffProblem(error: unknown) {
  return {
    status: error instanceof BffError ? error.status : 503,
    detail:
      error instanceof BffError ? error.message : 'Không kết nối được máy chủ, hãy thử lại sau',
  };
}
