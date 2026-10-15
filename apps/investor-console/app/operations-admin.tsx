'use client';
import { useEffect, useState } from 'react';
import InternalFiles from './internal-files';
import { Button } from '@noxh/ui';
import {
  departmentLabels,
  departments,
  employeePermissions,
  permissionLabels,
} from '@noxh/contracts';
import type {
  Employee,
  InternalJournal,
  InternalRecord,
  OperationProject,
  ProjectWorkflow,
} from '@noxh/contracts';
export interface OperationsStaff {
  role: string;
  subject: string;
  permissions?: string[];
  department?: string;
}
async function call(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/admin/operations/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail || b.message || 'Không thực hiện được yêu cầu');
  return b;
}
const taskLabels: Record<string, string> = {
  todo: 'Chưa bắt đầu',
  in_progress: 'Đang thực hiện',
  waiting_external: 'Chờ cơ quan / bên ngoài',
  evidence_recorded: 'Chờ người khác kiểm tra',
  completed: 'Hoàn tất nội bộ',
  not_applicable: 'Đã duyệt không áp dụng',
};
const phaseLabels: Record<string, string> = {
  '01': 'Chuẩn bị đầu tư',
  '02': 'Đất đai và quy hoạch',
  '03': 'Thiết kế và thủ tục xây dựng',
  '04': 'Thi công và chất lượng',
  '05': 'Giá và điều kiện kinh doanh',
  '06': 'Công bố và tiếp nhận',
  '07': 'Đối chiếu và lựa chọn',
  '08': 'Hợp đồng và bàn giao',
  '09': 'Vận hành và lưu trữ',
};
export default function OperationsAdmin({
  staff = { role: 'org_admin', subject: '', permissions: [] },
}: {
  staff?: OperationsStaff;
}) {
  const admin = staff.role === 'org_admin';
  const allowed = (p: string) => admin || Boolean(staff.permissions?.includes(p));
  const [projects, setProjects] = useState<OperationProject[]>([]),
    [project, setProject] = useState(''),
    [tab, setTab] = useState(
      allowed('workflow_read') ? 'workflow' : allowed('records_read') ? 'records' : 'finance',
    ),
    [employees, setEmployees] = useState<Employee[]>([]),
    [workflow, setWorkflow] = useState<ProjectWorkflow | null>(null),
    [records, setRecords] = useState<InternalRecord[]>([]),
    [journals, setJournals] = useState<InternalJournal[]>([]),
    [editing, setEditing] = useState<InternalRecord | null>(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [phaseFilter, setPhaseFilter] = useState(''),
    [taskFilter, setTaskFilter] = useState(''),
    [lines, setLines] = useState([
      { account: '', debit: 0, credit: 0 },
      { account: '', debit: 0, credit: 0 },
    ]);
  useEffect(() => {
    call('projects')
      .then((r) => {
        setProjects(r.items);
        setProject(r.items[0]?.id ?? '');
      })
      .catch((e) => setError(e.message));
  }, []);
  const refresh = async () => {
    if (tab === 'employees') {
      if (admin) setEmployees((await call('employees')).items);
      return;
    }
    if (!project) return;
    if (tab === 'workflow' && allowed('workflow_read'))
      setWorkflow(await call('projects/' + project + '/workflow'));
    if (tab === 'records' && allowed('records_read'))
      setRecords((await call('projects/' + project + '/records')).items);
    if (tab === 'finance' && allowed('finance_read'))
      setJournals((await call('projects/' + project + '/journals')).items);
  };
  useEffect(() => {
    setError('');
    setWorkflow(null);
    setRecords([]);
    setJournals([]);
    setEditing(null);
    void refresh().catch((e) => setError(e.message));
  }, [project, tab]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      await refresh();
      setMessage('Đã lưu đúng phiên bản và ghi nhật ký.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const p = 'projects/' + project;
  const phases = [...new Set(workflow?.tasks.map((t) => t.phase.slice(0, 2)) ?? [])].sort();
  const completed =
    workflow?.tasks.filter((t) => ['completed', 'not_applicable'].includes(t.status)).length ?? 0;
  const progress = workflow?.tasks.length
    ? Math.round((completed / workflow.tasks.length) * 100)
    : 0;
  const visibleTasks = (workflow?.tasks ?? [])
    .filter(
      (t) =>
        (!phaseFilter || t.phase.startsWith(phaseFilter + ' · ')) &&
        (!taskFilter ||
          (taskFilter === 'done'
            ? ['completed', 'not_applicable'].includes(t.status)
            : t.status === taskFilter)),
    )
    .sort((a, b) => a.phase.localeCompare(b.phase) || a.code.localeCompare(b.code));
  function employeeForm(e?: Employee) {
    return (
      <form
        key={e?.id ?? 'new'}
        className="status-panel stack"
        onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          void run(() =>
            call(
              'employees' + (e ? '/' + e.id : ''),
              {
                subject: f.get('subject'),
                name: f.get('name'),
                department: f.get('department'),
                status: f.get('status'),
                permissions: f.getAll('permission'),
                projectIds: f.getAll('project'),
              },
              e ? 'PUT' : 'POST',
              e?.version,
            ),
          );
        }}
      >
        <h3>{e ? e.name : 'Cấp tài khoản nhân viên'}</h3>
        <div className="form-grid">
          <label>
            Định danh do hệ thống đăng nhập cấp
            <input
              className="search-input"
              name="subject"
              defaultValue={e?.subject}
              required
              readOnly={Boolean(e)}
              maxLength={200}
            />
          </label>
          <label>
            Họ tên nhân viên
            <input
              className="search-input"
              name="name"
              defaultValue={e?.name}
              required
              maxLength={120}
            />
          </label>
          <label>
            Phòng ban
            <select
              className="search-input"
              name="department"
              defaultValue={e?.department ?? 'project_office'}
            >
              {departments.map((d) => (
                <option key={d} value={d}>
                  {departmentLabels[d]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trạng thái
            <select className="search-input" name="status" defaultValue={e?.status ?? 'active'}>
              <option value="active">Hoạt động</option>
              <option value="suspended">Tạm dừng toàn bộ quyền</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Quyền được giao — cấp riêng theo trách nhiệm, không theo tên phòng ban</legend>
          <p className="body">
            Quyền rà soát và phê duyệt không thay thế điều kiện phân tách người soạn, người duyệt
            hoặc giới hạn diễn tập. Nhân sự cần có đúng vai trò truy cập phân hệ và dự án được giao.
          </p>
          <div className="form-grid">
            {employeePermissions.map((k) => (
              <label key={k} className="checkbox-label">
                <input
                  name="permission"
                  type="checkbox"
                  value={k}
                  defaultChecked={e?.permissions.includes(k)}
                />
                {permissionLabels[k]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Dự án được phép truy cập</legend>
          {projects.map((pr) => (
            <label key={pr.id} className="checkbox-label">
              <input
                name="project"
                type="checkbox"
                value={pr.id}
                defaultChecked={e?.projectIds.includes(pr.id)}
              />
              {pr.name}
            </label>
          ))}
        </fieldset>
        <Button disabled={busy}>{e ? 'Lưu quyền nhân viên' : 'Đăng ký danh tính nhân sự'}</Button>
      </form>
    );
  }
  return (
    <div className="stack investor-workspace">
      <div className="iw-page-heading">
        <div>
          <p className="iw-kicker">Điều hành nội bộ</p>
          <h2>Công việc và hồ sơ dự án</h2>
          <p>Theo dõi tiến độ, kiểm soát tài liệu và phối hợp giữa các phòng ban.</p>
        </div>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      <nav className="iw-tabs" aria-label="Phân hệ điều hành">
        {[
          ['workflow', 'Tiến độ dự án', 'workflow_read'],
          ['records', 'Wiki & hồ sơ', 'records_read'],
          ['finance', 'Kế toán nội bộ', 'finance_read'],
          ...(admin ? [['employees', 'Nhân sự & phân quyền', '']] : []),
        ]
          .filter(([, , permission]) => !permission || allowed(permission))
          .map(([key, label]) => (
            <Button
              key={key}
              variant={tab === key ? 'default' : 'outline'}
              aria-pressed={tab === key}
              disabled={busy}
              onClick={() => setTab(key ?? 'workflow')}
            >
              {label}
            </Button>
          ))}
      </nav>
      {tab !== 'employees' && (
        <label className="iw-project-select">
          Dự án đang làm việc
          <select
            className="search-input"
            value={project}
            disabled={busy}
            onChange={(e) => {
              setProject(e.target.value);
              setPhaseFilter('');
              setTaskFilter('');
            }}
          >
            <option value="">Chọn dự án</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.name} · {pr.locality}
              </option>
            ))}
          </select>
        </label>
      )}
      {!projects.length && (
        <p className="empty-state">
          Chưa có dự án được cấp quyền. Quản trị tổ chức cần giao phạm vi trước khi nhân viên làm
          việc.
        </p>
      )}
      {tab === 'employees' && admin && (
        <>
          <section className="surface">
            <div className="surface-head">
              <h2>Tài khoản, phòng ban và quyền dự án</h2>
            </div>
            <div className="surface-body stack">
              <div className="iw-stats">
                <div>
                  <span>Nhân sự trong danh sách</span>
                  <strong>{employees.length}</strong>
                </div>
                <div>
                  <span>Đang hoạt động</span>
                  <strong>{employees.filter((e) => e.status === 'active').length}</strong>
                </div>
                <div>
                  <span>Phòng ban có nhân sự</span>
                  <strong>{new Set(employees.map((e) => e.department)).size}</strong>
                </div>
              </div>
              <details className="iw-context-note">
                <summary>Hướng dẫn cấp tài khoản và bảo mật</summary>
                <div>
                  Tạo tài khoản tại Keycloak, gán role <code>noxh_staff</code>, bắt buộc TOTP, rồi
                  đăng ký chính xác subject tại đây. Mật khẩu do hệ thống định danh quản lý. Quyền
                  xét hồ sơ và pháp lý chuyên biệt phải được gán bằng realm role đáng tin cậy; nhân
                  viên không có quyền quản trị tổ chức.
                </div>
              </details>
              <details>
                <summary>Thêm nhân viên</summary>
                {employeeForm()}
              </details>
              {employees.map((e) => (
                <details key={e.id} className="iw-employee-row">
                  <summary className="iw-task-summary">
                    {e.name} · {departmentLabels[e.department]} ·{' '}
                    {e.status === 'active' ? 'Đang hoạt động' : 'Tạm dừng'}
                  </summary>
                  {employeeForm(e)}
                </details>
              ))}
            </div>
          </section>
        </>
      )}
      {project && tab === 'workflow' && allowed('workflow_read') && (
        <>
          {workflow && (
            <section className="surface iw-overview">
              <div className="surface-head">
                <div>
                  <p className="iw-kicker">Tiến độ thực hiện</p>
                  <h2>{projects.find((pr) => pr.id === project)?.name}</h2>
                </div>
                <span className="tag">
                  {workflow.status === 'active' ? 'Kế hoạch đã rà soát' : 'Chờ rà soát kế hoạch'}
                </span>
              </div>
              <div className="surface-body stack">
                <div className="iw-stats">
                  <div>
                    <span>Công việc đã hoàn tất</span>
                    <strong>
                      {completed}
                      <small> / {workflow.tasks.length}</small>
                    </strong>
                  </div>
                  <div>
                    <span>Chờ cơ quan, đơn vị ngoài</span>
                    <strong>
                      {workflow.tasks.filter((t) => t.status === 'waiting_external').length}
                    </strong>
                  </div>
                  <div>
                    <span>Cần kiểm tra chứng cứ</span>
                    <strong>
                      {workflow.tasks.filter((t) => t.status === 'evidence_recorded').length}
                    </strong>
                  </div>
                </div>
                <div className="iw-progress-label">
                  <span>Tiến độ công việc nội bộ</span>
                  <strong>{progress}%</strong>
                </div>
                <progress
                  className="iw-progress"
                  value={completed}
                  max={workflow.tasks.length}
                  aria-label="Tiến độ công việc dự án"
                />
                <div className="iw-phase-grid">
                  {phases.map((phase) => {
                    const tasks = workflow.tasks.filter((t) => t.phase.startsWith(phase + ' · ')),
                      done = tasks.filter((t) =>
                        ['completed', 'not_applicable'].includes(t.status),
                      ).length;
                    return (
                      <button
                        key={phase}
                        className="iw-phase-card"
                        type="button"
                        aria-pressed={phaseFilter === phase}
                        onClick={() => setPhaseFilter(phaseFilter === phase ? '' : phase)}
                      >
                        <span className="iw-phase-number">{phase}</span>
                        <span>
                          <strong>{phaseLabels[phase] ?? 'Giai đoạn ' + phase}</strong>
                          <small>
                            {done}/{tasks.length} công việc hoàn tất
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="iw-toolbar">
                  <label>
                    Lọc công việc
                    <select
                      className="search-input"
                      value={taskFilter}
                      onChange={(e) => setTaskFilter(e.target.value)}
                    >
                      <option value="">Tất cả trạng thái</option>
                      <option value="todo">Chưa bắt đầu</option>
                      <option value="in_progress">Đang thực hiện</option>
                      <option value="waiting_external">Chờ bên ngoài</option>
                      <option value="evidence_recorded">Chờ kiểm tra chứng cứ</option>
                      <option value="done">Đã chốt nội bộ</option>
                    </select>
                  </label>
                  {phaseFilter && (
                    <Button variant="outline" onClick={() => setPhaseFilter('')}>
                      Xem tất cả giai đoạn
                    </Button>
                  )}
                </div>
                <small className="iw-muted">
                  Các bước có thể triển khai song song theo phụ thuộc. Hoàn tất trong hệ thống là
                  kết quả theo dõi nội bộ.
                </small>
              </div>
            </section>
          )}
          <details className="surface iw-disclosure" id="project-plan-review" open={!workflow}>
            <summary className="iw-disclosure-heading">
              <h2>Hành trình thực hiện dự án</h2>
              <span className="tag">
                {workflow?.status === 'active' ? 'Đã rà soát kế hoạch' : 'Kế hoạch cần rà soát'}
              </span>
            </summary>
            <div className="surface-body stack">
              <p>
                Các giai đoạn có thể song song. Chỉ chốt bước khi phụ thuộc đã hoàn tất; bước có
                điều kiện có thể được người khác duyệt không áp dụng với căn cứ riêng. Tài liệu mẫu
                là checklist vận hành cần pháp chế địa phương hóa.
              </p>
              {!workflow && allowed('workflow_write') && (
                <Button
                  disabled={busy}
                  onClick={() => run(() => call(p + '/workflow', {}, 'POST'))}
                >
                  Khởi tạo kế hoạch theo giai đoạn
                </Button>
              )}
              {workflow?.status === 'draft' && allowed('workflow_review') && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      call(
                        p + '/workflow/activate',
                        { note: f.get('note'), reviewed: true },
                        'POST',
                        workflow.version,
                      ),
                    );
                  }}
                >
                  <label>
                    Kết luận rà soát nhánh áp dụng, căn cứ, địa phương, chuyển tiếp
                    <textarea
                      className="search-input"
                      name="note"
                      minLength={10}
                      required
                      maxLength={3000}
                    />
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" required />
                    Tôi là người khác người tạo, đã rà soát kế hoạch và các yêu cầu riêng của dự án.
                  </label>
                  <Button disabled={busy}>Ghi nhận rà soát kế hoạch</Button>
                </form>
              )}
              {workflow?.legal_note && (
                <p>
                  <strong>Căn cứ kế hoạch:</strong> {workflow.legal_note}
                </p>
              )}
            </div>
          </details>
          {workflow && (
            <>
              {!visibleTasks.length && (
                <div className="surface">
                  <div className="surface-body empty-state">
                    <strong>Không có công việc theo bộ lọc hiện tại</strong>
                    <p>Thay đổi giai đoạn hoặc trạng thái để xem các công việc khác.</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPhaseFilter('');
                        setTaskFilter('');
                      }}
                    >
                      Xóa bộ lọc
                    </Button>
                  </div>
                </div>
              )}
              {visibleTasks.map((t) => (
                <details key={t.code} className="surface iw-task">
                  <summary className="iw-task-summary">
                    <div>
                      <small>{t.phase}</small>
                      <h3>{t.title}</h3>
                    </div>
                    <span className="tag">{taskLabels[t.status]}</span>
                  </summary>
                  <div className="surface-body stack">
                    <p>{t.guidance}</p>
                    <p>
                      <strong>Phụ thuộc:</strong>{' '}
                      {t.dependencies.length
                        ? t.dependencies
                            .map((d) => workflow.tasks.find((v) => v.code === d)?.title ?? d)
                            .join(' · ')
                        : 'Có thể bắt đầu độc lập'}
                    </p>
                    {t.external && (
                      <p className="feedback">
                        Công việc có chứng cứ từ bên ngoài. Phải lưu số văn bản, cơ quan, ngày và
                        SHA-256; phần mềm không xác minh chữ ký hay tự kết luận cơ quan đã phê
                        duyệt.
                      </p>
                    )}
                    {t.note && <p>{t.note}</p>}
                    {t.evidence && (
                      <p style={{ overflowWrap: 'anywhere' }}>
                        Chứng cứ: {t.evidence.reference} · {t.evidence.authority} ·{' '}
                        {t.evidence.issuedOn}
                        <br />
                        <code>{t.evidence.sha256}</code>
                      </p>
                    )}
                    {workflow.status === 'active' &&
                      !['completed', 'not_applicable'].includes(t.status) &&
                      allowed('workflow_write') && (
                        <details>
                          <summary>Cập nhật công việc / ghi nhận chứng cứ</summary>
                          <form
                            className="stack"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const f = new FormData(e.currentTarget);
                              void run(() =>
                                call(
                                  p + '/workflow/tasks/' + t.code,
                                  {
                                    status: f.get('status'),
                                    note: f.get('note'),
                                    evidence: f.get('reference')
                                      ? {
                                          reference: f.get('reference'),
                                          authority: f.get('authority') || '',
                                          issuedOn: f.get('issuedOn'),
                                          sha256: f.get('sha256'),
                                        }
                                      : null,
                                  },
                                  'PUT',
                                  t.version,
                                ),
                              );
                            }}
                          >
                            <label>
                              Trạng thái
                              <select
                                className="search-input"
                                name="status"
                                defaultValue={t.status}
                              >
                                {[
                                  'todo',
                                  'in_progress',
                                  'waiting_external',
                                  'evidence_recorded',
                                  ...(t.conditional ? ['not_applicable'] : []),
                                ].map((s) => (
                                  <option value={s} key={s}>
                                    {s === 'not_applicable'
                                      ? 'Đề nghị không áp dụng (cần duyệt)'
                                      : taskLabels[s]}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Ghi chú / căn cứ
                              <textarea
                                className="search-input"
                                name="note"
                                defaultValue={t.note}
                                maxLength={2000}
                              />
                            </label>
                            <div className="form-grid">
                              <label>
                                Số văn bản / tham chiếu chứng cứ
                                <input
                                  className="search-input"
                                  name="reference"
                                  defaultValue={t.evidence?.reference}
                                  maxLength={300}
                                />
                              </label>
                              <label>
                                Cơ quan / đơn vị ban hành
                                <input
                                  className="search-input"
                                  name="authority"
                                  defaultValue={t.evidence?.authority}
                                  maxLength={200}
                                />
                              </label>
                              <label>
                                Ngày ban hành
                                <input
                                  className="search-input"
                                  name="issuedOn"
                                  type="date"
                                  defaultValue={t.evidence?.issuedOn}
                                />
                              </label>
                              <label>
                                SHA-256 của tài liệu
                                <input
                                  className="search-input"
                                  name="sha256"
                                  defaultValue={t.evidence?.sha256}
                                  pattern="[a-f0-9]{64}"
                                  maxLength={64}
                                />
                              </label>
                            </div>
                            <Button disabled={busy}>Lưu phiên bản công việc</Button>
                          </form>
                        </details>
                      )}
                    {t.status === 'evidence_recorded' && allowed('workflow_review') && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run(() =>
                            call(
                              p + '/workflow/tasks/' + t.code + '/review',
                              {},
                              'POST',
                              t.version,
                            ),
                          )
                        }
                      >
                        Kiểm tra chứng cứ và duyệt hoàn tất / không áp dụng
                      </Button>
                    )}
                  </div>
                </details>
              ))}
            </>
          )}
        </>
      )}
      {project && tab === 'records' && allowed('records_read') && (
        <>
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>Wiki và hồ sơ nội bộ</h2>
                <p className="iw-muted">
                  Theo dõi phiên bản, kiểm tra nội dung và tìm tài liệu của dự án.
                </p>
              </div>
              <span className="tag">{new Set(records.map((r) => r.record_id)).size} tài liệu</span>
            </div>
            <div className="surface-body">
              <div className="iw-stats">
                <div>
                  <span>Phiên bản đã duyệt</span>
                  <strong>{records.filter((r) => r.status === 'approved').length}</strong>
                </div>
                <div>
                  <span>Chờ kiểm tra</span>
                  <strong>{records.filter((r) => r.status === 'draft').length}</strong>
                </div>
                <div>
                  <span>Đã thu hồi</span>
                  <strong>{records.filter((r) => r.status === 'revoked').length}</strong>
                </div>
              </div>
            </div>
          </section>
          {!records.length && (
            <p className="empty-state">
              Chưa có tài liệu trong phạm vi truy cập. Có thể mở kho tệp hoặc soạn tài liệu mới bên
              dưới.
            </p>
          )}
          {records.map((r) => (
            <details className="surface iw-record-row" key={r.id}>
              <summary className="iw-task-summary">
                <h3>
                  {r.title} · Phiên bản {r.revision}
                </h3>
                <span className="tag">
                  {r.status === 'approved'
                    ? 'Đã duyệt'
                    : r.status === 'revoked'
                      ? 'Đã thu hồi'
                      : 'Bản nháp'}
                </span>
              </summary>
              <div className="surface-body stack">
                <small>
                  {r.kind === 'wiki' ? 'Wiki' : 'Hồ sơ'} ·{' '}
                  {r.classification === 'restricted' ? 'Hạn chế' : 'Nội bộ'} ·{' '}
                  {new Date(r.created_at).toLocaleString('vi-VN')}
                </small>
                <p style={{ whiteSpace: 'pre-wrap' }}>{r.body}</p>
                {r.attachment && <p>Tham chiếu: {r.attachment.reference}</p>}
                <code style={{ overflowWrap: 'anywhere' }}>{r.content_hash}</code>
                <div>
                  {allowed('records_write') && (
                    <Button variant="outline" onClick={() => setEditing(r)}>
                      Tạo phiên bản tiếp theo
                    </Button>
                  )}
                  {allowed('records_review') && r.status !== 'revoked' && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          call(
                            p + '/records/' + r.id + '/review',
                            { action: r.status === 'draft' ? 'approve' : 'revoke' },
                            'POST',
                            r.version,
                          ),
                        )
                      }
                    >
                      {r.status === 'draft' ? 'Duyệt độc lập' : 'Thu hồi phiên bản'}
                    </Button>
                  )}
                </div>
              </div>
            </details>
          ))}
          <details className="surface iw-disclosure">
            <summary className="iw-disclosure-heading">Tệp đính kèm và kho lưu trữ</summary>
            <div className="surface-body">
              <InternalFiles projectId={project} staff={staff} />
            </div>
          </details>
          <details className="surface iw-disclosure" open={Boolean(editing)}>
            <summary className="iw-disclosure-heading">
              <h2>{editing ? 'Soạn phiên bản tiếp theo' : 'Soạn tài liệu mới'}</h2>
            </summary>
            <div className="surface-body stack">
              <p>
                Nội dung được mã hóa; mỗi lần sửa tạo phiên bản bất biến với SHA-256. Tệp nội bộ
                được lưu riêng, mã hóa và chỉ dùng sau quét an toàn; tham chiếu bên ngoài cần kiểm
                tra theo quy trình. Không đưa mật khẩu, khóa hoặc giấy tờ cá nhân không cần thiết
                vào wiki.
              </p>
              {allowed('records_write') && (
                <form
                  key={editing?.id ?? 'new'}
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(async () => {
                      await call(
                        p + '/records',
                        {
                          ...(editing ? { recordId: editing.record_id } : {}),
                          title: f.get('title'),
                          kind: f.get('kind'),
                          classification: f.get('classification'),
                          body: f.get('body'),
                          attachment: f.get('reference')
                            ? { reference: f.get('reference'), sha256: f.get('sha256') }
                            : null,
                        },
                        'POST',
                      );
                      setEditing(null);
                    });
                  }}
                >
                  <h3>{editing ? 'Soạn phiên bản tiếp theo' : 'Soạn tài liệu mới'}</h3>
                  <div className="form-grid">
                    <label>
                      Tiêu đề
                      <input
                        className="search-input"
                        name="title"
                        defaultValue={editing?.title}
                        required
                        maxLength={160}
                      />
                    </label>
                    <label>
                      Loại
                      <select
                        className="search-input"
                        name="kind"
                        defaultValue={editing?.kind ?? 'wiki'}
                      >
                        <option value="wiki">Wiki hướng dẫn</option>
                        <option value="record">Hồ sơ lưu trữ</option>
                      </select>
                    </label>
                    <label>
                      Phân loại
                      <select
                        className="search-input"
                        name="classification"
                        defaultValue={editing?.classification ?? 'internal'}
                      >
                        <option value="internal">Nội bộ dự án</option>
                        <option value="restricted">
                          Hạn chế — phòng pháp chế / tác giả / người duyệt
                        </option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Nội dung
                    <textarea
                      className="search-input"
                      name="body"
                      rows={8}
                      required
                      minLength={10}
                      maxLength={30000}
                      defaultValue={editing?.body}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Mã tham chiếu hồ sơ (nếu có)
                      <input
                        className="search-input"
                        name="reference"
                        defaultValue={editing?.attachment?.reference}
                        maxLength={300}
                      />
                    </label>
                    <label>
                      SHA-256 tệp tham chiếu
                      <input
                        className="search-input"
                        name="sha256"
                        pattern="[a-f0-9]{64}"
                        maxLength={64}
                        defaultValue={editing?.attachment?.sha256}
                      />
                    </label>
                  </div>
                  <div>
                    <Button disabled={busy}>Lưu bản nháp bất biến</Button>
                    {editing && (
                      <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                        Hủy sửa
                      </Button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </details>
        </>
      )}
      {project && tab === 'finance' && allowed('finance_read') && (
        <>
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>Sổ chứng từ nội bộ</h2>
                <p className="iw-muted">
                  Kiểm tra chứng từ, theo dõi phê duyệt và tra cứu bút toán đã ghi.
                </p>
              </div>
              <span className="tag">Đơn vị: VND</span>
            </div>
            <div className="surface-body">
              <div className="iw-stats">
                <div>
                  <span>Đã ghi sổ</span>
                  <strong>{journals.filter((j) => j.status === 'posted').length}</strong>
                </div>
                <div>
                  <span>Chờ người khác duyệt</span>
                  <strong>{journals.filter((j) => j.status === 'draft').length}</strong>
                </div>
                <div>
                  <span>Giá trị chứng từ đã ghi</span>
                  <strong className="iw-amount">
                    {journals
                      .filter((j) => j.status === 'posted')
                      .reduce(
                        (sum, j) =>
                          sum + j.lines.reduce((total, l) => total + BigInt(l.debit), BigInt(0)),
                        BigInt(0),
                      )
                      .toLocaleString('vi-VN')}{' '}
                    đ
                  </strong>
                </div>
              </div>
            </div>
          </section>
          <details className="iw-context-note">
            <summary>Phạm vi sử dụng sổ nội bộ</summary>
            <div>
              Sổ quản trị nội bộ bằng VND. Không thay thế chế độ kế toán, sổ cái pháp định, hóa đơn
              điện tử, kê khai thuế hoặc phần mềm kế toán được doanh nghiệp lựa chọn. Mã tài khoản
              do người lập đối chiếu hệ thống kế toán áp dụng.
            </div>
          </details>
          {!journals.length && (
            <p className="empty-state">
              Chưa có chứng từ. Chứng từ mới cần người khác kiểm tra trước khi ghi sổ.
            </p>
          )}
          {journals.map((j) => (
            <details className="surface iw-record-row" key={j.id}>
              <summary className="iw-task-summary">
                <h3>{j.description}</h3>
                <span className="tag">
                  {j.status === 'posted' ? 'Đã ghi sổ bất biến' : 'Chờ người khác duyệt'}
                </span>
              </summary>
              <div className="surface-body stack">
                <p>
                  {j.date} · Chứng từ {j.evidenceReference}
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Tài khoản</th>
                        <th>Nợ</th>
                        <th>Có</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.lines.map((l, i) => (
                        <tr key={i}>
                          <td>{l.account}</td>
                          <td>{l.debit.toLocaleString('vi-VN')} đ</td>
                          <td>{l.credit.toLocaleString('vi-VN')} đ</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <code style={{ overflowWrap: 'anywhere' }}>{j.content_hash}</code>
                {j.status === 'draft' && allowed('finance_post') && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      run(() => call(p + '/journals/' + j.id + '/post', {}, 'POST', j.version))
                    }
                  >
                    Người khác kiểm tra và ghi sổ
                  </Button>
                )}
              </div>
            </details>
          ))}
          {allowed('finance_write') && (
            <details className="surface iw-disclosure">
              <summary className="iw-disclosure-heading">
                <h2>Lập chứng từ cân đối</h2>
              </summary>
              <form
                className="surface-body stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void run(() =>
                    call(
                      p + '/journals',
                      {
                        date: f.get('date'),
                        description: f.get('description'),
                        evidenceReference: f.get('evidenceReference'),
                        lines,
                      },
                      'POST',
                    ),
                  );
                }}
              >
                <div className="form-grid">
                  <label>
                    Ngày chứng từ
                    <input className="search-input" name="date" type="date" required />
                  </label>
                  <label>
                    Tham chiếu chứng từ
                    <input
                      className="search-input"
                      name="evidenceReference"
                      required
                      minLength={3}
                      maxLength={300}
                    />
                  </label>
                </div>
                <label>
                  Diễn giải
                  <textarea
                    className="search-input"
                    name="description"
                    required
                    minLength={5}
                    maxLength={1000}
                  />
                </label>
                {lines.map((line, i) => (
                  <div className="form-grid" key={i}>
                    <label>
                      Mã tài khoản dòng {i + 1}
                      <input
                        className="search-input"
                        value={line.account}
                        onChange={(e) =>
                          setLines(
                            lines.map((l, n) => (n === i ? { ...l, account: e.target.value } : l)),
                          )
                        }
                        required
                        pattern="[A-Za-z0-9._-]{1,32}"
                      />
                    </label>
                    <label>
                      Nợ (VND)
                      <input
                        className="search-input"
                        type="number"
                        min={0}
                        max={1_000_000_000_000}
                        step={1}
                        value={line.debit}
                        onChange={(e) =>
                          setLines(
                            lines.map((l, n) =>
                              n === i ? { ...l, debit: Number(e.target.value) } : l,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Có (VND)
                      <input
                        className="search-input"
                        type="number"
                        min={0}
                        max={1_000_000_000_000}
                        step={1}
                        value={line.credit}
                        onChange={(e) =>
                          setLines(
                            lines.map((l, n) =>
                              n === i ? { ...l, credit: Number(e.target.value) } : l,
                            ),
                          )
                        }
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={lines.length <= 2}
                      onClick={() => setLines(lines.filter((_, n) => n !== i))}
                    >
                      Bỏ dòng {i + 1}
                    </Button>
                  </div>
                ))}
                <p>
                  Tổng Nợ: {lines.reduce((s, l) => s + l.debit, 0).toLocaleString('vi-VN')} đ · Tổng
                  Có: {lines.reduce((s, l) => s + l.credit, 0).toLocaleString('vi-VN')} đ
                </p>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={lines.length >= 100}
                    onClick={() => setLines([...lines, { account: '', debit: 0, credit: 0 }])}
                  >
                    Thêm dòng
                  </Button>
                  <Button disabled={busy}>Lưu bản nháp</Button>
                </div>
              </form>
            </details>
          )}
        </>
      )}
    </div>
  );
}
