'use client';
import { Fragment, useEffect, useState } from 'react';
import { Button, Icon, Brand, PageHeading, EmptyState } from '@noxh/ui';
import type { SupportRequest } from '@noxh/contracts';
import { LegalTemplates, OpenAiSettings } from './integrations';
import PrivacyAdmin from './privacy-admin';
import LotteryAdmin from './lottery-admin';
import GovernmentPortals from './government-portals';
import OperationsAdmin, { type OperationsStaff } from './operations-admin';
import InventoryAdmin from './inventory-admin';
import { FormMappingAdmin } from './form-mapping-admin';
import ApplicationsAdmin from './applications-admin';
import Partners from './partners';
export interface ProjectRow {
  id: string;
  name: string;
  locality: string;
  publication_status: string;
  version: number;
  is_synthetic: boolean;
}
export interface RoundRow {
  id: string;
  project_id: string;
  project_name: string;
  name: string;
  status: string;
  opens_at: string;
  closes_at: string;
  version: number;
}
export interface SettingsRow {
  enabled: boolean;
  version: number;
  oa_id?: string;
  app_id?: string;
  template_id?: string;
  otp_parameter?: string;
}
async function mutation(path: string, body: unknown, method = 'POST', version?: number) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (version !== undefined) headers['If-Match'] = String(version);
  const result = await fetch('/api/admin/' + path, { method, headers, body: JSON.stringify(body) });
  const value = await result.json();
  if (!result.ok) throw new Error(value.detail ?? 'Không lưu được dữ liệu');
  return value;
}
export function StaffLogout() {
  const [error, setError] = useState('');
  return (
    <>
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await mutation('logout', {});
            window.location.assign('/login');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Không đăng xuất được');
          }
        }}
      >
        Đăng xuất
      </Button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
function ProjectEditor({ project }: { project?: ProjectRow }) {
  const [name, setName] = useState(project?.name ?? ''),
    [locality, setLocality] = useState(project?.locality ?? ''),
    [status, setStatus] = useState(project?.publication_status ?? 'draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="status-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await mutation(
            project ? 'projects/' + project.id : 'projects',
            { name, locality, publicationStatus: status },
            project ? 'PUT' : 'POST',
            project?.version,
          );
          window.location.reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Lỗi lưu');
          setBusy(false);
        }
      }}
    >
      <h3 className="font-bold">{project ? 'Chỉnh sửa ' + project.name : 'Thêm dự án'}</h3>
      {project?.is_synthetic && <span className="pill">DỮ LIỆU GIẢ LẬP</span>}
      <label>
        Tên dự án
        <input
          className="search-input"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Địa bàn
        <input
          className="search-input"
          required
          maxLength={200}
          value={locality}
          onChange={(e) => setLocality(e.target.value)}
        />
      </label>
      {project && (
        <label>
          Công bố
          <select
            className="search-input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="draft">Bản nháp</option>
            <option value="published">Đã công bố</option>
          </select>
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu dự án'}</Button>
      {project && (
        <Button
          type="button"
          variant="outline"
          className="ml-3"
          onClick={async () => {
            if (!window.confirm('Lưu trữ dự án này? Các hồ sơ liên quan sẽ được giữ lại.')) return;
            try {
              await mutation('projects/' + project.id, {}, 'DELETE', project.version);
              window.location.reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Không lưu trữ được');
            }
          }}
        >
          Lưu trữ
        </Button>
      )}
    </form>
  );
}
function vietnamDate(value: string) {
  const d = new Date(value + (value.length === 16 ? ':00' : '') + '+07:00');
  if (!Number.isFinite(d.getTime())) throw new Error('Hãy nhập đầy đủ ngày và giờ Việt Nam');
  return d.toISOString();
}
function localDate(value: string) {
  return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16);
}
function RoundEditor({ projects, round }: { projects: ProjectRow[]; round?: RoundRow }) {
  const [projectId, setProject] = useState(round?.project_id ?? projects[0]?.id ?? ''),
    [name, setName] = useState(round?.name ?? ''),
    [status, setStatus] = useState(round?.status ?? 'draft'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="status-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const submitted = new FormData(e.currentTarget);
        setBusy(true);
        try {
          await mutation(
            round ? 'rounds/' + round.id : 'rounds',
            {
              projectId,
              name,
              status,
              opensAt: vietnamDate(String(submitted.get('opensAt') ?? '')),
              closesAt: vietnamDate(String(submitted.get('closesAt') ?? '')),
            },
            round ? 'PUT' : 'POST',
            round?.version,
          );
          window.location.reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Lỗi lưu');
          setBusy(false);
        }
      }}
    >
      <h3 className="font-bold">{round ? 'Sửa lịch tiếp nhận' : 'Thêm lịch tiếp nhận'}</h3>
      <label>
        Dự án
        <select
          className="search-input"
          disabled={Boolean(round)}
          value={projectId}
          onChange={(e) => setProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tên đợt
        <input
          className="search-input"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Bắt đầu (giờ Việt Nam)
        <input
          className="search-input"
          type="datetime-local"
          required
          name="opensAt"
          defaultValue={round ? localDate(round.opens_at) : ''}
        />
      </label>
      <label>
        Kết thúc (giờ Việt Nam)
        <input
          className="search-input"
          type="datetime-local"
          required
          name="closesAt"
          defaultValue={round ? localDate(round.closes_at) : ''}
        />
      </label>
      <label>
        Trạng thái
        <select className="search-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="draft">Nháp</option>
          <option value="open">Mở lịch tiếp nhận</option>
          <option value="closed">Đóng</option>
        </select>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy || !projectId}>Lưu lịch tiếp nhận</Button>
      <p className="text-sm">
        Lịch này chưa bật chức năng nộp đơn chính thức hoặc xét điều kiện pháp lý.
      </p>
    </form>
  );
}
function ZaloSettings({ settings }: { settings: SettingsRow }) {
  const [oaId, setOa] = useState(settings.oa_id ?? ''),
    [appId, setApp] = useState(settings.app_id ?? ''),
    [templateId, setTemplate] = useState(settings.template_id ?? ''),
    [otpParameter, setParameter] = useState(settings.otp_parameter ?? 'otp'),
    [accessToken, setToken] = useState(''),
    [appSecret, setSecret] = useState(''),
    [enabled, setEnabled] = useState(settings.enabled),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="status-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMessage('');
        try {
          await mutation(
            'settings/zalo',
            { oaId, appId, templateId, otpParameter, accessToken, appSecret, enabled },
            'PUT',
            settings.version,
          );
          setToken('');
          setSecret('');
          window.location.reload();
        } catch (e) {
          setMessage(e instanceof Error ? e.message : 'Không lưu được cấu hình');
          setBusy(false);
        }
      }}
    >
      <h2>Zalo OTP của chủ đầu tư</h2>
      <p>
        Tự cấu hình OA, ứng dụng và mẫu OTP đã được Zalo duyệt. Lưu cấu hình không tự gửi tin thử
        hoặc mua dịch vụ.
      </p>
      <div className="grid-two">
        <label>
          OA ID
          <input
            className="search-input"
            required
            value={oaId}
            onChange={(e) => setOa(e.target.value)}
          />
        </label>
        <label>
          App ID
          <input
            className="search-input"
            required
            value={appId}
            onChange={(e) => setApp(e.target.value)}
          />
        </label>
        <label>
          Template ID
          <input
            className="search-input"
            required
            value={templateId}
            onChange={(e) => setTemplate(e.target.value)}
          />
        </label>
        <label>
          Tên biến chứa mã OTP
          <input
            className="search-input"
            required
            value={otpParameter}
            onChange={(e) => setParameter(e.target.value)}
          />
        </label>
        <label>
          Access Token
          <input
            className="search-input"
            type="password"
            autoComplete="new-password"
            required={settings.version === 0}
            value={accessToken}
            onChange={(e) => setToken(e.target.value)}
            placeholder={settings.version ? 'Để trống để giữ token đã lưu' : ''}
          />
        </label>
        <label>
          App Secret
          <input
            className="search-input"
            type="password"
            autoComplete="new-password"
            required={settings.version === 0}
            value={appSecret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={settings.version ? 'Để trống để giữ khóa đã lưu' : ''}
          />
        </label>
      </div>
      <label className="flex gap-3 mb-5">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Bật gửi OTP: tôi đã có mẫu được duyệt và quyền gửi tin của Zalo.</span>
      </label>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      <Button disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cấu hình Zalo'}</Button>
      <p className="text-sm">
        Khóa được mã hóa trên máy chủ, không hiển thị lại qua API. Mẫu hiện cần một tham số OTP. Chủ
        đầu tư tự quản lý thời hạn token, quyền gửi và số dư Zalo.
      </p>
    </form>
  );
}
const dateLabel = (s: string) =>
  new Date(s).toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  });
async function query(path: string) {
  const r = await fetch('/api/admin/' + path, { cache: 'no-store' });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail ?? 'Chưa tải được dữ liệu');
  return b;
}
function RequestQueue() {
  const [items, setItems] = useState<SupportRequest[]>([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [reply, setReply] = useState(''),
    [selected, setSelected] = useState<SupportRequest>(),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('open');
  useEffect(() => {
    let live = true;
    query('requests')
      .then((b) => {
        if (live) setItems(b.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  const visible = items.filter((r) => filter === 'all' || r.status === filter);
  return (
    <div className="stack">
      <div className="toolbar">
        <select
          aria-label="Lọc yêu cầu"
          className="search-input"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="open">Chờ phản hồi</option>
          <option value="responded">Đã phản hồi</option>
          <option value="closed">Đã đóng</option>
          <option value="all">Tất cả yêu cầu</option>
        </select>
        <small>{visible.length} yêu cầu · Tối đa 200 yêu cầu gần nhất</small>
      </div>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <section className="surface">
        {loading ? (
          <div className="surface-body">Đang tải yêu cầu…</div>
        ) : !visible.length ? (
          <EmptyState
            title="Không có yêu cầu trong mục này"
            description="Yêu cầu người dân gửi từ hồ sơ chuẩn bị sẽ xuất hiện ở đây."
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Yêu cầu</th>
                  <th>Dự án</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>YC-{r.id.slice(-8).toUpperCase()}</strong>
                      <small>{dateLabel(r.created_at)}</small>
                    </td>
                    <td>{r.project_name}</td>
                    <td>
                      <span className={'status-badge ' + (r.status === 'open' ? 'amber' : 'green')}>
                        {r.status === 'open'
                          ? 'Chờ phản hồi'
                          : r.status === 'responded'
                            ? 'Đã phản hồi'
                            : 'Đã đóng'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(r);
                          setReply('');
                          setError('');
                        }}
                      >
                        Mở yêu cầu →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <section className="surface">
          <div className="surface-head">
            <h2 className="section-title">YC-{selected.id.slice(-8).toUpperCase()}</h2>
            <button className="text-button" onClick={() => setSelected(undefined)}>
              Đóng chi tiết
            </button>
          </div>
          <div className="surface-body">
            <span className="kicker">NỘI DUNG KHÁCH HÀNG ĐÃ CHIA SẺ</span>
            <p className="request-message">{selected.message}</p>
            {selected.reply && <div className="request-reply">{selected.reply}</div>}
            {selected.status === 'open' && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError('');
                  try {
                    await mutation(
                      'requests/' + selected.id + '/reply',
                      { message: reply },
                      'POST',
                      selected.version,
                    );
                    const b = await query('requests');
                    setItems(b.items);
                    setSelected(undefined);
                    setReply('');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Không gửi được');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Phản hồi hướng dẫn
                  <textarea
                    className="search-input"
                    required
                    maxLength={2000}
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                  />
                </label>
                <Button disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi phản hồi'}</Button>
              </form>
            )}
            <div className="help-note">
              <Icon name="shield" />
              <p>
                Đây là hỗ trợ chuẩn bị, chưa phải thụ lý hoặc xét duyệt hồ sơ pháp lý. Chỉ nội dung
                người dân đồng ý chia sẻ được hiển thị.
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
const actionLabels: Record<string, string> = {
  'declaration.saved': 'Lưu bản khai',
  'readiness.assessed': 'Đánh giá mức độ chuẩn bị',
  'support.requested': 'Gửi yêu cầu hỗ trợ',
  'support.responded': 'Phản hồi hỗ trợ',
  'support.closed': 'Đóng yêu cầu',
  'citizen.login': 'Khách hàng đăng nhập',
  'phone.challenge.requested': 'Yêu cầu xác thực',
  'project.created': 'Tạo dự án',
  'project.updated': 'Cập nhật dự án',
  'project.archived': 'Lưu trữ dự án',
  'round.created': 'Tạo lịch tiếp nhận',
  'round.updated': 'Cập nhật lịch',
  'zalo.settings.updated': 'Cập nhật Zalo OTP',
  'dossier.prepared': 'Tạo hồ sơ chuẩn bị',
};
function AuditPanel() {
  const [data, setData] = useState<{
      verification: { valid: boolean | null; checked: number; reason?: string; engine?: string };
      items: {
        id: string;
        action: string;
        resource_ref: string;
        occurred_at: string;
        event_hash: string;
      }[];
    }>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    query('audit')
      .then((b) => {
        if (live) setData(b);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  if (error)
    return (
      <p role="alert" className="feedback error">
        {error}
      </p>
    );
  if (!data) return <p>Đang kiểm tra chuỗi nhật ký…</p>;
  return (
    <div className="stack">
      <div className={'help-note ' + (data.verification.valid === true ? '' : 'amber')}>
        <Icon name="shield" />
        <p>
          {data.verification.valid === true
            ? `Bộ kiểm chứng Rust đã đối chiếu ${data.verification.checked} sự kiện; các liên kết và mã băm khớp.`
            : (data.verification.reason ??
              'Phát hiện chuỗi không khớp. Cần kiểm tra nhật ký.')}{' '}
          Chuỗi bắt đầu từ phiên bản 0.3; chưa có checkpoint độc lập ngoài máy chủ.
        </p>
      </div>
      <section className="surface">
        <div className="surface-head">
          <h2 className="section-title">100 sự kiện gần nhất</h2>
          <div className="top-actions">
            <span className="status-badge blue">Chỉ đọc</span>
            <a className="text-button" href="/api/admin/audit/export">
              Tải chứng cứ kiểm tra ↗
            </a>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời điểm Việt Nam</th>
                <th>Thao tác</th>
                <th>Tài nguyên</th>
                <th>Mã kiểm tra</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{dateLabel(r.occurred_at)}</td>
                  <td>
                    <strong>{actionLabels[r.action] ?? r.action}</strong>
                  </td>
                  <td>
                    <small>{r.resource_ref.slice(-12)}</small>
                  </td>
                  <td>
                    <code>{r.event_hash.slice(0, 12)}…</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.items.length && (
          <EmptyState
            title="Chưa có sự kiện trong chuỗi mới"
            description="Các thao tác tiếp theo sẽ được nối vào nhật ký kiểm tra."
          />
        )}
      </section>
    </div>
  );
}
export default function AdminWorkbench({
  projects,
  rounds,
  settings,
  counts,
  initialTab = 'overview',
  staff,
  citizenOrigin = 'http://localhost:3000',
  transparencyOrigin = 'http://localhost:3002',
}: {
  staff: OperationsStaff;
  projects: ProjectRow[];
  rounds: RoundRow[];
  settings?: SettingsRow;
  counts: {
    projects: number;
    open_rounds: number;
    preparatory_dossiers: number;
    citizen_accounts: number;
  };
  initialTab?: string;
  citizenOrigin?: string;
  transparencyOrigin?: string;
}) {
  const tabs = [
    ['overview', 'Tổng quan', 'grid'],
    ['projects', 'Dự án', 'building'],
    ['rounds', 'Đợt tiếp nhận', 'calendar'],
    ['applications', 'Tiếp nhận & xét duyệt', 'file'],
    ['requests', 'Hỗ trợ khách hàng', 'chat'],
    ['forms', 'Biểu mẫu & pháp lý', 'file'],
    ['form-mappings', 'Thiết kế mẫu điền', 'file'],
    ['inventory', 'Bảng hàng & giá căn', 'grid'],
    ['lotteries', 'Bốc thăm & ưu tiên', 'grid'],
    ['partners', 'Đối tác & marketing', 'user'],
    ['operations', 'Điều hành & nhân sự', 'building'],
    ['government', 'Cổng cơ quan nhà nước', 'building'],
    ['privacy', 'Bảo vệ dữ liệu', 'shield'],
    ['openai', 'Cấu hình trợ lý AI', 'settings'],
    ['audit', 'Nhật ký hoạt động', 'shield'],
    ...(settings ? [['zalo', 'Cấu hình Zalo OTP', 'settings']] : []),
  ];
  const navGroups: Record<string, string> = {
    overview: 'Dự án',
    applications: 'Hồ sơ khách hàng',
    inventory: 'Kinh doanh & lựa chọn',
    operations: 'Điều hành',
    privacy: 'Quản trị hệ thống',
  };
  const [tab, setTab] = useState(tabs.some((t) => t[0] === initialTab) ? initialTab : 'overview'),
    [search, setSearch] = useState(''),
    [editing, setEditing] = useState<string | null>(null);
  const select = (id: string) => {
    setTab(id);
    setEditing(null);
    setSearch('');
    window.history.replaceState(null, '', '?tab=' + id);
  };
  const current = tabs.find((t) => t[0] === tab)!;
  const filtered = projects.filter((p) =>
    (p.name + ' ' + p.locality).toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')),
  );
  const descriptions: Record<string, string> = {
    operations: 'Quy trình dự án, nhân viên, tài liệu và sổ theo dõi kế toán.',
    applications: 'Phân công thẩm định, bổ sung, quyết định độc lập và đề nghị xem xét lại.',
    inventory: 'Mặt bằng căn, hệ số giá và lựa chọn căn theo hồ sơ được phê duyệt.',
    'form-mappings': 'Ánh xạ trường bản khai vào mẫu được phê duyệt và kiểm tra bản xem trước.',
    overview: 'Theo dõi dự án, lịch tiếp nhận và hoạt động chuẩn bị hồ sơ.',
    projects: 'Công bố thông tin dự án để khách hàng khám phá và bắt đầu chuẩn bị hồ sơ.',
    rounds: 'Tạo và điều chỉnh thời gian cho từng đợt tiếp nhận của dự án.',
    requests: 'Tiếp nhận câu hỏi và phản hồi hướng dẫn từ cùng một nơi.',
    partners: 'Quản lý đối tác, phân quyền nhân viên, giao dự án và duyệt chiến dịch truyền thông.',
    forms: 'Rà soát mẫu nguồn và công bố hướng dẫn cho khách theo từng dự án.',
    privacy: 'Thông báo theo phiên bản, đồng ý xử lý và yêu cầu quyền dữ liệu cá nhân.',
    lotteries: 'Tính suất ưu tiên, duyệt quy chế và điều khiển phiên diễn tập có kiểm chứng.',
    government: 'Mở cổng chính thức theo nghiệp vụ; hiển thị đúng mức độ kết nối.',
    openai: 'Quản lý OpenAI API, mô hình và hạn mức sử dụng cho tổ chức.',
    audit: 'Kiểm tra các thao tác và tính toàn vẹn của chuỗi sự kiện.',
    zalo: 'Chủ đầu tư tự cấu hình kênh xác thực điện thoại cho khách hàng.',
  };
  return (
    <div className="workspace">
      <aside className="workspace-sidebar">
        <Brand compact />
        <div className="workspace-label">QUẢN TRỊ CHỦ ĐẦU TƯ</div>
        <nav aria-label="Phân hệ quản trị">
          {tabs.map(([id, label, icon]) => (
            <Fragment key={id}>
              {navGroups[id!] && <span className="nav-group-label">{navGroups[id!]}</span>}
              <button
                type="button"
                className={tab === id ? 'active' : ''}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => select(id!)}
              >
                <Icon name={icon} />
                {label}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Icon name="shield" />
          <strong>Không gian quản trị bảo vệ</strong>
          <p>Xác thực đa yếu tố. Thao tác được lưu trong nhật ký.</p>
          <a href="https://github.com/BDSG-VN/noxh-open-platform">BDSG Foundation ↗</a>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-top">
          <span>Không gian chủ đầu tư / {current[1]}</span>
          <div className="top-actions">
            <span className="environment-dot">Bản phát triển</span>
            <StaffLogout />
          </div>
        </header>
        <main className="workspace-content">
          <PageHeading
            eyebrow="BDSG FOUNDATION / NOXH OPEN PLATFORM"
            title={current[1]!}
            description={descriptions[tab]!}
            action={
              ['projects', 'rounds'].includes(tab) ? (
                <Button onClick={() => setEditing(editing === null ? 'new' : null)}>
                  <Icon name="plus" size={17} />
                  {editing === null
                    ? tab === 'projects'
                      ? 'Thêm dự án'
                      : 'Tạo đợt tiếp nhận'
                    : 'Về danh sách'}
                </Button>
              ) : undefined
            }
          />
          {tab === 'overview' && (
            <>
              <div className="metric-grid">
                {[
                  ['Dự án đang quản lý', counts.projects, 'building'],
                  ['Lịch đang mở', counts.open_rounds, 'calendar'],
                  ['Hồ sơ chuẩn bị', counts.preparatory_dossiers, 'folder'],
                  ['Tài khoản khách', counts.citizen_accounts, 'user'],
                ].map(([label, count, icon]) => (
                  <div className="metric" key={label}>
                    <Icon name={String(icon)} />
                    <span>{label}</span>
                    <strong>{count}</strong>
                    <small>Dữ liệu từ hệ thống</small>
                  </div>
                ))}
              </div>
              <div className="content-columns">
                <div className="stack">
                  <section className="surface">
                    <div className="surface-head">
                      <div>
                        <h2 className="section-title">Danh mục dự án</h2>
                        <p className="section-subtitle">Trạng thái công bố mới nhất</p>
                      </div>
                      <button className="text-button" onClick={() => select('projects')}>
                        Quản lý dự án →
                      </button>
                    </div>
                    <ProjectTable
                      projects={projects.slice(0, 5)}
                      onEdit={(id) => {
                        select('projects');
                        setEditing(id);
                      }}
                    />
                  </section>
                  <section className="surface">
                    <div className="surface-head">
                      <h2 className="section-title">Lịch tiếp nhận</h2>
                      <button className="text-button" onClick={() => select('rounds')}>
                        Xem tất cả →
                      </button>
                    </div>
                    <div className="surface-body">
                      {rounds.length ? (
                        rounds.slice(0, 3).map((r) => (
                          <div className="timeline-row" key={r.id}>
                            <Icon name="calendar" />
                            <div>
                              <strong>{r.name}</strong>
                              <small>
                                {r.project_name} · {dateLabel(r.opens_at)} —{' '}
                                {dateLabel(r.closes_at)}
                              </small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <EmptyState
                          title="Chưa có lịch tiếp nhận"
                          description="Tạo một đợt cho dự án để công bố thời gian chuẩn bị."
                        />
                      )}
                    </div>
                  </section>
                </div>
                <div className="stack">
                  <div className="welcome-banner" style={{ display: 'block' }}>
                    <Icon name="chat" size={30} />
                    <h2 style={{ fontSize: 20, marginTop: 18 }}>Đồng hành cùng khách hàng</h2>
                    <p>Trả lời câu hỏi về quy trình và hướng dẫn chuẩn bị hồ sơ.</p>
                    <Button variant="secondary" className="mt-5" onClick={() => select('requests')}>
                      Mở yêu cầu hỗ trợ <Icon name="arrow" size={15} />
                    </Button>
                  </div>
                  <section className="surface">
                    <div className="surface-body">
                      <h3>Thiết lập vận hành</h3>
                      {[
                        [
                          'Dự án đã công bố',
                          projects.some((p) => p.publication_status === 'published'),
                        ],
                        ['Lịch tiếp nhận', rounds.length > 0],
                        ['Xác thực Zalo OTP', Boolean(settings?.enabled)],
                      ].map(([label, done]) => (
                        <div className="checklist-item" key={String(label)}>
                          <span className={'checklist-marker ' + (done ? 'done' : '')}>
                            <Icon name={done ? 'check' : 'clock'} size={13} />
                          </span>
                          {label}
                        </div>
                      ))}
                      <div className="help-note amber">
                        <p>
                          Quản lý bộ mẫu, ánh xạ PDF và hàng đợi xét duyệt tại các mục tương ứng.
                          Tiếp nhận thật cần nghiệm thu quy trình và cấu hình triển khai.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </>
          )}
          {tab === 'projects' &&
            (editing !== null ? (
              <section className="surface">
                <ProjectEditor key={editing} project={projects.find((p) => p.id === editing)} />
              </section>
            ) : (
              <>
                <div className="toolbar">
                  <input
                    className="search-input"
                    aria-label="Tìm dự án"
                    placeholder="Tìm tên dự án hoặc địa bàn…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <small>{filtered.length} dự án</small>
                </div>
                <section className="surface">
                  <ProjectTable projects={filtered} onEdit={setEditing} />
                </section>
              </>
            ))}
          {tab === 'rounds' &&
            (editing !== null ? (
              <section className="surface">
                <RoundEditor
                  key={editing}
                  projects={projects}
                  round={rounds.find((r) => r.id === editing)}
                />
              </section>
            ) : (
              <section className="surface">
                {rounds.length ? (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Đợt tiếp nhận / dự án</th>
                          <th>Thời gian Việt Nam</th>
                          <th>Trạng thái</th>
                          <th>Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rounds.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <strong>{r.name}</strong>
                              <small>{r.project_name}</small>
                            </td>
                            <td>
                              <small>
                                {dateLabel(r.opens_at)}
                                <br />
                                {dateLabel(r.closes_at)}
                              </small>
                            </td>
                            <td>
                              <span
                                className={
                                  'status-badge ' + (r.status === 'open' ? 'green' : 'amber')
                                }
                              >
                                {r.status === 'open'
                                  ? 'Mở lịch'
                                  : r.status === 'closed'
                                    ? 'Đã đóng'
                                    : 'Bản nháp'}
                              </span>
                            </td>
                            <td>
                              <button className="text-button" onClick={() => setEditing(r.id)}>
                                Chỉnh sửa →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    title="Chưa có lịch tiếp nhận"
                    description="Tạo đợt tiếp nhận đầu tiên cho một dự án đang quản lý."
                  />
                )}
              </section>
            ))}
          {tab === 'operations' && <OperationsAdmin staff={staff} />}
          {tab === 'applications' && <ApplicationsAdmin staff={staff} />}
          {tab === 'inventory' && <InventoryAdmin projects={projects} />}
          {tab === 'form-mappings' && <FormMappingAdmin projects={projects} />}
          {tab === 'requests' && <RequestQueue />}
          {tab === 'forms' && <LegalTemplates projects={projects} />}
          {tab === 'privacy' && <PrivacyAdmin citizenOrigin={citizenOrigin} />}
          {tab === 'lotteries' && (
            <LotteryAdmin projects={projects} transparencyOrigin={transparencyOrigin} />
          )}
          {tab === 'government' && <GovernmentPortals />}
          {tab === 'partners' && <Partners projects={projects} />}
          {tab === 'openai' && <OpenAiSettings />}
          {tab === 'audit' && <AuditPanel />}
          {tab === 'zalo' && settings && (
            <section className="surface">
              <ZaloSettings settings={settings} />
            </section>
          )}
        </main>
        <footer className="workspace-footer">
          NOXH Open Platform · BDSG Foundation · MIT · Dữ liệu demo không dùng cho xét duyệt thật
        </footer>
      </div>
    </div>
  );
}
function ProjectTable({
  projects,
  onEdit,
}: {
  projects: ProjectRow[];
  onEdit: (id: string) => void;
}) {
  return projects.length ? (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Tên dự án</th>
            <th>Địa bàn</th>
            <th>Công bố</th>
            <th>Thao tác</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <div className="table-project">
                  <span className="table-icon">
                    <Icon name="building" />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.is_synthetic ? 'Dữ liệu giả lập · ' : ''}Phiên bản {p.version}
                    </small>
                  </div>
                </div>
              </td>
              <td>{p.locality}</td>
              <td>
                <span
                  className={
                    'status-badge ' + (p.publication_status === 'published' ? 'green' : 'amber')
                  }
                >
                  {p.publication_status === 'published' ? 'Đã công bố' : 'Bản nháp'}
                </span>
              </td>
              <td>
                <button className="text-button" onClick={() => onEdit(p.id)}>
                  Quản lý →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <EmptyState
      title="Chưa có dự án phù hợp"
      description="Thêm dự án mới hoặc thay đổi từ khóa tìm kiếm."
    />
  );
}
