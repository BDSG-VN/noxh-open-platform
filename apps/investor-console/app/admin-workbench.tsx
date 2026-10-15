'use client';
import { useState } from 'react';
import { Button, Card, CardHeader, CardTitle, CardContent } from '@noxh/ui';
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
function localDate(value: string) {
  return new Date(new Date(value).getTime() + 7 * 3600000).toISOString().slice(0, 16);
}
function RoundEditor({ projects, round }: { projects: ProjectRow[]; round?: RoundRow }) {
  const [projectId, setProject] = useState(round?.project_id ?? projects[0]?.id ?? ''),
    [name, setName] = useState(round?.name ?? ''),
    [status, setStatus] = useState(round?.status ?? 'draft'),
    [opensAt, setOpen] = useState(round ? localDate(round.opens_at) : ''),
    [closesAt, setClose] = useState(round ? localDate(round.closes_at) : ''),
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
            round ? 'rounds/' + round.id : 'rounds',
            {
              projectId,
              name,
              status,
              opensAt: new Date(opensAt + ':00+07:00').toISOString(),
              closesAt: new Date(closesAt + ':00+07:00').toISOString(),
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
          value={opensAt}
          onChange={(e) => setOpen(e.target.value)}
        />
      </label>
      <label>
        Kết thúc (giờ Việt Nam)
        <input
          className="search-input"
          type="datetime-local"
          required
          value={closesAt}
          onChange={(e) => setClose(e.target.value)}
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
export default function AdminWorkbench({
  projects,
  rounds,
  settings,
  counts,
}: {
  projects: ProjectRow[];
  rounds: RoundRow[];
  settings?: SettingsRow;
  counts: {
    projects: number;
    open_rounds: number;
    preparatory_dossiers: number;
    citizen_accounts: number;
  };
}) {
  const [tab, setTab] = useState('overview');
  return (
    <>
      <nav className="navigation my-6" aria-label="Phân hệ quản trị">
        {[
          ['overview', 'Tổng quan'],
          ['projects', 'Dự án'],
          ['rounds', 'Lịch tiếp nhận'],
          ...(settings ? [['zalo', 'Zalo OTP']] : []),
        ].map(([id, label]) => (
          <Button key={id} variant={tab === id ? 'default' : 'outline'} onClick={() => setTab(id!)}>
            {label}
          </Button>
        ))}
      </nav>
      {tab === 'overview' && (
        <div className="grid-two">
          {[
            ['Dự án đang quản lý', counts.projects],
            ['Lịch đang mở', counts.open_rounds],
            ['Hồ sơ chuẩn bị', counts.preparatory_dossiers],
            ['Tài khoản khách', counts.citizen_accounts],
          ].map(([label, count]) => (
            <Card key={label}>
              <CardHeader>
                <CardTitle className="text-lg">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <strong className="text-4xl">{count}</strong>
                <p className="text-sm">Cập nhật theo dữ liệu hiện có.</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {tab === 'projects' && (
        <div className="grid-two">
          <ProjectEditor />
          {projects.map((p) => (
            <ProjectEditor key={p.id} project={p} />
          ))}
        </div>
      )}
      {tab === 'rounds' && (
        <div className="grid-two">
          <RoundEditor projects={projects} />
          {rounds.map((r) => (
            <RoundEditor key={r.id} projects={projects} round={r} />
          ))}
        </div>
      )}
      {tab === 'zalo' && settings && <ZaloSettings settings={settings} />}
    </>
  );
}
