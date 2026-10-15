export const applicationStatuses: Record<string, string> = {
  submitted: 'Đã tiếp nhận',
  under_review: 'Đang thẩm định',
  supplement: 'Cần bổ sung',
  recommended: 'Chờ phê duyệt',
  approved: 'Hồ sơ được phê duyệt',
  rejected: 'Hồ sơ chưa được chấp thuận',
  withdrawn: 'Đã rút',
};
export const documentTypes: Record<string, string> = {
  identity: 'Nhân thân',
  housing: 'Tình trạng nhà ở',
  income: 'Thu nhập',
  subject: 'Chứng minh đối tượng',
  'attested-form': 'Biểu mẫu đã được xác nhận',
  other: 'Giấy tờ khác',
};
export const housingModes: Record<string, string> = {
  buy: 'Mua',
  rent: 'Thuê',
  'rent-buy': 'Thuê mua',
};
export async function applicationRequest(
  path: string,
  body?: unknown,
  method = 'GET',
  options: { version?: number; idempotencyKey?: string } = {},
) {
  const r = await fetch('/api/workflow/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.version === undefined ? {} : { 'If-Match': String(options.version) }),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Chưa thực hiện được thao tác.');
  return v;
}
export interface SubmissionOptions {
  inputVersion: number;
  confirmed: boolean;
  noticeId: string | null;
  privacyAccepted: boolean;
  rounds: { id: string; name: string; opens_at: string; closes_at: string }[];
  documents: {
    id: string;
    name?: string;
    type: string;
    mime: string;
    sha256: string;
    created_at: string;
  }[];
  forms: {
    id: string;
    mapping_id: string;
    input_version: number;
    sha256: string;
    created_at: string;
  }[];
}
