'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Icon } from '@noxh/ui';
import type { PartnerRow, PartnerMember, CampaignRow, PartnerRole } from '@noxh/contracts';
const roles: Record<PartnerRole, string> = {
  partner_admin: 'Quản lý đơn vị',
  campaign_manager: 'Quản lý chiến dịch',
  consultant: 'Chuyên viên tư vấn',
};
const status: Record<string, string> = {
  draft: 'Bản nháp',
  pending: 'Chờ duyệt',
  approved: 'Được phép chạy',
  rejected: 'Cần chỉnh sửa',
  paused: 'Tạm dừng',
};
interface Project {
  id: string;
  name: string;
}
async function request(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/admin/' + path, {
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
function AgencyEditor({ projects, partner }: { projects: Project[]; partner?: PartnerRow }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="surface surface-body stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        const f = new FormData(e.currentTarget);
        const body = {
          name: f.get('name'),
          projectIds: f.getAll('projectIds'),
          ...(partner
            ? { status: f.get('status') }
            : { ownerName: f.get('ownerName'), ownerPhone: f.get('ownerPhone') }),
        };
        try {
          await request(
            'partners' + (partner ? '/' + partner.id : ''),
            body,
            partner ? 'PUT' : 'POST',
            partner?.version,
          );
          window.location.reload();
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Không lưu được');
          setBusy(false);
        }
      }}
    >
      <h2>{partner ? 'Điều chỉnh phạm vi đối tác' : 'Thêm đơn vị đối tác'}</h2>
      <label>
        Tên đơn vị
        <input
          className="search-input"
          name="name"
          required
          minLength={2}
          maxLength={200}
          defaultValue={partner?.name}
        />
      </label>
      {!partner && (
        <div className="form-grid">
          <label>
            Người quản lý đơn vị
            <input className="search-input" name="ownerName" required maxLength={200} />
          </label>
          <label>
            Số điện thoại Zalo của quản lý
            <input className="search-input" type="tel" name="ownerPhone" required maxLength={24} />
          </label>
        </div>
      )}
      {partner && (
        <label>
          Trạng thái hợp tác
          <select className="search-input" name="status" defaultValue={partner.status}>
            <option value="active">Hoạt động</option>
            <option value="suspended">Tạm khóa toàn bộ quyền đối tác</option>
          </select>
        </label>
      )}
      <fieldset>
        <legend>Dự án được giao</legend>
        {projects.map((p) => (
          <label className="checkbox-label" key={p.id}>
            <input
              type="checkbox"
              name="projectIds"
              value={p.id}
              defaultChecked={partner?.project_ids.includes(p.id) ?? false}
            />
            <span>{p.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="help-note">
        <Icon name="shield" />
        <p>
          Thu hồi dự án sẽ dừng trang chiến dịch và quyền xem liên hệ của dự án đó. Tạm khóa đối tác
          có hiệu lực trên các yêu cầu API tiếp theo, kể cả khi nhân viên còn phiên đăng nhập.
        </p>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy}>
        {busy ? 'Đang lưu…' : partner ? 'Lưu phạm vi và trạng thái' : 'Tạo đối tác và cấp quản lý'}
      </Button>
    </form>
  );
}
function Team({ id }: { id: string }) {
  const [items, setItems] = useState<PartnerMember[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    request('partners/' + id + '/members')
      .then((v) => {
        if (live) setItems(v.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  const refresh = async () => setItems((await request('partners/' + id + '/members')).items);
  return (
    <section className="surface">
      <div className="surface-head">
        <h2 className="section-title">Tài khoản nhân viên của đối tác</h2>
      </div>
      <div className="surface-body stack">
        {error && (
          <p className="feedback error" role="alert">
            {error}
          </p>
        )}
        {items.map((m) => (
          <form
            className="member-card stack"
            key={m.id + ':' + m.version}
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const f = new FormData(e.currentTarget);
              try {
                await request(
                  'partners/' + id + '/members/' + m.id,
                  { role: f.get('role'), status: f.get('status') },
                  'PUT',
                  m.version,
                );
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Không lưu được');
              } finally {
                setBusy(false);
              }
            }}
          >
            <strong>
              {m.name} · {m.phoneMasked}
            </strong>
            <div className="form-grid">
              <label>
                Vai trò
                <select className="search-input" name="role" defaultValue={m.role}>
                  {Object.entries(roles).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quyền đăng nhập
                <select className="search-input" name="status" defaultValue={m.status}>
                  <option value="active">Cho phép</option>
                  <option value="suspended">Tạm khóa</option>
                </select>
              </label>
            </div>
            <Button disabled={busy} variant="outline">
              Lưu phân quyền
            </Button>
          </form>
        ))}
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            const form = e.currentTarget,
              f = new FormData(form);
            try {
              await request(
                'partners/' + id + '/members',
                { name: f.get('name'), phone: f.get('phone'), role: f.get('role') },
                'POST',
              );
              await refresh();
              form.reset();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Không thêm được');
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>Cấp thêm tài khoản</h3>
          <div className="form-grid">
            <label>
              Họ tên
              <input className="search-input" name="name" required maxLength={200} />
            </label>
            <label>
              Điện thoại Zalo
              <input className="search-input" name="phone" type="tel" required maxLength={24} />
            </label>
          </div>
          <label>
            Vai trò
            <select className="search-input" name="role" defaultValue="consultant">
              {Object.entries(roles).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy}>Cấp tài khoản</Button>
        </form>
      </div>
    </section>
  );
}
export default function Partners({ projects }: { projects: Project[] }) {
  const [partners, setPartners] = useState<PartnerRow[]>([]),
    [campaigns, setCampaigns] = useState<CampaignRow[]>([]),
    [tab, setTab] = useState('agencies'),
    [editing, setEditing] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([request('partners'), request('partner-campaigns')])
      .then(([p, c]) => {
        if (live) {
          setPartners(p.items);
          setCampaigns(c.items);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="stack">
      <div className="filter-bar">
        <button
          className={'filter-chip ' + (tab === 'agencies' ? 'active' : '')}
          onClick={() => setTab('agencies')}
        >
          Đơn vị & nhân viên ({partners.length})
        </button>
        <button
          className={'filter-chip ' + (tab === 'campaigns' ? 'active' : '')}
          onClick={() => setTab('campaigns')}
        >
          Chiến dịch ({campaigns.length}) · {campaigns.filter((c) => c.status === 'pending').length}{' '}
          chờ duyệt
        </button>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {tab === 'agencies' && (
        <>
          <div className="section-head">
            <p className="section-subtitle">
              Chủ đầu tư kiểm soát đơn vị, dự án được giao và quyền đăng nhập của nhân viên.
            </p>
            <Button onClick={() => setEditing(editing === null ? 'new' : null)}>
              <Icon name="plus" size={16} />
              {editing === null ? 'Thêm đối tác' : 'Về danh sách'}
            </Button>
          </div>
          {editing !== null ? (
            <>
              <AgencyEditor
                key={editing}
                projects={projects}
                partner={partners.find((p) => p.id === editing)}
              />
              {editing !== 'new' && <Team id={editing} />}
            </>
          ) : (
            <section className="surface">
              {partners.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Đơn vị</th>
                        <th scope="col">Phạm vi dự án</th>
                        <th scope="col">Nhân viên</th>
                        <th scope="col">Chiến dịch</th>
                        <th scope="col">Yêu cầu tư vấn</th>
                        <th scope="col">
                          <span className="sr-only">Thao tác</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {partners.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.name}</strong>
                            <small style={{ display: 'block' }}>
                              {p.status === 'active' ? 'Đang hoạt động' : 'Đã tạm khóa'}
                            </small>
                          </td>
                          <td>
                            {p.project_ids
                              .map((id) => projects.find((v) => v.id === id)?.name ?? id)
                              .join(', ') || 'Chưa giao dự án'}
                          </td>
                          <td>{p.members}</td>
                          <td>{p.campaigns}</td>
                          <td>{p.leads}</td>
                          <td>
                            <button className="text-button" onClick={() => setEditing(p.id)}>
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
                  title={loaded ? 'Chưa có đối tác' : 'Đang tải đối tác…'}
                  description="Thêm đơn vị, cấp tài khoản quản lý và giao dự án để bắt đầu."
                />
              )}
            </section>
          )}
        </>
      )}
      {tab === 'campaigns' && (
        <>
          {!campaigns.length && (
            <EmptyState
              title="Chưa có chiến dịch"
              description="Đối tác tạo chiến dịch và gửi duyệt từ bảng điều khiển riêng."
            />
          )}
          {campaigns.map((c) => (
            <section className="surface" key={c.id + ':' + c.version}>
              <div className="surface-head">
                <div>
                  <h2 className="section-title">{c.name}</h2>
                  <p className="section-subtitle">
                    {c.partner_name} · {c.project_name} · {c.channel}
                  </p>
                </div>
                <span className={'status-badge ' + (c.status === 'approved' ? 'green' : 'amber')}>
                  {status[c.status]}
                </span>
              </div>
              <div className="surface-body stack">
                <strong>{c.headline}</strong>
                <p className="request-message">{c.description}</p>
                <small>
                  {c.leads} yêu cầu khách đã chia sẻ · Phiên bản {c.version}
                </small>
                {c.review_note && <p>Ghi chú duyệt: {c.review_note}</p>}
                {['pending', 'approved'].includes(c.status) && (
                  <form
                    className="stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setError('');
                      const f = new FormData(e.currentTarget);
                      try {
                        await request(
                          'partner-campaigns/' + c.id + '/review',
                          { status: f.get('status'), note: f.get('note') },
                          'POST',
                          c.version,
                        );
                        setCampaigns((await request('partner-campaigns')).items);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Không duyệt được');
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Quyết định
                        <select className="search-input" name="status">
                          {c.status === 'pending' ? (
                            <>
                              <option value="approved">Duyệt chạy chiến dịch</option>
                              <option value="rejected">Yêu cầu chỉnh sửa</option>
                            </>
                          ) : (
                            <option value="paused">Tạm dừng chiến dịch</option>
                          )}
                        </select>
                      </label>
                      <label>
                        Ghi chú cho đối tác
                        <input
                          className="search-input"
                          name="note"
                          maxLength={1000}
                          defaultValue={c.review_note}
                        />
                      </label>
                    </div>
                    <Button disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu quyết định'}</Button>
                  </form>
                )}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
