// Minimal synthetic API for accessibility runs. It serves only the read endpoints each
// role's entry pages need to render; every other path answers 404 so client panels show
// their real error/empty states. No business logic, no persistence, no real data.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { preparationReadiness, emptyDeclaration } from '../../packages/contracts/dist/index.js';
import type { Declaration } from '../../packages/contracts/dist/index.js';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const PROJECT = '22222222-2222-4222-8222-222222222222';
export const DOSSIER = '33333333-3333-4333-8333-333333333333';
const DOCUMENT = '66666666-6666-4666-8666-666666666666';
const OCR_JOB = '88888888-8888-4888-8888-888888888888';
export const LOTTERY = '44444444-4444-4444-8444-444444444444';
export const CAMPAIGN = '55555555-5555-4555-8555-555555555555';
const NOTICE = '66666666-6666-4666-8666-666666666666';
const T0 = '2026-01-05T01:00:00.000Z';
const T1 = '2026-12-31T10:00:00.000Z';

const project = {
  id: PROJECT,
  organizationId: ORG,
  name: 'Khu nhà ở xã hội Mây Trắng (giả lập)',
  locality: 'Phường Sương Mai, tỉnh Giả Lập',
  phase: 'preparation',
  synthetic: true,
};
const round = {
  id: '77777777-7777-4777-8777-777777777777',
  project_id: PROJECT,
  project_name: project.name,
  name: 'Đợt trải nghiệm kỹ thuật 1',
  status: 'open',
  opens_at: T0,
  closes_at: T1,
  version: 1,
};
const paragraph = (s: string) =>
  s + ' Nội dung giả lập dùng để kiểm thử giao diện, không có giá trị pháp lý.';
const notice = {
  id: NOTICE,
  version: 1,
  content_hash: 'a'.repeat(64),
  status: 'approved',
  created_by: 'demo.admin',
  approved_by: 'demo.reviewer',
  approved_at: T0,
  controller: 'Chủ đầu tư giả lập Mây Trắng',
  contact: 'bao-ve-du-lieu@example.invalid',
  purposes: paragraph('Chuẩn bị hồ sơ nhà ở xã hội.'),
  categories: paragraph('Thông tin nhân thân và hộ gia đình.'),
  legalBasis: paragraph('Sự đồng ý của chủ thể dữ liệu.'),
  recipients: paragraph('Chủ đầu tư và đơn vị xử lý được ủy quyền.'),
  retention: paragraph('Lưu đến khi kết thúc đợt tiếp nhận.'),
  transfers: paragraph('Không chuyển dữ liệu ra nước ngoài.'),
  safeguards: paragraph('Mã hóa, phân quyền và nhật ký.'),
  rights: paragraph('Truy cập, chỉnh sửa, xóa, hạn chế, phản đối.'),
  consequences: paragraph('Từ chối thì không thể chuẩn bị hồ sơ trực tuyến.'),
  governance: paragraph('Có hồ sơ đánh giá tác động nội bộ.'),
  reviewed: true,
};
const declaration: Declaration = {
  ...emptyDeclaration,
  fullName: 'NGUYỄN VĂN GIẢ LẬP',
  dateOfBirth: '1990-01-01',
  household: [{ fullName: 'TRẦN THỊ GIẢ LẬP', dateOfBirth: '1992-02-02', relationship: 'spouse' }],
};
const dossier = {
  id: DOSSIER,
  project_id: PROJECT,
  project_name: project.name,
  locality: project.locality,
  version: 2,
  created_at: T0,
  updated_at: T0,
  declaration,
  readiness: preparationReadiness(declaration, '2026-10-16'),
  history: [
    { version: 1, created_at: T0, source: 'citizen' },
    { version: 2, created_at: T0, source: 'citizen' },
  ],
  requests: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      dossier_id: DOSSIER,
      status: 'responded',
      version: 1,
      created_at: T0,
      updated_at: T0,
      message: 'Tôi cần bổ sung giấy tờ gì cho hộ gia đình?',
      reply: 'Vui lòng xem danh mục chuẩn bị; đây là phản hồi giả lập.',
    },
  ],
};
const lottery = {
  id: LOTTERY,
  title: 'Diễn tập bốc thăm Mây Trắng',
  status: 'published',
  version: 3,
  config: { entries: ['HS-A1', 'HS-B2', 'HS-C3'], seats: 2, cohorts: [] },
  result: {
    ranking: [
      { code: 'HS-B2', rank: 1, selected: true, unit: 'A-101' },
      { code: 'HS-A1', rank: 2, selected: true, unit: 'A-102' },
      { code: 'HS-C3', rank: 3, selected: false },
    ],
  },
  commitment: 'b'.repeat(64),
  snapshotHash: 'c'.repeat(64),
  frozenAt: T0,
  entropyRecord: 'd'.repeat(64),
  minutesHash: null,
  voidReason: null,
};
const campaign = {
  id: CAMPAIGN,
  partner_id: '99999999-9999-4999-8999-999999999999',
  partner_name: 'Đơn vị truyền thông giả lập',
  project_id: PROJECT,
  project_name: project.name,
  name: 'Chiến dịch tư vấn mùa xuân',
  channel: 'zalo',
  headline: 'Tư vấn chuẩn bị hồ sơ nhà ở xã hội',
  description: 'Chiến dịch giả lập để kiểm thử giao diện.',
  status: 'approved',
  review_note: '',
  version: 1,
  leads: 1,
  created_at: T0,
};

const routes: Record<string, unknown> = {
  '/api/v1/projects': { items: [project] },
  [`/api/v1/projects/${PROJECT}/rounds`]: { items: [round] },
  '/api/v1/citizen/dashboard': {
    phoneMasked: '0900***000',
    dossiers: [{ id: DOSSIER, project_name: project.name, version: 2 }],
  },
  [`/api/v1/dossiers/${DOSSIER}`]: dossier,
  // Document workspace with one clean file, a low-quality self-hosted OCR job and no forms yet.
  [`/api/v1/dossiers/${DOSSIER}/documents`]: {
    items: [
      {
        id: DOCUMENT,
        name: 'giay-to-gia-lap.png',
        type: 'identity',
        mime: 'image/png',
        sha256: 'a'.repeat(64),
        bytes: 20480,
        scan_status: 'clean',
        scan_message: 'Đã hoàn tất kiểm tra an toàn.',
        version: 2,
        created_at: T0,
      },
    ],
    extractions: [],
    scannerConfigured: true,
  },
  [`/api/v1/dossiers/${DOSSIER}/form-workspace`]: { mappings: [], generated: [], inputVersion: 2 },
  [`/api/v1/dossiers/${DOSSIER}/ocr-jobs`]: {
    enabled: true,
    qualityThreshold: 0.6,
    notice: 'OCR nội bộ chạy trên máy chủ của tổ chức; kết quả chỉ là gợi ý để đối chiếu.',
    items: [
      {
        id: OCR_JOB,
        documentId: DOCUMENT,
        status: 'succeeded',
        reason: null,
        attemptCount: 1,
        attemptBudget: 3,
        requeueCount: 0,
        nextAttemptAt: null,
        qualityScore: 0.42,
        lowQuality: true,
        engine: 'tesseract',
        extractionId: '77777777-7777-4777-8777-777777777777',
        version: 3,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
  },
  '/api/v1/privacy/notice': { notice, accepted: false, restricted: false, requests: [] },
  '/api/v1/citizen/privacy': { notice, accepted: true, restricted: false, requests: [] },
  '/api/v1/citizen/consultations': { items: [] },
  '/api/v1/citizen/tenancy/contracts': { items: [] },
  '/api/v1/citizen/notifications/workspace': {
    items: [],
    preferences: [],
    projects: [],
    notice: '',
  },
  [`/api/v1/campaigns/${CAMPAIGN}`]: campaign,
  '/api/v1/lotteries': { items: [lottery] },
  [`/api/v1/lotteries/${LOTTERY}`]: lottery,
  '/api/v1/admin/me': { role: 'org_admin', subject: 'demo.admin', permissions: [], department: '' },
  '/api/v1/admin/dashboard': {
    projects: 1,
    open_rounds: 1,
    preparatory_dossiers: 1,
    citizen_accounts: 1,
  },
  '/api/v1/admin/projects': {
    items: [
      {
        id: PROJECT,
        name: project.name,
        locality: project.locality,
        publication_status: 'published',
        version: 1,
        is_synthetic: true,
      },
    ],
  },
  '/api/v1/admin/rounds': { items: [round] },
  '/api/v1/admin/settings/zalo': { enabled: false, version: 1 },
  '/api/v1/partner/workspace': {
    actor: {
      organizationId: ORG,
      userId: 'synthetic-user',
      partnerId: campaign.partner_id,
      memberId: 'synthetic-member',
      role: 'partner_admin',
      partnerName: campaign.partner_name,
      name: 'NHÂN VIÊN GIẢ LẬP',
    },
    projects: [{ id: PROJECT, name: project.name, locality: project.locality }],
    campaigns: [campaign],
    members: [
      {
        id: 'synthetic-member',
        name: 'NHÂN VIÊN GIẢ LẬP',
        phoneMasked: '0900***001',
        role: 'consultant',
        status: 'active',
        version: 1,
      },
    ],
    counts: { new: 1, processing: 0, closed: 0 },
  },
};

/** Session token that `/api/v1/admin/me` answers with a non-admin operations identity. */
export const STAFF_TOKEN = 'synthetic-staff-token';
const staffIdentity = {
  role: 'operations',
  subject: 'demo.staff',
  permissions: ['records_read', 'workflow_read', 'intake_officer'],
  department: 'project_office',
};

export interface FakeApi {
  url: string;
  close: () => void;
}
export function startFakeApi(): Promise<FakeApi> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      const body =
        req.method === 'GET'
          ? path === '/api/v1/admin/me' && token === STAFF_TOKEN
            ? staffIdentity
            : routes[path]
          : undefined;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (body) {
        res.writeHead(200);
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(404);
      res.end(
        JSON.stringify({
          type: 'about:blank',
          title: 'Not Found',
          status: 404,
          detail: 'Điểm cuối này không có trong bộ dữ liệu kiểm thử giao diện.',
        }),
      );
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
