import { z } from 'zod';
export const departments = [
  'project_office',
  'accounting',
  'administration',
  'legal',
  'business',
] as const;
export const operationPermissions = [
  'workflow_read',
  'workflow_write',
  'workflow_review',
  'records_read',
  'records_write',
  'records_review',
  'finance_read',
  'finance_write',
  'finance_post',
] as const;
export const departmentLabels: Record<(typeof departments)[number], string> = {
  project_office: 'Ban quản lý dự án',
  accounting: 'Kế toán',
  administration: 'Hành chính',
  legal: 'Pháp chế',
  business: 'Kinh doanh',
};
export const permissionLabels: Record<(typeof operationPermissions)[number], string> = {
  workflow_read: 'Xem tiến độ',
  workflow_write: 'Cập nhật công việc',
  workflow_review: 'Duyệt tiến độ / chứng cứ',
  records_read: 'Đọc tài liệu',
  records_write: 'Soạn tài liệu',
  records_review: 'Duyệt tài liệu',
  finance_read: 'Đọc sổ nội bộ',
  finance_write: 'Lập bút toán',
  finance_post: 'Duyệt ghi sổ',
};
export const EmployeeSchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9:@._-]+$/),
    name: z.string().trim().min(2).max(120),
    department: z.enum(departments),
    status: z.enum(['active', 'suspended']),
    permissions: z.array(z.enum(operationPermissions)).max(9),
    projectIds: z.array(z.uuid()).max(100),
  })
  .strict();
export interface WorkflowTemplateTask {
  code: string;
  phase: string;
  title: string;
  dependencies: string[];
  external: boolean;
  conditional: boolean;
  guidance: string;
}
// An internal planning template. Applicable procedures and competent authorities require project-specific legal review.
export const investorWorkflowTemplate: WorkflowTemplateTask[] = [
  {
    code: 'investment-route',
    phase: '01 · Chuẩn bị đầu tư',
    title: 'Xác định loại vốn, cơ chế lựa chọn chủ đầu tư và thẩm quyền',
    dependencies: [],
    external: false,
    conditional: false,
    guidance:
      'Rà soát NQ 201/2025/QH15, NĐ 192/2025/NĐ-CP và các sửa đổi; pháp chế xác định nhánh áp dụng, địa phương, điều khoản và mốc hiệu lực.',
  },
  {
    code: 'investor-decision',
    phase: '01 · Chuẩn bị đầu tư',
    title: 'Ghi nhận quyết định/chấp thuận đầu tư hoặc giao chủ đầu tư theo nhánh áp dụng',
    dependencies: ['investment-route'],
    external: true,
    conditional: true,
    guidance:
      'Chỉ ghi nhận văn bản thực nhận từ cơ quan có thẩm quyền; nhánh không áp dụng cần lý do được duyệt.',
  },
  {
    code: 'land',
    phase: '02 · Đất đai và quy hoạch',
    title: 'Theo dõi hồ sơ đất đai, giao/thuê đất, giải phóng mặt bằng',
    dependencies: ['investment-route'],
    external: true,
    conditional: true,
    guidance:
      'Đối chiếu hồ sơ đất và địa phương; các phần việc có thể song song theo tiến độ được pháp chế rà soát.',
  },
  {
    code: 'planning',
    phase: '02 · Đất đai và quy hoạch',
    title: 'Ghi nhận quy hoạch và chỉ tiêu dự án được áp dụng',
    dependencies: ['investment-route'],
    external: true,
    conditional: true,
    guidance:
      'Gắn quyết định/bản vẽ/chứng cứ đã có, không suy luận phê duyệt từ trạng thái nội bộ.',
  },
  {
    code: 'design',
    phase: '03 · Thiết kế và thủ tục xây dựng',
    title: 'Thẩm định dự án/thiết kế, môi trường, PCCC và giấy phép theo trường hợp',
    dependencies: ['planning'],
    external: true,
    conditional: true,
    guidance:
      'Luật Xây dựng 135/2025/QH15 có hiệu lực 01/07/2026; kiểm tra quy định chuyển tiếp và trường hợp miễn/thẩm quyền trước khi chốt quy trình.',
  },
  {
    code: 'construction',
    phase: '04 · Thi công và chất lượng',
    title: 'Khởi công, giám sát, kiểm soát hợp đồng, chất lượng và an toàn',
    dependencies: ['design', 'land'],
    external: false,
    conditional: false,
    guidance:
      'Theo dõi hồ sơ khởi công, nhật ký, nghiệm thu từng phần; không thay thế hồ sơ chuyên ngành.',
  },
  {
    code: 'price',
    phase: '05 · Giá và điều kiện kinh doanh',
    title: 'Lập phương án giá, căn cứ chi phí và thủ tục thẩm tra/kiểm tra giá',
    dependencies: ['investment-route'],
    external: true,
    conditional: true,
    guidance:
      'Tách giá bán, thuê mua, thuê; đối chiếu NĐ 100/2024/NĐ-CP và bản sửa đổi hiện hành. Không coi giá phần mềm là giá được cơ quan chấp thuận.',
  },
  {
    code: 'publication',
    phase: '06 · Công bố và tiếp nhận',
    title: 'Công khai thông tin dự án, đợt tiếp nhận, điều kiện, mẫu và gửi cơ quan địa phương',
    dependencies: ['price'],
    external: true,
    conditional: false,
    guidance:
      'Gắn chứng cứ công bố, thông tin gửi Sở Xây dựng/cơ quan được phân cấp theo pháp luật và thông báo địa phương; thời hạn phải được pháp chế kiểm tra.',
  },
  {
    code: 'intake',
    phase: '06 · Công bố và tiếp nhận',
    title: 'Tiếp nhận, cấp biên nhận, rà soát và yêu cầu bổ sung hồ sơ',
    dependencies: ['publication'],
    external: false,
    conditional: false,
    guidance:
      'Dùng quy trình tiếp nhận riêng có biên nhận; nhiệm vụ hoàn tất không tự biến hồ sơ chuẩn bị thành hồ sơ hợp lệ.',
  },
  {
    code: 'verification',
    phase: '07 · Đối chiếu và lựa chọn',
    title: 'Lập danh sách, gửi đối chiếu, lưu phản hồi và quyết định hồ sơ',
    dependencies: ['intake'],
    external: true,
    conditional: false,
    guidance:
      'Lưu công văn gửi và văn bản trả lời thực tế; bảo vệ dữ liệu cá nhân và áp dụng đúng thẩm quyền.',
  },
  {
    code: 'allocation',
    phase: '07 · Đối chiếu và lựa chọn',
    title: 'Công khai danh sách và thực hiện phương án lựa chọn/bốc thăm nếu cần',
    dependencies: ['verification'],
    external: false,
    conditional: true,
    guidance:
      'Danh sách ưu tiên, số căn và điều kiện miễn bốc thăm cần quy tắc đã được rà soát pháp lý; bốc thăm thật vẫn chịu cổng kiểm toán độc lập.',
  },
  {
    code: 'contracts',
    phase: '08 · Hợp đồng và thanh toán',
    title: 'Ký hợp đồng đúng mẫu, theo dõi thu chi và nghĩa vụ cung cấp thông tin',
    dependencies: ['allocation'],
    external: false,
    conditional: false,
    guidance:
      'Rà soát điều kiện ký, mẫu hợp đồng theo hình thức và các khoản thu được phép; sổ nội bộ không thay kế toán, thuế hay hóa đơn.',
  },
  {
    code: 'acceptance',
    phase: '08 · Nghiệm thu và bàn giao',
    title: 'Nghiệm thu hoàn thành, điều kiện sử dụng và bàn giao',
    dependencies: ['construction'],
    external: true,
    conditional: false,
    guidance: 'Chứng cứ nghiệm thu, PCCC, hoàn công và hồ sơ bàn giao theo trường hợp áp dụng.',
  },
  {
    code: 'operation',
    phase: '09 · Sau đầu tư và lưu trữ',
    title: 'Vận hành, bảo hành, hồ sơ sở hữu, báo cáo và lưu trữ theo thời hạn',
    dependencies: ['contracts', 'acceptance'],
    external: false,
    conditional: false,
    guidance:
      'Lập nghĩa vụ và lịch hạn riêng; pháp chế duyệt thời hạn lưu, hạn chế chuyển nhượng, báo cáo, dữ liệu và quyền của khách.',
  },
];
const EvidenceSchema = z
  .object({
    reference: z.string().trim().min(3).max(300),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    authority: z.string().trim().max(200),
    issuedOn: z.iso.date(),
  })
  .strict();
export const TaskUpdateSchema = z
  .object({
    status: z.enum([
      'todo',
      'in_progress',
      'waiting_external',
      'evidence_recorded',
      'not_applicable',
    ]),
    note: z.string().trim().max(2000),
    evidence: EvidenceSchema.nullable(),
  })
  .strict();
export const RecordSchema = z
  .object({
    recordId: z.uuid().optional(),
    title: z.string().trim().min(3).max(160),
    kind: z.enum(['wiki', 'record']),
    classification: z.enum(['internal', 'restricted']),
    body: z.string().trim().min(10).max(30000),
    attachment: z
      .object({
        reference: z.string().trim().min(3).max(300),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .nullable(),
  })
  .strict();
const JournalLineSchema = z
  .object({
    account: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
    debit: z.number().int().min(0).max(1_000_000_000_000),
    credit: z.number().int().min(0).max(1_000_000_000_000),
  })
  .strict()
  .refine((l) => l.debit > 0 !== l.credit > 0, 'Mỗi dòng chỉ ghi Nợ hoặc Có');
export const JournalSchema = z
  .object({
    date: z.iso.date(),
    description: z.string().trim().min(5).max(1000),
    evidenceReference: z.string().trim().min(3).max(300),
    lines: z.array(JournalLineSchema).min(2).max(100),
  })
  .strict()
  .refine(
    (v) => v.lines.reduce((s, l) => s + l.debit, 0) === v.lines.reduce((s, l) => s + l.credit, 0),
    'Tổng Nợ phải bằng tổng Có',
  );
export interface Employee {
  id: string;
  subject: string;
  name: string;
  department: (typeof departments)[number];
  status: 'active' | 'suspended';
  permissions: string[];
  projectIds: string[];
  version: number;
}
export interface OperationProject {
  id: string;
  name: string;
  locality: string;
}
export interface OperationTask extends WorkflowTemplateTask {
  status: string;
  note: string;
  evidence: { reference: string; sha256: string; authority: string; issuedOn: string } | null;
  updatedBy: string | null;
  reviewedBy: string | null;
  version: number;
}
export interface ProjectWorkflow {
  id: string;
  project_id: string;
  status: 'draft' | 'active';
  version: number;
  created_by: string;
  reviewed_by: string | null;
  legal_note: string;
  tasks: OperationTask[];
}
export interface InternalRecord {
  id: string;
  record_id: string;
  revision: number;
  title: string;
  kind: 'wiki' | 'record';
  classification: 'internal' | 'restricted';
  body: string;
  attachment: { reference: string; sha256: string } | null;
  content_hash: string;
  status: 'draft' | 'approved' | 'revoked';
  created_by: string;
  reviewed_by: string | null;
  version: number;
  created_at: string;
}
export interface InternalJournal {
  id: string;
  date: string;
  description: string;
  evidenceReference: string;
  lines: z.infer<typeof JournalLineSchema>[];
  status: 'draft' | 'posted';
  created_by: string;
  posted_by: string | null;
  version: number;
  content_hash: string;
}
export type EmployeeInput = z.infer<typeof EmployeeSchema>;
export type TaskInput = z.infer<typeof TaskUpdateSchema>;
export type RecordInput = z.infer<typeof RecordSchema>;
export type JournalInput = z.infer<typeof JournalSchema>;
