'use client';
import { useEffect, useState } from 'react';
import { Brand, Button, EmptyState, Icon, PageHeading } from '@noxh/ui';
import type {
  CampaignRow,
  ConsultationLead,
  PartnerActor,
  PartnerMember,
  PartnerRole,
} from '@noxh/contracts';
const roleNames: Record<PartnerRole, string> = {
  partner_admin: 'Quản lý đơn vị',
  campaign_manager: 'Quản lý chiến dịch',
  consultant: 'Chuyên viên tư vấn',
};
const statusNames: Record<string, string> = {
  draft: 'Bản nháp',
  pending: 'Chờ chủ đầu tư duyệt',
  approved: 'Được phép chạy',
  rejected: 'Cần chỉnh sửa',
  paused: 'Tạm dừng',
  new: 'Mới tiếp nhận',
  contacting: 'Đang tư vấn',
  waiting: 'Chờ khách bổ sung',
  closed: 'Đã kết thúc',
  active: 'Đang hoạt động',
  suspended: 'Đã tạm khóa',
};
interface Workspace {
  actor: PartnerActor;
  projects: { id: string; name: string; locality: string }[];
  campaigns: CampaignRow[];
  members: PartnerMember[];
  counts: { new: number; processing: number; closed: number };
}
async function request(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/partner/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Không thực hiện được');
  return v;
}
function CampaignEditor({
  projects,
  campaign,
  onDone,
}: {
  projects: Workspace['projects'];
  campaign?: CampaignRow;
  onDone: () => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="surface surface-body stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        try {
          await request(
            'campaigns' + (campaign ? '/' + campaign.id : ''),
            {
              projectId: f.get('projectId'),
              name: f.get('name'),
              channel: f.get('channel'),
              headline: f.get('headline'),
              description: f.get('description'),
            },
            campaign ? 'PUT' : 'POST',
            campaign?.version,
          );
          onDone();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Không lưu được');
          setBusy(false);
        }
      }}
    >
      <h2>{campaign ? 'Chỉnh sửa chiến dịch' : 'Tạo chiến dịch truyền thông'}</h2>
      <p>
        Nội dung sẽ cần chủ đầu tư duyệt trước khi đường dẫn tư vấn hoạt động. Chỉnh sửa bản đang
        chạy sẽ đưa chiến dịch về bản nháp.
      </p>
      <div className="form-grid">
        <label>
          Tên chiến dịch
          <input
            className="search-input"
            name="name"
            required
            maxLength={200}
            defaultValue={campaign?.name}
          />
        </label>
        <label>
          Dự án được giao
          <select
            className="search-input"
            name="projectId"
            required
            defaultValue={campaign?.project_id ?? projects[0]?.id}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Kênh truyền thông
        <select className="search-input" name="channel" defaultValue={campaign?.channel ?? 'web'}>
          <option value="web">Website</option>
          <option value="facebook">Facebook</option>
          <option value="zalo">Zalo</option>
          <option value="other">Kênh khác</option>
        </select>
      </label>
      <label>
        Tiêu đề trang tư vấn
        <input
          className="search-input"
          name="headline"
          required
          maxLength={200}
          defaultValue={campaign?.headline}
        />
      </label>
      <label>
        Nội dung giới thiệu
        <textarea
          className="search-input"
          name="description"
          required
          rows={7}
          maxLength={4000}
          defaultValue={campaign?.description}
        />
      </label>
      <div className="help-note">
        <Icon name="shield" />
        <p>
          Thông tin tư vấn cần đúng nguồn dự án. Không cam kết khách đủ điều kiện, được duyệt hồ sơ
          hoặc được phân nhà. Trang tư vấn không phải nơi nộp hồ sơ chính thức.
        </p>
      </div>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <Button disabled={busy || !projects.length}>
        {busy ? 'Đang lưu…' : 'Lưu bản nháp chiến dịch'}
      </Button>
    </form>
  );
}
function Team({ members }: { members: PartnerMember[] }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="stack">
      <section className="surface">
        <div className="surface-head">
          <h2 className="section-title">Thành viên và quyền đăng nhập</h2>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th>Thay đổi quyền</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    <small style={{ display: 'block' }}>{m.phoneMasked}</small>
                  </td>
                  <td>{roleNames[m.role]}</td>
                  <td>{statusNames[m.status]}</td>
                  <td>
                    <form
                      className="top-actions"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setError('');
                        const f = new FormData(e.currentTarget);
                        try {
                          await request(
                            'members/' + m.id,
                            { role: f.get('role'), status: f.get('status') },
                            'PUT',
                            m.version,
                          );
                          window.location.reload();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Không lưu được');
                          setBusy(false);
                        }
                      }}
                    >
                      <select
                        aria-label={'Vai trò của ' + m.name}
                        className="search-input"
                        name="role"
                        defaultValue={m.role}
                      >
                        {Object.entries(roleNames).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={'Trạng thái của ' + m.name}
                        className="search-input"
                        name="status"
                        defaultValue={m.status}
                      >
                        <option value="active">Hoạt động</option>
                        <option value="suspended">Tạm khóa</option>
                      </select>
                      <Button disabled={busy} variant="outline">
                        Lưu
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <form
        className="surface surface-body stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const f = new FormData(e.currentTarget);
          try {
            await request(
              'members',
              { name: f.get('name'), phone: f.get('phone'), role: f.get('role') },
              'POST',
            );
            window.location.reload();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Không thêm được');
            setBusy(false);
          }
        }}
      >
        <h2>Cấp tài khoản nhân viên</h2>
        <p>
          Nhân viên đăng nhập tại cổng này bằng số điện thoại đã được cấp quyền và mã xác nhận qua
          Zalo.
        </p>
        <div className="form-grid">
          <label>
            Họ tên nhân viên
            <input className="search-input" name="name" required maxLength={200} />
          </label>
          <label>
            Số điện thoại Zalo
            <input className="search-input" name="phone" type="tel" required maxLength={24} />
          </label>
        </div>
        <label>
          Vai trò
          <select className="search-input" name="role" defaultValue="consultant">
            {Object.entries(roleNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="help-note">
          <Icon name="shield" />
          <p>
            Quản lý đơn vị được cấp/khóa nhân viên. Quản lý chiến dịch được soạn chiến dịch, phân
            công và quản lý yêu cầu. Chuyên viên chỉ xem liên hệ được giao, cập nhật tiến độ tư vấn;
            không được tự nâng quyền hoặc xem hồ sơ khách.
          </p>
        </div>
        <Button disabled={busy}>{busy ? 'Đang thêm…' : 'Cấp tài khoản đăng nhập'}</Button>
      </form>
    </div>
  );
}
function Leads({ actor, members }: { actor: PartnerActor; members: PartnerMember[] }) {
  const [items, setItems] = useState<ConsultationLead[]>([]),
    [selected, setSelected] = useState(''),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    request('leads')
      .then((v) => {
        if (live) {
          setItems(v.items);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  const current = items.find((i) => i.id === selected),
    visible = items.filter(
      (i) =>
        (filter === 'all' || i.status === filter) &&
        (i.fullName + ' ' + i.phone + ' ' + i.project_name)
          .toLocaleLowerCase('vi')
          .includes(search.toLocaleLowerCase('vi')),
    );
  const refresh = async () => setItems((await request('leads')).items);
  return (
    <div className="stack">
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <div className="help-note">
        <Icon name="shield" />
        <p>
          {actor.role === 'consultant'
            ? 'Chỉ hiển thị yêu cầu khách đã đồng ý chia sẻ và được giao cho bạn.'
            : 'Liên hệ do khách đồng ý chia sẻ với đơn vị. Phân công cho nhân viên để bắt đầu tư vấn.'}{' '}
          Không có quyền mở hồ sơ riêng hoặc giấy tờ của khách.
        </p>
      </div>
      <section className="surface">
        <div className="surface-head">
          <h2 className="section-title">
            Yêu cầu tư vấn {actor.role === 'consultant' ? 'của tôi' : ''}
          </h2>
          <span className="status-badge">{visible.length} yêu cầu</span>
        </div>
        <div className="surface-body form-grid">
          <input
            className="search-input"
            aria-label="Tìm yêu cầu tư vấn"
            placeholder="Tên khách, điện thoại hoặc dự án…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="search-input"
            aria-label="Lọc trạng thái tư vấn"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Tất cả trạng thái</option>
            {['new', 'contacting', 'waiting', 'closed'].map((s) => (
              <option key={s} value={s}>
                {statusNames[s]}
              </option>
            ))}
          </select>
        </div>
        {visible.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Khách hàng</th>
                  <th>Dự án / chiến dịch</th>
                  <th>Trạng thái</th>
                  <th>Chuyên viên</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.fullName}</strong>
                      <small style={{ display: 'block' }}>{l.phone.replace(/^84/, '0')}</small>
                    </td>
                    <td>
                      {l.project_name}
                      <small style={{ display: 'block' }}>{l.campaign_name}</small>
                    </td>
                    <td>
                      <span
                        className={'status-badge ' + (l.status === 'closed' ? 'green' : 'amber')}
                      >
                        {statusNames[l.status]}
                      </span>
                    </td>
                    <td>
                      {l.assignee_id === actor.memberId
                        ? 'Tôi'
                        : (members.find((m) => m.id === l.assignee_id)?.name ?? 'Chưa phân công')}
                    </td>
                    <td>
                      <button className="text-button" onClick={() => setSelected(l.id)}>
                        Chi tiết →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={loaded ? 'Chưa có yêu cầu phù hợp' : 'Đang tải yêu cầu…'}
            description="Yêu cầu chỉ xuất hiện sau khi khách xác thực điện thoại và đồng ý chia sẻ liên hệ."
          />
        )}
      </section>
      {current && (
        <section className="surface" key={current.id + ':' + current.version}>
          <div className="surface-head">
            <h2 className="section-title">{current.fullName}</h2>
            <button className="text-button" onClick={() => setSelected('')}>
              Đóng chi tiết
            </button>
          </div>
          <div className="surface-body stack">
            <p>
              <strong>Liên hệ:</strong> {current.phone.replace(/^84/, '0')}
            </p>
            <p className="request-message">{current.message}</p>
            <small>
              Khách gửi {new Date(current.created_at).toLocaleString('vi-VN')} · Bản{' '}
              {current.version}
            </small>
            {actor.role !== 'consultant' && current.status !== 'closed' && (
              <form
                className="stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  setError('');
                  try {
                    await request(
                      'leads/' + current.id + '/assign',
                      { memberId: f.get('memberId') },
                      'POST',
                      current.version,
                    );
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Không phân công được');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Giao cho nhân viên
                  <select
                    className="search-input"
                    name="memberId"
                    required
                    defaultValue={current.assignee_id ?? ''}
                  >
                    <option value="" disabled>
                      Chọn nhân viên đang hoạt động
                    </option>
                    {members
                      .filter((m) => m.status === 'active')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} · {roleNames[m.role]}
                        </option>
                      ))}
                  </select>
                </label>
                <Button variant="outline" disabled={busy}>
                  Lưu phân công
                </Button>
              </form>
            )}
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                setError('');
                try {
                  await request(
                    'leads/' + current.id,
                    { status: f.get('status'), note: f.get('note') },
                    'PUT',
                    current.version,
                  );
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Không cập nhật được');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Tiến độ tư vấn
                <select
                  className="search-input"
                  name="status"
                  disabled={current.status === 'closed'}
                  defaultValue={current.status === 'new' ? 'contacting' : current.status}
                >
                  {['contacting', 'waiting', 'closed'].map((s) => (
                    <option key={s} value={s}>
                      {statusNames[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Ghi chú tư vấn nội bộ
                <textarea
                  className="search-input"
                  name="note"
                  rows={5}
                  maxLength={2000}
                  disabled={current.status === 'closed'}
                  defaultValue={current.note}
                />
              </label>
              <Button disabled={busy || current.status === 'closed'}>Lưu tiến độ tư vấn</Button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
export default function PartnerWorkbench({
  initial,
  initialTab,
  citizenUrl,
}: {
  initial: Workspace;
  initialTab: string;
  citizenUrl: string;
}) {
  const a = initial.actor,
    manager = a.role !== 'consultant';
  const tabs = [
    ['overview', 'Tổng quan', 'grid'],
    ['leads', a.role === 'consultant' ? 'Khách được giao' : 'Yêu cầu tư vấn', 'chat'],
    ['campaigns', 'Chiến dịch truyền thông', 'building'],
    ...(a.role === 'partner_admin' ? [['team', 'Nhân viên & phân quyền', 'user']] : []),
    ['projects', 'Dự án được giao', 'folder'],
  ];
  const [tab, setTab] = useState(tabs.some((t) => t[0] === initialTab) ? initialTab : 'overview'),
    [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const current = tabs.find((t) => t[0] === tab)!;
  const select = (id: string) => {
    setTab(id);
    setEditing(null);
    setError('');
    window.history.replaceState(null, '', '?tab=' + id);
  };
  return (
    <div className="workspace">
      <aside className="workspace-sidebar">
        <Brand compact />
        <div className="workspace-label">ĐỐI TÁC / TƯ VẤN</div>
        <nav aria-label="Chức năng đối tác">
          {tabs.map(([id, label, icon]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => select(id!)}>
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <Icon name="user" />
          <strong>{a.name}</strong>
          <p>
            {roleNames[a.role]}
            <br />
            {a.partnerName}
          </p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-top">
          <span>
            {a.partnerName} / {current[1]}
          </span>
          <div className="top-actions">
            <span className="status-badge green">{roleNames[a.role]}</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                  });
                  if (!r.ok) throw new Error('Chưa thu hồi được phiên');
                  window.location.assign('/login');
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Không đăng xuất được');
                  setBusy(false);
                }
              }}
            >
              Đăng xuất
            </Button>
          </div>
        </header>
        <main className="workspace-content">
          <PageHeading
            eyebrow="BDSG FOUNDATION / MẠNG LƯỚI ĐỐI TÁC"
            title={current[1]!}
            description={
              a.role === 'consultant'
                ? 'Tư vấn khách hàng trong phạm vi được phân công.'
                : 'Quản lý truyền thông và tư vấn theo phạm vi chủ đầu tư giao.'
            }
            action={
              tab === 'campaigns' && manager ? (
                <Button onClick={() => setEditing(editing === null ? 'new' : null)}>
                  <Icon name="plus" size={16} />
                  {editing === null ? 'Tạo chiến dịch' : 'Về danh sách'}
                </Button>
              ) : undefined
            }
          />
          {error && (
            <p role="alert" className="feedback error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="feedback">
              {message}
            </p>
          )}
          {tab === 'overview' && (
            <>
              <div className="metric-grid">
                {[
                  ['Yêu cầu mới', initial.counts.new, 'chat'],
                  ['Đang tư vấn', initial.counts.processing, 'clock'],
                  ['Đã kết thúc', initial.counts.closed, 'check'],
                  ['Dự án được giao', initial.projects.length, 'building'],
                ].map(([label, count, icon]) => (
                  <div className="metric" key={label}>
                    <Icon name={String(icon)} />
                    <span>{label}</span>
                    <strong>{count}</strong>
                    <small>
                      {a.role === 'consultant' ? 'Trong phạm vi được giao' : 'Dữ liệu của đơn vị'}
                    </small>
                  </div>
                ))}
              </div>
              <div className="welcome-banner">
                <div>
                  <span className="kicker">XIN CHÀO, {a.name}</span>
                  <h2>
                    {a.role === 'consultant'
                      ? 'Sẵn sàng đồng hành cùng khách hàng'
                      : 'Từ chiến dịch đến tư vấn, cùng một quy trình'}
                  </h2>
                  <p>
                    {a.role === 'consultant'
                      ? 'Mở danh sách khách được giao để xem nội dung cần tư vấn và cập nhật tiến độ.'
                      : 'Soạn chiến dịch, gửi chủ đầu tư duyệt, chia sẻ đường dẫn và phân công yêu cầu cho nhân viên.'}
                  </p>
                  <Button onClick={() => select('leads')}>
                    Mở yêu cầu tư vấn <Icon name="arrow" size={16} />
                  </Button>
                </div>
                <Icon name="chat" size={88} />
              </div>
            </>
          )}
          {tab === 'leads' && <Leads actor={a} members={initial.members} />}
          {tab === 'team' && a.role === 'partner_admin' && <Team members={initial.members} />}
          {tab === 'projects' && (
            <div className="project-grid">
              {initial.projects.map((p) => (
                <article className="surface surface-body" key={p.id}>
                  <Icon name="building" />
                  <h2>{p.name}</h2>
                  <p>{p.locality}</p>
                  <span className="status-badge green">Chủ đầu tư đã giao</span>
                </article>
              ))}
            </div>
          )}
          {tab === 'campaigns' &&
            (editing !== null ? (
              <CampaignEditor
                projects={initial.projects}
                campaign={initial.campaigns.find((c) => c.id === editing)}
                onDone={() => window.location.reload()}
              />
            ) : (
              <div className="stack">
                {!initial.campaigns.length && (
                  <EmptyState
                    title="Chưa có chiến dịch"
                    description={
                      manager
                        ? 'Tạo chiến dịch cho một dự án được giao, sau đó gửi chủ đầu tư duyệt.'
                        : 'Quản lý đơn vị sẽ tạo và gửi duyệt chiến dịch.'
                    }
                  />
                )}{' '}
                {initial.campaigns.map((c) => (
                  <article className="surface surface-body stack" key={c.id}>
                    <div className="section-head">
                      <span
                        className={'status-badge ' + (c.status === 'approved' ? 'green' : 'amber')}
                      >
                        {statusNames[c.status]}
                      </span>
                      <span className="kicker">
                        {c.channel} · {c.leads} yêu cầu
                      </span>
                    </div>
                    <h2>{c.name}</h2>
                    <p>{c.project_name}</p>
                    <strong>{c.headline}</strong>
                    <p className="request-message">{c.description}</p>
                    {c.review_note && (
                      <div className="help-note amber">
                        <p>Chủ đầu tư: {c.review_note}</p>
                      </div>
                    )}
                    <div className="top-actions">
                      {manager && (
                        <Button variant="outline" onClick={() => setEditing(c.id)}>
                          Chỉnh sửa
                        </Button>
                      )}
                      {manager && ['draft', 'rejected', 'paused'].includes(c.status) && (
                        <Button
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            try {
                              await request('campaigns/' + c.id + '/submit', {}, 'POST', c.version);
                              window.location.reload();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Không gửi duyệt được');
                              setBusy(false);
                            }
                          }}
                        >
                          Gửi chủ đầu tư duyệt
                        </Button>
                      )}
                      {c.status === 'approved' && (
                        <>
                          <a
                            className="text-button"
                            target="_blank"
                            rel="noopener noreferrer"
                            href={citizenUrl + '/tu-van/' + c.id}
                          >
                            Mở trang tư vấn ↗
                          </a>
                          <Button
                            variant="outline"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(citizenUrl + '/tu-van/' + c.id);
                                setMessage('Đã sao chép đường dẫn chiến dịch.');
                              } catch {
                                setMessage(
                                  'Đường dẫn chiến dịch: ' + citizenUrl + '/tu-van/' + c.id,
                                );
                              }
                            }}
                          >
                            Sao chép đường dẫn
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ))}
        </main>
        <footer className="workspace-footer">
          NOXH Open Platform · BDSG Foundation · MIT · Tư vấn không thay thế nộp hồ sơ và xét duyệt
          của cơ quan có thẩm quyền.
        </footer>
      </div>
    </div>
  );
}
