'use client';
import { useEffect, useState } from 'react';
import { Button } from '@noxh/ui';
import {
  calculatePriority,
  priorityGroups,
  type LotteryRow,
  type PriorityInput,
  type LotteryCohort,
  type LotteryCohortSource,
} from '@noxh/contracts';
const statuses: Record<string, string> = {
  draft: 'Chờ duyệt quy chế',
  reviewed: 'Quy chế đã duyệt',
  frozen: 'Đã khóa & công bố cam kết',
  seeded: 'Đã ghi nguồn ngẫu nhiên',
  drawn: 'Đã chạy — chờ kiểm tra',
  certified: 'Đã kiểm tra diễn tập',
  published: 'Đã công bố',
  voided: 'Đã hủy, giữ bằng chứng',
};
const kindLabels: Record<string, string> = {
  selection: 'Chọn trong nhóm chung',
  'priority-overflow': 'Chọn trong nhóm ưu tiên',
  allocation: 'Phân căn hộ',
};
const drawSteps = [
  ['draft', 'Lập phiên'],
  ['reviewed', 'Duyệt quy chế'],
  ['frozen', 'Công bố cam kết'],
  ['seeded', 'Ghi nguồn ngẫu nhiên'],
  ['drawn', 'Thực hiện'],
  ['certified', 'Kiểm tra kết quả'],
  ['published', 'Công bố kết quả'],
] as const;
async function call(path = '', body?: unknown, version?: number) {
  const r = await fetch('/api/admin/lotteries' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail);
  return b;
}
export default function LotteryAdmin({
  projects,
  transparencyOrigin,
}: {
  projects: { id: string; name: string }[];
  transparencyOrigin: string;
}) {
  const [items, setItems] = useState<LotteryRow[]>([]),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [workspaceTab, setWorkspaceTab] = useState('sessions'),
    [selected, setSelected] = useState(''),
    [cohorts, setCohorts] = useState<LotteryCohort[]>([]),
    [rounds, setRounds] = useState<
      { id: string; project_id: string; name: string; status: string; closes_at: string }[]
    >([]),
    [source, setSource] = useState<LotteryCohortSource>(),
    [excluded, setExcluded] = useState<string[]>([]),
    [cohortSelection, setCohortSelection] = useState(''),
    [preview, setPreview] = useState<ReturnType<typeof calculatePriority>>();
  const refresh = async () => {
    const b = await call();
    const rows = b.items as LotteryRow[];
    setItems(rows);
    setSelected((current) =>
      rows.some((r) => r.id === current)
        ? current
        : (rows.find((r) => r.status === 'published')?.id ?? rows[0]?.id ?? ''),
    );
    setCohorts(b.cohorts ?? []);
    setRounds(b.rounds ?? []);
  };
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await refresh();
      setMessage('Đã ghi nhận thao tác và nhật ký.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const current = items.find((x) => x.id === selected);
  const cohort = cohorts.find((c) => c.id === cohortSelection);
  return (
    <div className="stack investor-workspace">
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

      <div className="iw-page-heading">
        <div>
          <p className="iw-kicker">Lựa chọn và phân căn</p>
          <h2>Quản lý bốc thăm trực tuyến</h2>
          <p>Theo dõi phiên, danh sách đã rà soát và bằng chứng công bố tại một nơi.</p>
        </div>
        <Button onClick={() => setWorkspaceTab('configure')}>Lập phiên mới</Button>
      </div>
      <div className="iw-stats iw-stats-panel">
        <div>
          <span>Phiên đã công bố</span>
          <strong>{items.filter((r) => r.status === 'published').length}</strong>
        </div>
        <div>
          <span>Phiên đang thực hiện</span>
          <strong>{items.filter((r) => !['published', 'voided'].includes(r.status)).length}</strong>
        </div>
        <div>
          <span>Nhóm chờ giám sát</span>
          <strong>{cohorts.filter((c) => c.status === 'draft').length}</strong>
        </div>
      </div>
      <nav className="iw-tabs" aria-label="Nghiệp vụ bốc thăm">
        {[
          ['sessions', 'Phiên bốc thăm'],
          ['cohorts', 'Danh sách và nhóm'],
          ['configure', 'Lập phiên'],
          ['priority', 'Tính suất ưu tiên'],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={workspaceTab === key ? 'default' : 'outline'}
            aria-pressed={workspaceTab === key}
            disabled={busy}
            onClick={() => setWorkspaceTab(key ?? 'sessions')}
          >
            {label}
          </Button>
        ))}
      </nav>

      <details className="iw-context-note">
        <summary>Điều kiện vận hành và chế độ diễn tập</summary>
        <div>
          <strong>Chế độ diễn tập — chưa bốc thăm pháp lý thật.</strong> Quy chế, căn cứ địa phương,
          danh sách đủ điều kiện, ưu tiên, đại diện giám sát và biên bản phải được kiểm tra độc lập
          trước khi vận hành thật. AI không xác định đối tượng hay xác suất.
        </div>
      </details>
      {workspaceTab === 'sessions' && (
        <>
          {' '}
          <section className="surface">
            <div className="surface-head">
              <div>
                <h2>Danh sách phiên</h2>
                <p className="iw-muted">Chọn phiên để xem tiến độ và thực hiện bước tiếp theo.</p>
              </div>
              <span className="tag">{items.length} phiên</span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Phiên bốc thăm</th>
                    <th scope="col">Hồ sơ / suất</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {!items.length && (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty-state">
                          <strong>Chưa có phiên bốc thăm</strong>
                          <p>Rà soát nhóm hồ sơ trước khi lập phiên mới.</p>
                          <Button variant="outline" onClick={() => setWorkspaceTab('cohorts')}>
                            Mở danh sách và nhóm
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {items.map((r) => (
                    <tr key={r.id} className={selected === r.id ? 'iw-selected-row' : ''}>
                      <td>
                        <strong className="iw-session-name">{r.title}</strong>
                        <small className="iw-muted">
                          {projects.find((p) => p.id === r.project_id)?.name}
                        </small>
                      </td>
                      <td>
                        {r.config.entries.length} / {r.config.seats}
                      </td>
                      <td>
                        <span className="tag" data-status={r.status}>
                          {statuses[r.status] ?? 'Cần kiểm tra'}
                        </span>
                      </td>
                      <td>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={'Xem phiên ' + r.title}
                          onClick={() => setSelected(r.id)}
                        >
                          {selected === r.id ? 'Đang xem' : 'Xem phiên'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="surface">
            <div className="surface-head">
              <h2>Điều khiển phiên bốc thăm</h2>
              <Button variant="outline" disabled={busy} onClick={() => run(refresh)}>
                Tải trạng thái
              </Button>
            </div>
            <div className="surface-body stack">
              <label>
                Chọn phiên
                <select
                  className="search-input"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Chọn phiên</option>
                  {items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {statuses[r.status]}
                    </option>
                  ))}
                </select>
              </label>
              {current && (
                <>
                  <h3>{current.title}</h3>
                  {current.status !== 'voided' && (
                    <ol className="iw-timeline" aria-label="Tiến trình phiên bốc thăm">
                      {drawSteps.map(([key, label], index) => {
                        const active = drawSteps.findIndex(([state]) => state === current.status);
                        return (
                          <li
                            key={key}
                            data-state={
                              index < active ? 'complete' : index === active ? 'current' : 'pending'
                            }
                            aria-current={index === active ? 'step' : undefined}
                          >
                            <span>{index + 1}</span>
                            <strong>{label}</strong>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <div className="metric-grid">
                    <div className="metric">
                      <span>Hồ sơ</span>
                      <strong>{current.config.entries.length}</strong>
                    </div>
                    <div className="metric">
                      <span>Suất</span>
                      <strong>{current.config.seats}</strong>
                    </div>
                    <div className="metric">
                      <span>Giai đoạn</span>
                      <strong style={{ fontSize: 18 }}>{statuses[current.status]}</strong>
                    </div>
                  </div>
                  <details>
                    <summary>Quy chế và danh sách đã khóa</summary>
                    <p>{current.config.rules}</p>
                    <p>{current.config.priorityResolution}</p>
                    <p>{current.config.entries.join(' · ')}</p>
                  </details>
                  {current.commitment && (
                    <>
                      <p>
                        Cam kết:{' '}
                        <code style={{ overflowWrap: 'anywhere' }}>{current.commitment}</code>
                      </p>
                      <a
                        className="button-link"
                        href={transparencyOrigin + '/lotteries/' + current.id}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Mở màn hình công khai ↗
                      </a>
                    </>
                  )}
                  {['draft', 'reviewed', 'frozen', 'seeded', 'drawn', 'certified'].includes(
                    current.status,
                  ) && (
                    <form
                      key={current.id + ':' + current.version}
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          actions: Record<string, string> = {
                            draft: 'review',
                            reviewed: 'freeze',
                            frozen: 'entropy',
                            seeded: 'execute',
                            drawn: 'certify',
                            certified: 'publish',
                          };
                        void run(() =>
                          call(
                            '/' + current.id + '/' + actions[current.status],
                            {
                              accepted: true,
                              ...(current.status === 'frozen'
                                ? { entropy: f.get('entropy'), record: f.get('record') }
                                : {}),
                              ...(current.status === 'drawn'
                                ? { minutesHash: f.get('minutes') }
                                : {}),
                            },
                            current.version,
                          ),
                        );
                      }}
                    >
                      {current.status === 'frozen' && (
                        <>
                          <label>
                            Ngẫu nhiên 32 byte hex của diễn tập
                            <input
                              name="entropy"
                              className="search-input"
                              pattern="[a-f0-9]{64}"
                              required
                            />
                          </label>
                          <label>
                            Biên nhận nguồn, thời điểm, người chứng kiến
                            <textarea
                              name="record"
                              className="search-input"
                              required
                              maxLength={1000}
                            />
                          </label>
                        </>
                      )}
                      {current.status === 'drawn' && (
                        <label>
                          SHA-256 biên bản diễn tập đã kiểm tra
                          <input
                            name="minutes"
                            className="search-input"
                            pattern="[a-f0-9]{64}"
                            required
                          />
                        </label>
                      )}
                      <label className="checkbox-label">
                        <input required type="checkbox" />
                        Tôi đã kiểm tra bước hiện tại và có đúng vai trò được cấp. Đây là diễn tập.
                      </label>
                      <Button disabled={busy}>
                        {
                          (
                            {
                              draft: 'Giám sát duyệt quy chế và danh sách',
                              reviewed: 'Khóa danh sách và công bố cam kết',
                              frozen: 'Giám sát ghi nguồn ngẫu nhiên',
                              seeded: 'Chạy thuật toán một lần',
                              drawn: 'Giám sát kiểm tra và xác nhận diễn tập',
                              certified: 'Công bố kết quả diễn tập',
                            } as Record<string, string>
                          )[current.status]
                        }
                      </Button>
                    </form>
                  )}
                  {current.status !== 'voided' && (
                    <details>
                      <summary>Hủy phiên, giữ nguyên bằng chứng</summary>
                      <form
                        className="stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void run(() =>
                            call(
                              '/' + current.id + '/void',
                              { accepted: true, reason: f.get('reason') },
                              current.version,
                            ),
                          );
                        }}
                      >
                        <label>
                          Lý do hủy
                          <textarea
                            name="reason"
                            className="search-input"
                            required
                            minLength={10}
                            maxLength={1000}
                          />
                        </label>
                        <label className="checkbox-label">
                          <input required type="checkbox" />
                          Tôi là giám sát, xác nhận hủy và công khai lý do nếu đã công bố cam kết.
                        </label>
                        <Button variant="outline" disabled={busy}>
                          Hủy phiên
                        </Button>
                      </form>
                    </details>
                  )}
                  {current.result && (
                    <section className="iw-results">
                      <div className="iw-results-heading">
                        <h3>Kết quả và thứ tự hồ sơ</h3>
                        <span className="tag">
                          {current.result.ranking.filter((r) => r.selected).length} hồ sơ được chọn
                        </span>
                      </div>
                      <div className="table-scroll iw-result-table">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th scope="col">Thứ tự</th>
                              <th scope="col">Mã hồ sơ</th>
                              <th scope="col">Kết quả diễn tập</th>
                              {current.config.kind === 'allocation' && <th scope="col">Căn hộ</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {current.result.ranking.map((r) => (
                              <tr key={r.code}>
                                <td>{r.rank}</td>
                                <td>
                                  <strong>{r.code}</strong>
                                </td>
                                <td>
                                  <span
                                    className="tag"
                                    data-status={r.selected ? 'published' : 'draft'}
                                  >
                                    {r.selected ? 'Được chọn' : 'Chưa được chọn'}
                                  </span>
                                </td>
                                {current.config.kind === 'allocation' && <td>{r.unit ?? '—'}</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      )}
      {workspaceTab === 'cohorts' && (
        <>
          <section className="surface">
            <div className="surface-head">
              <h2>Rà soát nhóm và các trường hợp không bốc thăm</h2>
            </div>
            <div className="surface-body stack">
              {!cohorts.length && (
                <p>
                  Chưa có nhóm nguồn. Cần chốt danh sách và giám sát khác người tạo trước khi lập
                  phiên.
                </p>
              )}
              {cohorts.map((c) => (
                <details className="iw-cohort-row" key={c.id}>
                  <summary className="iw-cohort-summary">
                    <h3>
                      {c.roundName} ·{' '}
                      {c.mode === 'buy' ? 'Mua' : c.mode === 'rent-buy' ? 'Thuê mua' : 'Thuê'} ·{' '}
                      {kindLabels[c.kind]}
                    </h3>
                    <p>
                      {c.entries.length} hồ sơ / {c.seats} suất ·{' '}
                      {c.status === 'reviewed'
                        ? 'Đã giám sát duyệt'
                        : c.status === 'draft'
                          ? 'Chờ giám sát'
                          : c.status === 'voided'
                            ? 'Đã hủy'
                            : 'Đã được thay thế'}
                      {c.attemptId ? ' · Đã dùng một lượt bốc thăm' : ''}
                    </p>
                  </summary>
                  <div className="iw-cohort-body stack">
                    <p>{c.description}</p>
                    <p>
                      <strong>Căn cứ:</strong> {c.legalBasis}
                    </p>
                    <details>
                      <summary>
                        Đối chiếu toàn bộ nguồn, mã tham gia và mã được loại có căn cứ
                      </summary>
                      <p style={{ overflowWrap: 'anywhere' }}>
                        Nhóm: <code>{c.hash}</code>
                        <br />
                        Nguồn đầy đủ: <code>{c.sourceHash}</code>
                      </p>
                      <p>
                        <strong>Mã tham gia:</strong> {c.entries.join(' · ')}
                      </p>
                      {c.sourceSnapshot?.map(([code, version, hash]) => (
                        <p key={code} style={{ overflowWrap: 'anywhere' }}>
                          {code} · v{version} · <code>{hash}</code>
                        </p>
                      ))}
                      {c.exclusions.map((ex) => (
                        <div className="feedback" key={ex.code}>
                          <strong>
                            {ex.code} ·{' '}
                            {ex.category === 'priority-exempt'
                              ? 'Ưu tiên không bốc thăm'
                              : 'Nhóm riêng'}
                          </strong>
                          <p>{ex.reason}</p>
                          <code style={{ overflowWrap: 'anywhere' }}>{ex.evidenceHash}</code>
                        </div>
                      ))}
                      {c.supersedesId && (
                        <p>
                          Thay thế nhóm {c.supersedesId}: {c.replacementReason}
                        </p>
                      )}
                    </details>
                    {c.status === 'draft' && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void run(() =>
                            call('/cohorts/' + c.id + '/review', { accepted: true }, c.version),
                          );
                        }}
                      >
                        <label className="checkbox-label">
                          <input type="checkbox" required />
                          Tôi là giám sát khác người tạo, đã kiểm tra toàn bộ nguồn và từng trường
                          hợp loại; phần mềm không tự xác định ưu tiên pháp lý.
                        </label>
                        <Button variant="outline" disabled={busy}>
                          Duyệt nhóm nguồn
                        </Button>
                      </form>
                    )}
                    {['draft', 'reviewed'].includes(c.status) && (
                      <details>
                        <summary>Hủy nhóm nguồn và giữ bằng chứng</summary>
                        <form
                          className="stack"
                          onSubmit={(e) => {
                            e.preventDefault();
                            const f = new FormData(e.currentTarget);
                            void run(() =>
                              call(
                                '/cohorts/' + c.id + '/void',
                                { accepted: true, reason: f.get('reason') },
                                c.version,
                              ),
                            );
                          }}
                        >
                          <label>
                            Lý do hủy nhóm
                            <textarea
                              name="reason"
                              className="search-input"
                              minLength={20}
                              maxLength={2000}
                              required
                            />
                          </label>
                          <label className="checkbox-label">
                            <input type="checkbox" required />
                            Nếu đã có phiên bốc thăm, phiên phải được hủy trước. Mọi phiên bản và
                            kết quả vẫn được giữ.
                          </label>
                          <Button variant="outline" disabled={busy}>
                            Giám sát hủy nhóm nguồn
                          </Button>
                        </form>
                      </details>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </section>
          <details className="surface iw-disclosure">
            <summary className="iw-disclosure-heading">
              <h2>Chốt phạm vi từ toàn bộ hồ sơ đã phê duyệt</h2>
            </summary>
            <form
              className="surface-body stack"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                if (!source || source.roundId !== f.get('round') || source.mode !== f.get('mode')) {
                  setError('Hãy tải đúng nguồn đợt và hình thức trước khi lập nhóm.');
                  return;
                }
                void run(() =>
                  call('/cohorts', {
                    roundId: source.roundId,
                    mode: source.mode,
                    kind: f.get('kind'),
                    seats: Number(f.get('seats')),
                    description: f.get('description'),
                    legalBasis: f.get('legalBasis'),
                    exclusions: excluded.map((code) => ({
                      code,
                      category: f.get('category:' + code),
                      reason: f.get('reason:' + code),
                      evidenceHash: f.get('evidence:' + code),
                    })),
                    supersedesId: f.get('supersedes') || null,
                    replacementReason: f.get('replacementReason') || '',
                  }),
                );
              }}
            >
              <p>
                Chỉ lập danh sách sau khi đợt đã đóng, hết lịch và mọi hồ sơ cùng hình thức đã có
                quyết định cuối cùng. Hệ thống lấy toàn bộ mã đủ điều kiện; mỗi mã bỏ ra phải có lý
                do, loại xử lý và chứng cứ để người khác duyệt. Không tự nhập một danh sách nhỏ hơn.
              </p>
              <div className="form-grid">
                <label>
                  Đợt tiếp nhận
                  <select
                    name="round"
                    className="search-input"
                    required
                    onChange={() => {
                      setSource(undefined);
                      setExcluded([]);
                    }}
                  >
                    <option value="">Chọn đợt</option>
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {projects.find((p) => p.id === r.project_id)?.name} · {r.name} ·{' '}
                        {r.status === 'closed' ? 'Đã đóng' : 'Chưa đóng'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hình thức
                  <select
                    name="mode"
                    className="search-input"
                    onChange={() => {
                      setSource(undefined);
                      setExcluded([]);
                    }}
                  >
                    <option value="buy">Mua</option>
                    <option value="rent-buy">Thuê mua</option>
                    <option value="rent">Thuê</option>
                  </select>
                </label>
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  if (!form) return;
                  const f = new FormData(form);
                  void run(async () => {
                    setSource(await call('/cohort-source/' + f.get('round') + '/' + f.get('mode')));
                    setExcluded([]);
                  });
                }}
              >
                Tải đầy đủ mã từ quyết định hồ sơ
              </Button>
              {source && (
                <>
                  <div className="metric-grid">
                    <div className="metric">
                      <span>Toàn bộ được phê duyệt</span>
                      <strong>{source.entries.length}</strong>
                    </div>
                    <div className="metric">
                      <span>Đề nghị loại có căn cứ</span>
                      <strong>{excluded.length}</strong>
                    </div>
                    <div className="metric">
                      <span>Tham gia nhóm</span>
                      <strong>{source.entries.length - excluded.length}</strong>
                    </div>
                  </div>
                  <p style={{ overflowWrap: 'anywhere' }}>
                    Dấu vân tay nguồn: <code>{source.hash}</code>
                  </p>
                  <details>
                    <summary>Rà soát từng mã và xử lý ưu tiên / nhóm riêng</summary>
                    <div className="stack">
                      {source.entries.map((entry) => (
                        <article className="status-panel stack" key={entry.code}>
                          <p>
                            <strong>{entry.code}</strong> · Phiên bản quyết định {entry.version}
                          </p>
                          <code style={{ overflowWrap: 'anywhere' }}>{entry.snapshotHash}</code>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={excluded.includes(entry.code)}
                              onChange={(e) =>
                                setExcluded(
                                  e.target.checked
                                    ? [...excluded, entry.code]
                                    : excluded.filter((c) => c !== entry.code),
                                )
                              }
                            />
                            Đề nghị không tham gia nhóm này — bắt buộc căn cứ, không xóa khỏi nguồn
                          </label>
                          {excluded.includes(entry.code) && (
                            <div className="form-grid">
                              <label>
                                Loại xử lý
                                <select name={'category:' + entry.code} className="search-input">
                                  <option value="separate-group">
                                    Thuộc nhóm riêng đã rà soát
                                  </option>
                                  <option value="priority-exempt">
                                    Ưu tiên không bốc thăm theo căn cứ đã rà soát
                                  </option>
                                </select>
                              </label>
                              <label>
                                Lý do cụ thể và căn cứ áp dụng
                                <textarea
                                  name={'reason:' + entry.code}
                                  className="search-input"
                                  minLength={20}
                                  maxLength={1000}
                                  required
                                />
                              </label>
                              <label>
                                SHA-256 chứng cứ rà soát
                                <input
                                  name={'evidence:' + entry.code}
                                  className="search-input"
                                  pattern="[a-f0-9]{64}"
                                  required
                                />
                              </label>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  </details>
                </>
              )}
              <div className="form-grid">
                <label>
                  Mục đích nhóm
                  <select name="kind" className="search-input">
                    <option value="selection">Chọn trong nhóm chung sau ưu tiên</option>
                    <option value="priority-overflow">Một nhóm ưu tiên vượt suất</option>
                    <option value="allocation">Gán căn cho người đã được chọn</option>
                  </select>
                </label>
                <label>
                  Số suất / số người gán căn
                  <input
                    name="seats"
                    type="number"
                    min={1}
                    max={500}
                    className="search-input"
                    required
                  />
                </label>
                <label>
                  Mô tả phạm vi, xử lý nhóm và đối tượng
                  <textarea
                    name="description"
                    className="search-input"
                    required
                    minLength={30}
                    maxLength={2000}
                  />
                </label>
                <label>
                  Căn cứ pháp lý / quy chế áp dụng
                  <textarea
                    name="legalBasis"
                    className="search-input"
                    required
                    minLength={10}
                    maxLength={2000}
                  />
                </label>
                <label>
                  Thay thế nhóm đã hủy (nếu có)
                  <select name="supersedes" className="search-input">
                    <option value="">Nhóm mới chưa từng có lượt thử</option>
                    {cohorts
                      .filter((c) => c.status === 'voided' || c.attemptStatus === 'voided')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.roundName} · {kindLabels[c.kind]} · {c.id.slice(0, 8)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Lý do thay thế — ít nhất 20 ký tự khi chọn nhóm cũ
                  <textarea name="replacementReason" className="search-input" maxLength={2000} />
                </label>
              </div>
              <p>
                Lý do loại là thông tin nghiệp vụ riêng; màn hình công khai chỉ nhận mã tham gia và
                mã băm. Không nhập CCCD, số điện thoại, thông tin sức khỏe hoặc họ tên trong trường
                công khai.
              </p>
              <Button disabled={busy || !source}>Lưu nhóm chờ giám sát rà soát</Button>
            </form>
          </details>
        </>
      )}
      {workspaceTab === 'configure' && (
        <section className="surface">
          <div className="surface-head">
            <h2>Lập phiên từ nhóm đã được duyệt</h2>
          </div>
          <form
            className="surface-body stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!cohort) return;
              const f = new FormData(e.currentTarget);
              void run(async () => {
                const b = await call('', {
                  cohortId: cohort.id,
                  projectId: cohort.projectId,
                  title: f.get('title'),
                  kind: cohort.kind,
                  seats: cohort.seats,
                  entries: cohort.entries,
                  units: String(f.get('units') || '')
                    .split(/\r?\n/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                  rules: f.get('rules'),
                  legalBasis: cohort.legalBasis.slice(0, 1000),
                  priorityResolution: cohort.description,
                  eligibilityEvidenceHash: cohort.hash,
                  scheduledAt: new Date(String(f.get('scheduled'))).toISOString(),
                  entropySource: f.get('source'),
                  synthetic: true,
                });
                setSelected(b.id);
                setWorkspaceTab('sessions');
              });
            }}
          >
            <label>
              Nhóm đã duyệt chưa dùng lượt
              <select
                className="search-input"
                required
                value={cohortSelection}
                onChange={(e) => setCohortSelection(e.target.value)}
              >
                <option value="">Chọn nhóm đã duyệt</option>
                {cohorts
                  .filter((c) => c.status === 'reviewed' && !c.attemptId)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.roundName} · {kindLabels[c.kind]} · {c.entries.length} hồ sơ / {c.seats}{' '}
                      suất
                    </option>
                  ))}
              </select>
            </label>
            {cohort && (
              <>
                <div className="feedback">
                  Mã, số suất, dự án và hình thức lấy nguyên từ nhóm đã duyệt. Mỗi nhóm chỉ có một
                  lượt; thay thế phải hủy rõ ràng và có nhóm kế tiếp được người khác rà soát.
                </div>
                <p>{cohort.entries.join(' · ')}</p>
                <div className="form-grid">
                  <label>
                    Tên phiên
                    <input
                      name="title"
                      className="search-input"
                      required
                      minLength={5}
                      maxLength={150}
                    />
                  </label>
                  {cohort.kind === 'allocation' && (
                    <label>
                      Mã căn — mỗi dòng một mã, đủ {cohort.entries.length} căn
                      <textarea name="units" className="search-input" required rows={5} />
                    </label>
                  )}
                  <label>
                    Quy chế, vắng mặt, công bố và đề nghị xem xét lại
                    <textarea
                      name="rules"
                      className="search-input"
                      minLength={30}
                      maxLength={4000}
                      required
                    />
                  </label>
                  <label>
                    Lịch lấy ngẫu nhiên sau công bố cam kết
                    <input
                      name="scheduled"
                      type="datetime-local"
                      className="search-input"
                      required
                    />
                  </label>
                  <label>
                    Nguồn và mốc lấy ngẫu nhiên định trước
                    <textarea
                      name="source"
                      className="search-input"
                      minLength={10}
                      maxLength={500}
                      required
                    />
                  </label>
                </div>
                <Button disabled={busy}>Lưu phiên chờ giám sát duyệt</Button>
              </>
            )}
          </form>
        </section>
      )}
      {workspaceTab === 'priority' && (
        <section className="surface">
          <div className="surface-head">
            <h2>Tham khảo phép tính ưu tiên 5 nhóm</h2>
            <a
              href="https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/5/24-vbhn-bxd.pdf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Nguồn hợp nhất 18/5/2026 ↗
            </a>
          </div>
          <form
            className="surface-body stack"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              try {
                const f = new FormData(e.currentTarget),
                  b: PriorityInput = {
                    totalEligible: Number(f.get('total')),
                    homes: Number(f.get('homes')),
                    counts: priorityGroups.map((_, i) => Number(f.get('g' + i))),
                    rounding: (f.get('rounding') || null) as PriorityInput['rounding'],
                    roundingBasis: String(f.get('basis')),
                    uniqueVerified: (f.get('unique') === 'on') as true,
                  };
                setPreview(calculatePriority(b));
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Kiểm tra số liệu');
              }
            }}
          >
            <div className="status-panel" role="note">
              <strong>Chờ rà soát pháp lý sau ngày 1/7/2026</strong>
              <p>
                Công cụ chỉ mô phỏng 5 nhóm trong Điều 38 của nguồn hợp nhất ngày 18/5/2026. Luật
                Dân số đã sửa nhóm và thứ tự ưu tiên từ 1/7/2026, có nhóm người từ hai con đẻ trở
                lên. Phép tính này chưa xác minh phù hợp pháp luật hiện hành và chưa bao quát thay
                đổi đó.
              </p>
              <p>
                Không dùng kết quả để tự xác định suất miễn bốc thăm hoặc quyền mua. Phải rà soát
                theo thời điểm, nguồn vốn và loại dự án; không áp chung cho vốn đầu tư công, tài
                chính công đoàn hoặc nhà ở chuyên ngành. Điều kiện ưu tiên nữ giới cần xác minh đúng
                trường hợp, không tính toàn bộ khách nữ.
              </p>
              <a
                href="https://chinhsachonline.chinhphu.vn/dieu-kien-mua-nha-o-xa-hoi-voi-nguoi-co-tu-2-con-tro-len-92439.htm"
                target="_blank"
                rel="noopener noreferrer"
              >
                Giải đáp của Bộ Xây dựng ngày 11/10/2026 ↗
              </a>
            </div>
            <div className="form-grid">
              <label>
                Tổng hồ sơ đủ điều kiện
                <input
                  name="total"
                  type="number"
                  className="search-input"
                  min={1}
                  max={1000000}
                  required
                />
              </label>
              <label>
                Số căn dự kiến bán
                <input
                  name="homes"
                  type="number"
                  className="search-input"
                  min={1}
                  max={1000000}
                  required
                />
              </label>
              {priorityGroups.map((label, i) => (
                <label key={label}>
                  {i + 1}. {label}
                  <input
                    name={'g' + i}
                    type="number"
                    className="search-input"
                    min={0}
                    defaultValue={0}
                    required
                  />
                </label>
              ))}
              <label>
                Quy tắc làm tròn đã được rà soát
                <select name="rounding" className="search-input">
                  <option value="">Chưa chốt — chỉ hiển thị phân số</option>
                  <option value="floor">Làm tròn xuống theo căn cứ được duyệt</option>
                  <option value="ceil">Làm tròn lên theo căn cứ được duyệt</option>
                  <option value="nearest">Số nguyên gần nhất theo căn cứ được duyệt</option>
                </select>
              </label>
              <label>
                Căn cứ xử lý phần lẻ
                <textarea name="basis" className="search-input" maxLength={1000} />
              </label>
            </div>
            <label className="checkbox-label">
              <input name="unique" type="checkbox" required />
              Các hồ sơ đã đủ điều kiện và loại trùng: mỗi hồ sơ chỉ nằm trong nhóm ưu tiên cao
              nhất.
            </label>
            <Button disabled={busy}>Tính tham khảo</Button>
            {preview && (
              <div className="status-panel">
                <strong>{preview.referencePolicy.label} · Chờ rà soát pháp lý</strong>
                <h3>
                  {preview.formula} ={' '}
                  {preview.exact.toLocaleString('vi-VN', { maximumFractionDigits: 6 })} suất
                </h3>
                <p>
                  {preview.requiresSelection
                    ? 'Theo số liệu nhập: số hồ sơ vượt số căn. Chưa kết luận cách lựa chọn hoặc ưu tiên hợp pháp.'
                    : 'Theo số liệu nhập: số hồ sơ không vượt số căn. Phép so sánh này không xác nhận quyền được mua.'}
                </p>
                <p>
                  {preview.quota === null
                    ? 'Kết quả có phần lẻ — chưa chốt suất, cần rà soát căn cứ làm tròn.'
                    : `Suất tính tham khảo: ${preview.quota} · Phần còn lại theo phép tính: ${preview.generalSeats}`}
                </p>
                {preview.groups.map((g) => (
                  <p key={g.name}>
                    <strong>{g.name}</strong>: {g.count} hồ sơ → {g.allocate ?? 'chưa chốt'} suất{' '}
                    {g.requiresDraw
                      ? '· Số hồ sơ vượt phần phân bổ của mô hình 5 nhóm; cần rà soát cách xử lý.'
                      : ''}
                  </p>
                ))}
                <small>{preview.notice}</small>
              </div>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
