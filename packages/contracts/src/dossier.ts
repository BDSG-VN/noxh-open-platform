import { z } from 'zod';

const short = z.string().trim().max(200);
const date = z
  .string()
  .refine(
    (s) =>
      s === '' ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(Date.parse(s)) &&
        new Date(s).toISOString().startsWith(s)),
    'Ngày không hợp lệ',
  );
export const DeclarationSchema = z
  .object({
    fullName: short,
    dateOfBirth: date,
    address: z.string().trim().max(500),
    occupation: short,
    housingSituation: z.enum(['', 'renting', 'with-family', 'owned', 'other']),
    household: z
      .array(
        z
          .object({
            fullName: short,
            dateOfBirth: date,
            relationship: z.enum(['spouse', 'child', 'parent', 'other']),
          })
          .strict(),
      )
      .max(20),
    confirmed: z.boolean(),
  })
  .strict();
export type Declaration = z.infer<typeof DeclarationSchema>;
export const emptyDeclaration: Declaration = {
  fullName: '',
  dateOfBirth: '',
  address: '',
  occupation: '',
  housingSituation: '',
  household: [],
  confirmed: false,
};
export const preparationDocumentTypes = [
  'identity',
  'housing',
  'income',
  'subject',
  'attested-form',
  'other',
] as const;
export const PreparationChecklistSchema = z
  .object({
    title: z.string().trim().min(5).max(200),
    instructions: z.string().trim().min(20).max(3000),
    sourceReference: z.string().trim().min(5).max(1000),
    effectiveFrom: date.refine((s) => s !== ''),
    effectiveTo: date.nullable().refine((s) => s !== ''),
    documentTypes: z
      .array(z.enum(['any', ...preparationDocumentTypes]))
      .min(1)
      .max(6),
    formIds: z
      .array(z.string().regex(/^[a-z0-9-]{1,100}$/))
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.effectiveTo && v.effectiveTo < v.effectiveFrom)
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'Khoảng hiệu lực không hợp lệ',
      });
    if (
      new Set(v.documentTypes).size !== v.documentTypes.length ||
      (v.documentTypes.includes('any') && v.documentTypes.length !== 1)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['documentTypes'],
        message: 'Loại giấy tờ trùng hoặc không rõ',
      });
    if (
      new Set(v.formIds).size !== v.formIds.length ||
      (v.formIds.includes('any') && v.formIds.length !== 1)
    )
      ctx.addIssue({ code: 'custom', path: ['formIds'], message: 'Biểu mẫu trùng hoặc không rõ' });
  });
export type PreparationChecklistInput = z.infer<typeof PreparationChecklistSchema>;
export interface PreparationChecklist extends PreparationChecklistInput {
  id: string;
  version: number;
  status: 'draft' | 'approved' | 'revoked';
  created_by: string;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
}
export interface PreparationEvidenceRef {
  id: string;
  kind: 'document' | 'generated-form';
  sha256: string;
  version: number;
  mappingId?: string;
  mappingVersion?: number;
  releaseId?: string;
  releaseVersion?: number;
}
export interface PreparationEvidence {
  inputVersion: number;
  documents: { id: string; type: string; scanStatus: string; sha256: string; version: number }[];
  forms: {
    id: string;
    formId: string;
    status: string;
    inputVersion: number;
    active: boolean;
    sha256: string;
    version: number;
    mappingId: string;
    mappingVersion: number;
    releaseId: string;
    releaseVersion: number;
  }[];
  checklist?: PreparationChecklist;
  configurationUnavailable?: boolean;
}
export interface ChecklistItem {
  code: string;
  label: string;
  category: string;
  done: boolean;
  action: string;
  reasonCode: string;
  reason: string;
  evidence: PreparationEvidenceRef[];
}
export interface Readiness {
  version: string;
  score: number;
  inputVersion?: number;
  configurationState: 'generic' | 'active' | 'unavailable';
  checklist?: {
    id: string;
    version: number;
    title: string;
    status: 'draft' | 'approved' | 'revoked';
    instructions: string;
    sourceReference: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  categories: { code: string; label: string; score: number; maximum: number }[];
  items: ChecklistItem[];
  missing: string[];
  disclaimer: string;
}
const documentLabels: Record<string, string> = {
  any: 'Ít nhất một giấy tờ đã quét an toàn',
  identity: 'Giấy tờ nhân thân đã quét an toàn',
  housing: 'Giấy tờ về chỗ ở đã quét an toàn',
  income: 'Giấy tờ thu nhập đã quét an toàn',
  subject: 'Giấy tờ đối tượng đã quét an toàn',
  'attested-form': 'Bản có xác nhận đã quét an toàn',
  other: 'Giấy tờ khác theo hướng dẫn đã quét an toàn',
};
// A deterministic preparation measure. Antivirus, declared document types and citizen
// confirmation are NOT identity verification, authenticity checks or legal certification.
export function preparationReadiness(
  d: Declaration,
  today = new Date().toISOString().slice(0, 10),
  evidence?: PreparationEvidence,
): Readiness {
  const simple = (
    code: string,
    label: string,
    category: string,
    done: boolean,
    action: string,
  ): ChecklistItem => ({
    code,
    label,
    category,
    done,
    action,
    reasonCode: done ? 'declaration-present' : 'declaration-incomplete',
    reason: done
      ? 'Thông tin đã có trong bản khai đã lưu.'
      : 'Hoàn thành và lưu thông tin tương ứng.',
    evidence: [],
  });
  const items: ChecklistItem[] = [
    simple(
      'identity',
      'Họ tên và ngày sinh người khai',
      'declarations',
      Boolean(d.fullName && d.dateOfBirth),
      'declarations',
    ),
    simple(
      'address',
      'Địa chỉ và tình trạng chỗ ở',
      'declarations',
      Boolean(d.address && d.housingSituation),
      'declarations',
    ),
    simple(
      'household',
      'Thông tin thành viên đã nhập đầy đủ',
      'declarations',
      Boolean(d.fullName && d.household.every((m) => m.fullName && m.dateOfBirth)),
      'household',
    ),
    simple(
      'dates',
      'Ngày sinh đã khai không nằm trong tương lai',
      'consistency',
      Boolean(
        d.dateOfBirth &&
        d.dateOfBirth <= today &&
        d.household.every((m) => m.dateOfBirth && m.dateOfBirth <= today),
      ),
      'household',
    ),
    simple(
      'confirmation',
      'Người khai đã kiểm tra thông tin',
      'consistency',
      d.confirmed &&
        Boolean(d.fullName && d.dateOfBirth && d.address && d.housingSituation) &&
        d.household.every((m) => m.fullName && m.dateOfBirth),
      'summary',
    ),
  ];
  for (const type of evidence?.checklist?.documentTypes ?? ['any']) {
    const candidates = (evidence?.documents ?? []).filter((v) => type === 'any' || v.type === type);
    const clean = candidates.filter((v) => v.scanStatus === 'clean');
    const reasonCode = evidence?.configurationUnavailable
      ? 'checklist-unavailable'
      : clean.length
        ? 'scan-clean'
        : candidates.some((v) => v.scanStatus === 'quarantined')
          ? 'scan-pending'
          : candidates.length
            ? 'scan-rejected'
            : 'document-missing';
    const done = reasonCode === 'scan-clean';
    items.push({
      code: type === 'any' ? 'documents' : 'document:' + type,
      label: documentLabels[type] ?? type,
      category: 'documents',
      done,
      action: 'documents',
      reasonCode,
      reason: (
        {
          'scan-clean':
            'Tệp đã qua kiểm tra an toàn; loại giấy tờ do người tải khai, chưa xác minh nội dung hoặc chứng thực.',
          'scan-pending': 'Tệp vẫn được cách ly; cần hoàn tất quét an toàn.',
          'scan-rejected': 'Tệp chưa đạt kiểm tra an toàn; hãy tải bản phù hợp.',
          'document-missing': 'Chưa có giấy tờ thuộc mục này trong hồ sơ.',
          'checklist-unavailable':
            'Checklist dự án đã hết hiệu lực hoặc bị thu hồi; chờ chủ đầu tư cập nhật.',
        } as Record<string, string>
      )[reasonCode]!,
      evidence: done
        ? clean.map((v) => ({ id: v.id, kind: 'document', sha256: v.sha256, version: v.version }))
        : [],
    });
  }
  for (const formId of evidence?.checklist?.formIds ?? ['any']) {
    const candidates = (evidence?.forms ?? []).filter(
      (v) => formId === 'any' || v.formId === formId,
    );
    const valid = candidates.filter(
      (v) => v.status === 'confirmed' && v.inputVersion === evidence?.inputVersion && v.active,
    );
    const reasonCode = evidence?.configurationUnavailable
      ? 'checklist-unavailable'
      : valid.length
        ? 'form-confirmed-current'
        : candidates.some((v) => !v.active)
          ? 'form-template-inactive'
          : candidates.some((v) => v.inputVersion !== evidence?.inputVersion)
            ? 'form-input-stale'
            : candidates.length
              ? 'form-unconfirmed'
              : 'form-missing';
    const done = reasonCode === 'form-confirmed-current';
    items.push({
      code: formId === 'any' ? 'forms' : 'form:' + formId,
      label:
        formId === 'any'
          ? 'Ít nhất một PDF từ mẫu được duyệt, đã kiểm tra'
          : 'PDF đã kiểm tra: ' + formId,
      category: 'forms',
      done,
      action: 'documents',
      reasonCode,
      reason: (
        {
          'form-confirmed-current':
            'Người khai đã kiểm tra PDF đúng phiên bản bản khai và ánh xạ/hướng dẫn đang hiệu lực; chưa phải xác nhận của cơ quan có thẩm quyền.',
          'form-template-inactive':
            'Ánh xạ, hướng dẫn hoặc nguồn mẫu đã thay đổi, hết hiệu lực hay bị thu hồi. Tạo lại khi có mẫu được duyệt.',
          'form-input-stale':
            'Bản khai đã đổi sau khi tạo PDF; cần tạo và kiểm tra PDF theo bản khai hiện tại.',
          'form-unconfirmed': 'PDF còn là bản nháp; kiểm tra nội dung và xác nhận trước.',
          'form-missing': 'Chưa có PDF tương ứng trong hồ sơ.',
          'checklist-unavailable':
            'Checklist dự án chưa còn hiệu lực; cần chủ đầu tư duyệt bản cập nhật.',
        } as Record<string, string>
      )[reasonCode]!,
      evidence: done
        ? valid.map((v) => ({
            id: v.id,
            kind: 'generated-form',
            sha256: v.sha256,
            version: v.version,
            mappingId: v.mappingId,
            mappingVersion: v.mappingVersion,
            releaseId: v.releaseId,
            releaseVersion: v.releaseVersion,
          }))
        : [],
    });
  }
  const categories = [
    ['declarations', 'Thông tin khai báo', 25],
    ['documents', 'Giấy tờ đã chuẩn bị', 35],
    ['consistency', 'Kiểm tra thông tin', 20],
    ['forms', 'Chuẩn bị biểu mẫu', 20],
  ].map(([code, label, maximum]) => {
    const group = items.filter((i) => i.category === code);
    return {
      code: String(code),
      label: String(label),
      score: Math.floor((Number(maximum) * group.filter((i) => i.done).length) / group.length),
      maximum: Number(maximum),
    };
  });
  return {
    version: 'preparation-v2',
    configurationState: evidence?.configurationUnavailable
      ? 'unavailable'
      : evidence?.checklist
        ? 'active'
        : 'generic',
    inputVersion: evidence?.inputVersion,
    ...(evidence?.checklist
      ? {
          checklist: {
            id: evidence.checklist.id,
            version: evidence.checklist.version,
            title: evidence.checklist.title,
            status: evidence.checklist.status,
            instructions: evidence.checklist.instructions,
            sourceReference: evidence.checklist.sourceReference,
            effectiveFrom: evidence.checklist.effectiveFrom,
            effectiveTo: evidence.checklist.effectiveTo,
          },
        }
      : {}),
    score: categories.reduce((s, c) => s + c.score, 0),
    categories,
    items,
    missing: items.filter((i) => !i.done).map((i) => i.code),
    disclaimer:
      'Chỉ phản ánh mức độ chuẩn bị theo checklist, không phải kết luận đủ điều kiện nhà ở xã hội. Điểm 100 không chứng minh danh tính, giấy tờ hợp lệ, hồ sơ đã nộp hay được duyệt. Quét an toàn và người khai kiểm tra PDF không thay thế xác nhận của cơ quan có thẩm quyền. Không dùng điểm để xếp hạng, bốc thăm hoặc chặn nộp hồ sơ.',
  };
}
export interface SupportRequest {
  id: string;
  dossier_id: string;
  project_name?: string;
  status: 'open' | 'responded' | 'closed';
  version: number;
  created_at: string;
  updated_at: string;
  message: string;
  reply: string | null;
}
export interface DossierDetail {
  id: string;
  project_id: string;
  project_name: string;
  locality: string;
  version: number;
  created_at: string;
  updated_at: string;
  declaration: Declaration;
  readiness: Readiness;
  history: { version: number; created_at: string; source: string }[];
  requests: SupportRequest[];
}
