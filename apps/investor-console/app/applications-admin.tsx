'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import {
  ApplicationDecisionSchema,
  RecommendationSchema,
  type ApplicationDetail,
  type ApplicationRead,
} from '@noxh/contracts';
interface Staff {
  subject: string;
  permissions?: string[];
}
const statuses: Record<string, string> = {
  submitted: 'Đã tiếp nhận',
  under_review: 'Đang thẩm định',
  supplement: 'Chờ khách bổ sung',
  recommended: 'Chờ phê duyệt',
  approved: 'Đã phê duyệt',
  rejected: 'Không được phê duyệt',
  withdrawn: 'Khách đã rút',
};
const docTypes: Record<string, string> = {
  identity: 'Giấy tờ định danh',
  housing: 'Chứng minh tình trạng nhà ở',
  income: 'Chứng minh thu nhập',
  subject: 'Chứng minh đối tượng',
  'attested-form': 'Mẫu có xác nhận',
  other: 'Giấy tờ khác',
};
const modes: Record<string, string> = { buy: 'Mua', rent: 'Thuê', 'rent-buy': 'Thuê mua' };
const relationship: Record<string, string> = {
  spouse: 'Vợ/chồng',
  child: 'Con',
  parent: 'Cha/mẹ',
  other: 'Khác',
};
const housing: Record<string, string> = {
  renting: 'Đang thuê',
  'with-family': 'Ở cùng gia đình',
  owned: 'Có nhà',
  other: 'Khác',
};
const currentSteps: Record<string, number> = {
  submitted: 0,
  under_review: 1,
  supplement: 1,
  recommended: 2,
  approved: 3,
  rejected: 3,
};
const nextSteps: Record<string, string> = {
  submitted: 'Phân công người thẩm định để bắt đầu kiểm tra hồ sơ.',
  under_review: 'Kiểm tra bản nộp và chứng cứ, sau đó yêu cầu bổ sung hoặc lập đề xuất.',
  supplement: 'Đang chờ khách gửi bổ sung. Bản nộp ban đầu vẫn được giữ nguyên.',
  recommended: 'Cần người có quyền phê duyệt khác người lập đề xuất kiểm tra và quyết định.',
  approved:
    'Đã có quyết định phê duyệt. Hồ sơ được lưu để thực hiện các bước tiếp theo theo quy chế.',
  rejected:
    'Đã ghi kết quả không phê duyệt. Có thể xử lý đề nghị xem xét lại theo đúng thẩm quyền.',
  withdrawn:
    'Khách đã rút hồ sơ. Giữ nguyên lịch sử tiếp nhận và chứng cứ theo chính sách lưu trữ.',
};
const safe = (v: unknown) => (typeof v === 'string' && v.trim() ? v : 'Chưa khai');
const date = (v: string) => new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
const birthDate = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`
    : safe(v);
async function call(path = '', body?: unknown, version?: number) {
  const r = await fetch('/api/admin/applications' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail ?? 'Không xử lý được hồ sơ');
  return b;
}
function Evidence({
  application,
  kind,
  items,
}: {
  application: string;
  kind: 'documents' | 'forms';
  items: { id: string; sha256?: string; type?: string }[];
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{kind === 'documents' ? 'Giấy tờ đã nộp' : 'Biểu mẫu đã xác nhận'}</th>
            <th scope="col">Toàn vẹn</th>
            <th scope="col">Tệp</th>
          </tr>
        </thead>
        <tbody>
          {items.map((f, i) => (
            <tr key={f.id}>
              <td>
                <strong>
                  {kind === 'documents'
                    ? (docTypes[f.type ?? ''] ?? 'Giấy tờ bổ sung')
                    : 'Biểu mẫu đã điền'}{' '}
                  {i + 1}
                </strong>
              </td>
              <td>
                <details>
                  <summary>Kiểm tra toàn vẹn</summary>
                  <p className="workspace-code">Mã tệp: {f.id}</p>
                  <code className="workspace-code">
                    {f.sha256 ?? 'Hash lưu trong bản ghi bổ sung'}
                  </code>
                </details>
              </td>
              <td>
                <a
                  className="button-link"
                  href={
                    '/api/admin/applications/' + application + '/' + kind + '/' + f.id + '/download'
                  }
                  download
                >
                  Tải bản đã nộp
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export default function ApplicationsAdmin({ staff }: { staff?: Staff }) {
  const detailRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<ApplicationRead[]>([]),
    [detail, setDetail] = useState<ApplicationDetail>(),
    [selected, setSelected] = useState(''),
    [status, setStatus] = useState(''),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const has = (permission: string) => staff?.permissions?.includes(permission) ?? false;
  useEffect(() => {
    if (detail?.id)
      detailRef.current?.scrollIntoView?.({
        block: 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
  }, [detail?.id]);
  useEffect(() => {
    let live = true;
    call()
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
  useEffect(() => {
    let live = true;
    setDetail(undefined);
    if (selected)
      call('/' + selected)
        .then((b) => {
          if (live) setDetail(b);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected]);
  async function refresh() {
    const b = await call();
    setItems(b.items);
    if (selected) setDetail(await call('/' + selected));
  }
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      await refresh();
      setMessage('Đã ghi nhận thao tác. Hồ sơ và nhật ký được cập nhật trên máy chủ.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xử lý được');
    } finally {
      setBusy(false);
    }
  }
  const shown = items.filter(
    (i) =>
      (!status || i.status === status) &&
      [i.receipt_code, i.public_code, i.project_name, i.round_name]
        .join(' ')
        .toLocaleLowerCase('vi-VN')
        .includes(query.toLocaleLowerCase('vi-VN')),
  );
  const declaration = detail?.snapshot.declaration ?? {},
    household = Array.isArray(declaration.household) ? declaration.household : [],
    currentReview = detail?.reviews.find((r) => r.id === detail.recommendation_id),
    assignedToMe = detail?.assigned_reviewer === staff?.subject;
  const supplements = (detail?.supplements ?? []) as (ApplicationDetail['supplements'][number] & {
    documents?: { id: string; sha256: string; type: string }[];
    forms?: { id: string; sha256: string }[];
  })[];
  const docs = new Map((detail?.snapshot.documents ?? []).map((d) => [d.id, d]));
  for (const s of supplements)
    for (const d of s.documents ?? s.documentIds.map((id) => ({ id, sha256: '', type: '' })))
      docs.set(d.id, d);
  const forms = new Map(
    (detail?.snapshot.forms ?? []).map((f) => [f.id, { id: f.id, sha256: f.sha256 }]),
  );
  for (const s of supplements)
    for (const f of s.forms ?? s.formIds.map((id) => ({ id, sha256: '' }))) forms.set(f.id, f);
  return (
    <div className="stack application-workspace">
      <div className="workspace-notice">
        <strong>Tiếp nhận và xét duyệt</strong>
        <span>
          Bản nộp được giữ nguyên; bổ sung và quyết định có lịch sử riêng. Người thẩm định và người
          phê duyệt độc lập.
        </span>
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
      <section className="surface">
        <div className="surface-head">
          <div>
            <h2>Hàng đợi hồ sơ</h2>
            <p className="section-subtitle">Tối đa 200 hồ sơ gần nhất thuộc phạm vi tài khoản</p>
          </div>
          <Button variant="outline" disabled={busy} onClick={() => run(refresh)}>
            Tải lại
          </Button>
        </div>
        <div className="surface-body stack">
          <div className="metric-grid">
            <div className="metric">
              <span>Đã tải</span>
              <strong>{items.length}</strong>
            </div>
            <div className="metric">
              <span>Chờ thẩm định / bổ sung</span>
              <strong>
                {
                  items.filter((i) =>
                    ['submitted', 'under_review', 'supplement'].includes(i.status),
                  ).length
                }
              </strong>
            </div>
            <div className="metric">
              <span>Chờ phê duyệt</span>
              <strong>{items.filter((i) => i.status === 'recommended').length}</strong>
            </div>
            <div className="metric">
              <span>Đã phê duyệt trong danh sách</span>
              <strong>{items.filter((i) => i.status === 'approved').length}</strong>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Tìm mã, dự án hoặc đợt
              <input
                className="search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Mã tiếp nhận hoặc mã công khai"
              />
            </label>
            <label>
              Trạng thái
              <select
                className="search-input"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                {Object.entries(statuses).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <p>Đang tải hồ sơ…</p>
          ) : shown.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Hồ sơ</th>
                    <th scope="col">Dự án / đợt</th>
                    <th scope="col">Tiếp nhận</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <strong>{i.receipt_code}</strong>
                        <p className="section-subtitle">{i.public_code}</p>
                        {i.synthetic && <span className="status-badge">Dữ liệu giả lập</span>}
                      </td>
                      <td>
                        {i.project_name}
                        <p className="section-subtitle">{i.round_name}</p>
                      </td>
                      <td>{date(i.submitted_at)}</td>
                      <td>
                        <span
                          className={'status-badge ' + (i.status === 'approved' ? 'green' : '')}
                        >
                          {statuses[i.status] ?? 'Cần rà soát'}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setError('');
                            setMessage('');
                            setSelected(i.id);
                          }}
                        >
                          Mở hồ sơ
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={
                items.length
                  ? 'Không có hồ sơ phù hợp bộ lọc'
                  : 'Chưa có hồ sơ đã nộp trong phạm vi tài khoản'
              }
              description="Bản khai chuẩn bị chỉ xuất hiện ở đây sau khi khách chủ động nộp qua đợt tiếp nhận hợp lệ."
            />
          )}
        </div>
      </section>
      {selected && !detail && <p>Đang mở bản hồ sơ được cấp quyền…</p>}
      {detail && (
        <section ref={detailRef} className="surface application-detail">
          <div className="surface-head">
            <div>
              <h2 className="workspace-code">{detail.receipt_code}</h2>
              <p className="section-subtitle">
                {detail.public_code} · {detail.project_name}
              </p>
            </div>
            <div className="workspace-state-group">
              <span className="status-badge">
                {statuses[detail.status] ?? 'Cần rà soát'} · Phiên bản {detail.version}
              </span>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected('');
                  setDetail(undefined);
                }}
                disabled={busy}
              >
                Đóng chi tiết
              </Button>
            </div>
          </div>
          <div className="surface-body stack">
            {detail.synthetic && (
              <p className="workspace-notice">
                Hồ sơ giả lập — không phải biên nhận nộp tại cơ quan nhà nước.
              </p>
            )}
            {detail.status !== 'withdrawn' && (
              <ol className="workspace-step-strip" aria-label="Tiến độ xử lý hồ sơ">
                {['Tiếp nhận', 'Thẩm định', 'Phê duyệt', 'Kết quả'].map((label, i) => {
                  const current = currentSteps[detail.status] ?? 0;
                  return (
                    <li
                      key={label}
                      data-complete={i < current}
                      aria-current={i === current ? 'step' : undefined}
                    >
                      <span>{i < current ? '✓' : i + 1}</span>
                      <div>
                        <strong>{label}</strong>
                        <small>
                          {i < current
                            ? 'Đã qua bước'
                            : i === current
                              ? 'Bước hiện tại'
                              : 'Chưa đến bước'}
                        </small>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="workspace-lead">
              {nextSteps[detail.status] ??
                'Kiểm tra trạng thái hồ sơ trước khi thực hiện thao tác.'}
            </p>
            <div className="form-grid workspace-facts">
              <div>
                <strong>Hình thức</strong>
                <p>{modes[detail.snapshot.mode] ?? 'Cần kiểm tra'}</p>
              </div>
              <div>
                <strong>Nhóm đối tượng đã kê khai</strong>
                <p>Nhóm {detail.snapshot.subjectGroup} theo bản khai; cần kiểm tra căn cứ</p>
              </div>
              <div>
                <strong>Đợt tiếp nhận</strong>
                <p>{detail.round_name}</p>
              </div>
              <div>
                <strong>Người thẩm định được giao</strong>
                <p>
                  {assignedToMe
                    ? 'Bạn đang được giao'
                    : detail.assigned_reviewer
                      ? 'Đã phân công'
                      : 'Chưa phân công'}
                </p>
                {detail.assigned_reviewer && (
                  <details>
                    <summary>Mã tài khoản</summary>
                    <small className="workspace-code">{detail.assigned_reviewer}</small>
                  </details>
                )}
              </div>
            </div>
            {detail.decision_reason && (
              <div className="status-panel">
                <h3>
                  {detail.status === 'supplement'
                    ? 'Yêu cầu khách bổ sung'
                    : 'Nội dung thông báo kết quả'}
                </h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{detail.decision_reason}</p>
              </div>
            )}
            <details className="workspace-disclosure">
              <summary>Bản khai tại thời điểm nộp</summary>
              <div className="form-grid">
                {[
                  ['Họ và tên', 'fullName'],
                  ['Ngày sinh', 'dateOfBirth'],
                  ['Địa chỉ', 'address'],
                  ['Nghề nghiệp', 'occupation'],
                ].map(([label, key]) => (
                  <div key={key}>
                    <strong>{label}</strong>
                    <p>
                      {key === 'dateOfBirth'
                        ? birthDate(declaration[key])
                        : safe(declaration[key!])}
                    </p>
                  </div>
                ))}
                <div>
                  <strong>Tình trạng nhà ở đã khai</strong>
                  <p>{housing[String(declaration.housingSituation)] ?? 'Chưa khai'}</p>
                </div>
                <div>
                  <strong>Phiên bản bản khai</strong>
                  <p>{detail.snapshot.inputVersion}</p>
                </div>
              </div>
              <h3>Thành viên hộ gia đình trong bản khai ({household.length})</h3>
              {household.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Họ tên</th>
                        <th scope="col">Ngày sinh</th>
                        <th scope="col">Quan hệ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {household.map((value, i) => {
                        const m =
                          value && typeof value === 'object'
                            ? (value as Record<string, unknown>)
                            : {};
                        return (
                          <tr key={i}>
                            <td>{safe(m.fullName)}</td>
                            <td>{birthDate(m.dateOfBirth)}</td>
                            <td>{relationship[String(m.relationship)] ?? 'Chưa khai'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>Không kê khai thành viên bổ sung.</p>
              )}
              <p style={{ overflowWrap: 'anywhere' }}>
                <small>SHA-256 bản nộp: {detail.snapshot_hash}</small>
              </p>
            </details>
            <details className="workspace-disclosure" open>
              <summary>
                Chứng cứ trong hồ sơ ({docs.size} giấy tờ, {forms.size} biểu mẫu)
              </summary>
              {docs.size > 0 ? (
                <Evidence application={detail.id} kind="documents" items={[...docs.values()]} />
              ) : (
                <p>Không có giấy tờ trong bản ghi này.</p>
              )}
              {forms.size > 0 && (
                <Evidence application={detail.id} kind="forms" items={[...forms.values()]} />
              )}
              <p>
                Các lượt xem và tải được ghi vào nhật ký truy cập. Tệp chỉ dùng trong phạm vi hồ sơ
                được cấp quyền.
              </p>
            </details>
            {supplements.length > 0 && (
              <details className="workspace-disclosure">
                <summary>Các lần bổ sung ({supplements.length})</summary>
                {supplements.map((s, i) => (
                  <article className="member-card" key={s.id}>
                    <h3>
                      Lần {i + 1} · {date(s.created_at)}
                    </h3>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{s.message}</p>
                    <small>
                      {s.documentIds.length} giấy tờ · {s.formIds.length} biểu mẫu
                    </small>
                  </article>
                ))}
              </details>
            )}
            {detail.reviews.length > 0 && (
              <details className="workspace-disclosure">
                <summary>Lịch sử đề xuất thẩm định ({detail.reviews.length})</summary>
                {detail.reviews.map((r) => (
                  <article className="member-card" key={r.id}>
                    <h3>{r.eligible ? 'Đề xuất đủ điều kiện' : 'Đề xuất không đủ điều kiện'}</h3>
                    <p>
                      {r.reviewer} · {date(r.created_at)}
                    </p>
                    <p>Mã lý do: {r.reasonCode}</p>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{r.reason}</p>
                    <ul>
                      {r.evidenceRefs.map((ref, i) => (
                        <li key={i}>{ref}</li>
                      ))}
                    </ul>
                    {r.id === detail.recommendation_id && (
                      <span className="status-badge">Đề xuất hiện hành</span>
                    )}
                  </article>
                ))}
              </details>
            )}
            {has('intake_officer') &&
              ['submitted', 'under_review', 'recommended'].includes(detail.status) && (
                <form
                  key={'assign:' + detail.id + ':' + detail.version}
                  className="member-card stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void run(() =>
                      call(
                        '/' + detail.id + '/assign',
                        { reviewerSubject: f.get('reviewer') },
                        detail.version,
                      ),
                    );
                  }}
                >
                  <h3>Phân công thẩm định</h3>
                  <p>
                    Phân công lại làm mất hiệu lực đề xuất hiện hành và đưa hồ sơ về bước thẩm định.
                    Người nhận phải được cấp quyền thẩm định tại đúng dự án.
                  </p>
                  <label>
                    Mã tài khoản nhân sự được giao
                    <input
                      name="reviewer"
                      className="search-input"
                      defaultValue={detail.assigned_reviewer ?? ''}
                      maxLength={200}
                      required
                    />
                  </label>
                  <Button disabled={busy}>Ghi phân công</Button>
                </form>
              )}
            {has('reviewer') && assignedToMe && detail.status === 'under_review' && (
              <>
                <details className="workspace-disclosure">
                  <summary>Yêu cầu khách bổ sung hồ sơ</summary>
                  <div className="workspace-disclosure-body">
                    <form
                      key={'supplement:' + detail.id + ':' + detail.version}
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(() =>
                          call(
                            '/' + detail.id + '/supplement-request',
                            { message: f.get('message') },
                            detail.version,
                          ),
                        );
                      }}
                    >
                      <h3>Yêu cầu bổ sung</h3>
                      <label>
                        Nêu rõ giấy tờ, nội dung và hướng dẫn bổ sung
                        <textarea
                          name="message"
                          className="search-input"
                          rows={4}
                          required
                          maxLength={2000}
                        />
                      </label>
                      <Button variant="outline" disabled={busy}>
                        Gửi yêu cầu vào bảng điều khiển khách
                      </Button>
                    </form>
                  </div>
                </details>
                <details className="workspace-disclosure">
                  <summary>Lập đề xuất kết quả thẩm định</summary>
                  <div className="workspace-disclosure-body">
                    <form
                      key={'recommend:' + detail.id + ':' + detail.version}
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void run(async () => {
                          const b = RecommendationSchema.safeParse({
                            eligible: f.get('eligible') === 'yes',
                            reasonCode: f.get('code'),
                            reason: f.get('reason'),
                            evidenceRefs: String(f.get('evidence'))
                              .split(/\r?\n/)
                              .map((s) => s.trim())
                              .filter(Boolean),
                            accepted: f.get('accepted') === 'on',
                          });
                          if (!b.success)
                            throw new Error(
                              'Kiểm tra kết luận, mã lý do, căn cứ chứng cứ và ô xác nhận',
                            );
                          return call('/' + detail.id + '/recommend', b.data, detail.version);
                        });
                      }}
                    >
                      <h3>Đề xuất kết quả thẩm định</h3>
                      <div className="form-grid">
                        <label>
                          Kết luận từ việc kiểm tra chứng cứ
                          <select name="eligible" className="search-input" required>
                            <option value="">Chọn kết luận</option>
                            <option value="yes">Đề xuất đủ điều kiện</option>
                            <option value="no">Đề xuất không đủ điều kiện</option>
                          </select>
                        </label>
                        <label>
                          Mã lý do nghiệp vụ
                          <input
                            name="code"
                            className="search-input"
                            pattern="[A-Z0-9_-]{3,60}"
                            required
                            placeholder="Mã theo quy chế đã duyệt"
                          />
                        </label>
                      </div>
                      <label>
                        Giải thích và căn cứ pháp lý áp dụng
                        <textarea
                          name="reason"
                          className="search-input"
                          rows={4}
                          minLength={10}
                          maxLength={4000}
                          required
                        />
                      </label>
                      <label>
                        Tham chiếu chứng cứ / điều khoản, mỗi dòng một mục
                        <textarea name="evidence" className="search-input" rows={4} required />
                      </label>
                      <label className="checkbox-label">
                        <input name="accepted" type="checkbox" required />
                        Tôi đã kiểm tra bản nộp, bổ sung, điều kiện và quy chế đúng phạm vi. Đây là
                        đề xuất của người thẩm định.
                      </label>
                      <Button disabled={busy}>Chuyển người có quyền phê duyệt</Button>
                    </form>
                  </div>
                </details>
              </>
            )}
            {has('approver') && detail.status === 'recommended' && currentReview && (
              <details className="workspace-disclosure">
                <summary>Kiểm tra và ghi quyết định phê duyệt</summary>
                <div className="workspace-disclosure-body">
                  <form
                    key={'decision:' + detail.id + ':' + detail.version}
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void run(async () => {
                        const b = ApplicationDecisionSchema.safeParse({
                          recommendationId: currentReview.id,
                          accepted: f.get('accepted') === 'on',
                          decisionReference: f.get('reference'),
                          publicReason: f.get('reason'),
                        });
                        if (!b.success)
                          throw new Error(
                            'Cần căn cứ quyết định, nội dung gửi khách và xác nhận độc lập',
                          );
                        return call('/' + detail.id + '/decide', b.data, detail.version);
                      });
                    }}
                  >
                    <h3>
                      {currentReview.eligible
                        ? 'Phê duyệt theo đề xuất đủ điều kiện'
                        : 'Phê duyệt kết quả không đủ điều kiện'}
                    </h3>
                    <p>
                      Kiểm tra đề xuất và chứng cứ trước khi quyết định. Kết quả theo kết luận đề
                      xuất hiện hành; cần thay đề xuất thì giao thẩm định lại. Người đề xuất không
                      được tự phê duyệt.
                    </p>
                    {currentReview.reviewer === staff?.subject && (
                      <p className="feedback error">
                        Bạn là người lập đề xuất này. Cần người có quyền phê duyệt khác.
                      </p>
                    )}
                    <label>
                      Căn cứ / số văn bản quyết định
                      <input
                        name="reference"
                        className="search-input"
                        minLength={5}
                        maxLength={300}
                        required
                      />
                    </label>
                    <label>
                      Nội dung kết quả thông báo cho khách
                      <textarea
                        name="reason"
                        className="search-input"
                        rows={4}
                        minLength={10}
                        maxLength={3000}
                        required
                      />
                    </label>
                    <label className="checkbox-label">
                      <input name="accepted" type="checkbox" required />
                      Tôi đã kiểm tra độc lập và có thẩm quyền quyết định.
                    </label>
                    <Button disabled={busy || currentReview.reviewer === staff?.subject}>
                      Ghi quyết định và thông báo trong hệ thống
                    </Button>
                  </form>
                </div>
              </details>
            )}
            {has('approver') && detail.status === 'rejected' && (
              <details className="workspace-disclosure">
                <summary>Xem xét lại quyết định từ chối</summary>
                <div className="workspace-disclosure-body">
                  <details className="workspace-disclosure">
                    <summary>Mở thẩm định lại hồ sơ đã từ chối</summary>
                    <div className="workspace-disclosure-body">
                      <form
                        className="stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void run(() =>
                            call(
                              '/' + detail.id + '/reopen',
                              { accepted: true, reason: f.get('reason') },
                              detail.version,
                            ),
                          );
                        }}
                      >
                        <h3>Mở thẩm định lại</h3>
                        <p>
                          Giữ nguyên quyết định cũ và lịch sử chứng cứ; kiểm tra không có đăng ký
                          đồng thời trước khi mở lại.
                        </p>
                        <label>
                          Lý do, căn cứ xem xét lại
                          <textarea
                            name="reason"
                            className="search-input"
                            required
                            maxLength={2000}
                          />
                        </label>
                        <label className="checkbox-label">
                          <input type="checkbox" required />
                          Tôi xác nhận cần mở thẩm định lại.
                        </label>
                        <Button variant="outline" disabled={busy}>
                          Mở thẩm định lại, giữ lịch sử
                        </Button>
                      </form>
                    </div>
                  </details>
                </div>
              </details>
            )}
            <details
              className="workspace-disclosure"
              open={detail.appeals.some((a) => a.status === 'open')}
            >
              <summary>Đề nghị xem xét lại của khách ({detail.appeals.length})</summary>
              {detail.appeals.length ? (
                detail.appeals.map((a) => (
                  <article className="member-card stack" key={a.id}>
                    <h3>
                      {a.status === 'open' ? 'Chờ phản hồi' : 'Đã phản hồi'} · {date(a.created_at)}
                    </h3>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{a.message}</p>
                    {a.reply && (
                      <div className="status-panel">
                        <strong>Phản hồi</strong>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{a.reply}</p>
                      </div>
                    )}
                    {a.status === 'open' && has('approver') && (
                      <form
                        className="stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void run(() =>
                            call(
                              '/' + detail.id + '/appeals/' + a.id + '/respond',
                              { reply: f.get('reply') },
                              a.version,
                            ),
                          );
                        }}
                      >
                        <label>
                          Phản hồi có căn cứ, hướng xử lý tiếp theo
                          <textarea
                            name="reply"
                            className="search-input"
                            rows={4}
                            required
                            maxLength={3000}
                          />
                        </label>
                        <p>
                          Người trả lời phải khác người đã ra quyết định. Phản hồi không tự thay đổi
                          kết quả; mở thẩm định lại theo đúng bước nếu cần.
                        </p>
                        <Button disabled={busy}>Gửi phản hồi cho khách</Button>
                      </form>
                    )}
                  </article>
                ))
              ) : (
                <p>Chưa có đề nghị xem xét lại.</p>
              )}
            </details>
            {!staff && (
              <p className="section-subtitle">
                Thông tin quyền nhân sự chưa được tải. Các thao tác quyết định được ẩn đến khi phiên
                nhân sự được xác minh.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
