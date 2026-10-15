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
export interface ChecklistItem {
  code: string;
  label: string;
  category: string;
  done: boolean;
  action: string;
}
export interface Readiness {
  version: string;
  score: number;
  categories: { code: string; label: string; score: number; maximum: number }[];
  items: ChecklistItem[];
  missing: string[];
  disclaimer: string;
}
// Preparation checklist only. Unverified documents/forms never count as complete.
export function preparationReadiness(
  d: Declaration,
  today = new Date().toISOString().slice(0, 10),
): Readiness {
  const items: ChecklistItem[] = [
    {
      code: 'identity',
      label: 'Họ tên và ngày sinh người khai',
      category: 'declarations',
      done: Boolean(d.fullName && d.dateOfBirth),
      action: 'declarations',
    },
    {
      code: 'address',
      label: 'Địa chỉ và tình trạng chỗ ở',
      category: 'declarations',
      done: Boolean(d.address && d.housingSituation),
      action: 'declarations',
    },
    {
      code: 'household',
      label: 'Thông tin thành viên đã nhập đầy đủ',
      category: 'declarations',
      done: Boolean(d.fullName && d.household.every((m) => m.fullName && m.dateOfBirth)),
      action: 'household',
    },
    {
      code: 'dates',
      label: 'Ngày sinh đã khai không nằm trong tương lai',
      category: 'consistency',
      done: Boolean(
        d.dateOfBirth &&
        d.dateOfBirth <= today &&
        d.household.every((m) => m.dateOfBirth && m.dateOfBirth <= today),
      ),
      action: 'household',
    },
    {
      code: 'confirmation',
      label: 'Người khai đã kiểm tra thông tin',
      category: 'consistency',
      done: d.confirmed && Boolean(d.fullName && d.dateOfBirth && d.address && d.housingSituation),
      action: 'summary',
    },
    {
      code: 'documents',
      label: 'Giấy tờ đã quét an toàn và được xác minh',
      category: 'documents',
      done: false,
      action: 'documents',
    },
    {
      code: 'forms',
      label: 'Biểu mẫu được duyệt và người khai xác nhận',
      category: 'forms',
      done: false,
      action: 'documents',
    },
  ];
  const categories = [
    ['declarations', 'Thông tin khai báo', 25],
    ['documents', 'Giấy tờ xác minh', 35],
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
    version: 'preparation-v1',
    score: categories.reduce((s, c) => s + c.score, 0),
    categories,
    items,
    missing: items.filter((i) => !i.done).map((i) => i.code),
    disclaimer:
      'Chỉ phản ánh mức độ chuẩn bị theo checklist chung, không phải kết luận đủ điều kiện nhà ở xã hội. Giấy tờ và biểu mẫu chưa tích hợp nên chưa được tính điểm.',
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
