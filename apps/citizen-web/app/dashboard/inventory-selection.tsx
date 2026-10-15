'use client';
import { useEffect, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import type { InventoryUnit, PriceQuote } from '@noxh/contracts';
interface State {
  synthetic: true;
  enabled: boolean;
  notice: string;
  version?: number;
  mode?: string;
  code?: string;
  rank?: number;
  nextRank?: number;
  myTurn?: boolean;
  assignedUnit?: string;
  rules?: string;
  units?: (InventoryUnit & { allocated: boolean })[];
  quotes?: PriceQuote[];
  priceTitle?: string;
  priceHash?: string;
  priceBasis?: string;
  allocation?: { id: string; code: string; quote: PriceQuote; allocated_at: string } | null;
}
export default function InventorySelection({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>(),
    [selected, setSelected] = useState(''),
    [accepted, setAccepted] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [retryKey, setRetryKey] = useState<string>();
  async function load() {
    const r = await fetch('/api/workflow/citizen/inventory/' + projectId);
    const b = await r.json();
    if (!r.ok) throw new Error(b.detail ?? 'Chưa tải được bảng căn');
    setState(b);
  }
  useEffect(() => {
    let live = true;
    setState(undefined);
    setSelected('');
    setAccepted(false);
    setRetryKey(undefined);
    setError('');
    fetch('/api/workflow/citizen/inventory/' + projectId)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.detail ?? 'Chưa tải được bảng căn');
        if (live) setState(b);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  const choose = state?.mode === 'published-random' ? state.assignedUnit : selected,
    quote = state?.quotes?.find((q) => q.code === choose),
    money = (v: string) => BigInt(v).toLocaleString('vi-VN') + ' đ';
  return (
    <section className="surface" id="chon-can">
      <div className="surface-head">
        <div>
          <h2 className="section-title">Bảng căn hộ và thứ tự chọn</h2>
          <p className="section-subtitle">Theo dõi lượt và kiểm tra căn hộ trước khi xác nhận</p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setError('');
            void load().catch((e) => setError(e.message));
          }}
        >
          Cập nhật
        </Button>
      </div>
      <div className="surface-body stack">
        {error && (
          <p role="alert" className="feedback error">
            {error}
          </p>
        )}
        {!state ? (
          <p role="status">
            {error ? 'Bấm Cập nhật để thử tải lại bảng căn hộ.' : 'Đang tải bảng căn hộ…'}
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="status-badge">Dữ liệu diễn tập</span>
              <span className="section-subtitle">
                Không đặt cọc hoặc ký hợp đồng trên màn hình này.
              </span>
            </div>
            {!state.code && <EmptyState title="Chưa mở lượt chọn căn" description={state.notice} />}
            {state.code && (
              <details>
                <summary>Điều kiện và phạm vi sử dụng</summary>
                <p>{state.notice}</p>
              </details>
            )}
            {state.code && (
              <>
                <div className="metric-grid">
                  <div className="metric">
                    <span>Mã hồ sơ của tôi</span>
                    <strong style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{state.code}</strong>
                  </div>
                  <div className="metric">
                    <span>Lượt của tôi</span>
                    <strong>{state.rank}</strong>
                  </div>
                  <div className="metric">
                    <span>Lượt đang mở</span>
                    <strong>{state.nextRank ?? 'Hết lượt'}</strong>
                  </div>
                </div>
                <details>
                  <summary>Quy chế chọn căn và phương án giá</summary>
                  <p>{state.rules}</p>
                  <h3>{state.priceTitle}</h3>
                  <p>{state.priceBasis}</p>
                  <p style={{ overflowWrap: 'anywhere' }}>SHA-256 bảng giá: {state.priceHash}</p>
                </details>
                {state.allocation ? (
                  <div className="status-panel">
                    <h3>Đã phân căn diễn tập: {state.allocation.code}</h3>
                    <p>Giá theo phiên bản đã chốt: {money(state.allocation.quote.totalVnd)}</p>
                    <p>{new Date(state.allocation.allocated_at).toLocaleString('vi-VN')}</p>
                    <details>
                      <summary>Thông tin ghi nhận</summary>
                      <p style={{ overflowWrap: 'anywhere' }}>Mã ghi nhận: {state.allocation.id}</p>
                    </details>
                    <small>
                      Đây là biên nhận diễn tập, không xác nhận giữ chỗ hay quyền mua NOXH.
                    </small>
                  </div>
                ) : (
                  <>
                    <div className="status-panel" role="status">
                      <strong>
                        {!state.enabled
                          ? 'Tạm dừng chọn căn'
                          : state.mode === 'published-random'
                            ? 'Căn hộ từ kết quả đã công bố'
                            : state.myTurn
                              ? 'Đã đến lượt của bạn'
                              : 'Đang chờ đến lượt'}
                      </strong>
                      <p>
                        {!state.enabled
                          ? 'Đợt diễn tập đang tạm dừng.'
                          : state.mode === 'published-random'
                            ? `Căn từ kết quả ngẫu nhiên đã công bố: ${state.assignedUnit}. Không quay lại khi xác nhận.`
                            : state.myTurn
                              ? 'Đến lượt của bạn. Hãy chọn một căn còn lại và kiểm tra thông tin.'
                              : `Chưa đến lượt của bạn. Hệ thống chỉ mở lượt ${state.nextRank ?? '—'}.`}
                      </p>
                    </div>
                    {[...new Set(state.units?.map((u) => u.building) ?? [])].map((building) => (
                      <div key={building}>
                        <h3>Tòa {building}</h3>
                        {[
                          ...new Set(
                            state.units?.filter((u) => u.building === building).map((u) => u.floor),
                          ),
                        ]
                          .sort((a, b) => b - a)
                          .map((floor) => (
                            <div
                              key={floor}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '60px 1fr',
                                gap: 8,
                                marginBlock: 10,
                              }}
                            >
                              <strong>Tầng {floor}</strong>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(auto-fit,minmax(125px,1fr))',
                                  gap: 8,
                                }}
                              >
                                {state.units
                                  ?.filter((u) => u.building === building && u.floor === floor)
                                  .sort((a, b) => a.position - b.position)
                                  .map((u) => (
                                    <button
                                      key={u.code}
                                      type="button"
                                      className="member-card"
                                      aria-pressed={choose === u.code}
                                      disabled={
                                        busy ||
                                        u.allocated ||
                                        !state.enabled ||
                                        state.mode === 'published-random' ||
                                        !state.myTurn
                                      }
                                      style={{
                                        textAlign: 'left',
                                        margin: 0,
                                        borderColor: choose === u.code ? '#167968' : undefined,
                                        background:
                                          choose === u.code
                                            ? '#e4f5ef'
                                            : u.allocated
                                              ? '#eef0f2'
                                              : undefined,
                                        opacity: 1,
                                        cursor:
                                          u.allocated ||
                                          !state.enabled ||
                                          !state.myTurn ||
                                          state.mode === 'published-random'
                                            ? 'default'
                                            : 'pointer',
                                      }}
                                      onClick={() => {
                                        setSelected(u.code);
                                        setRetryKey(undefined);
                                        setAccepted(false);
                                      }}
                                    >
                                      <strong>{u.code}</strong>
                                      <p>
                                        {(u.areaCm2 / 10000).toLocaleString('vi-VN')} m² ·{' '}
                                        {u.orientation}
                                      </p>
                                      <small>{u.type}</small>
                                      <p style={{ fontSize: 12, marginBottom: 0 }}>
                                        {u.allocated
                                          ? 'Đã phân căn'
                                          : choose === u.code
                                            ? 'Đang chọn'
                                            : 'Chưa phân căn'}
                                      </p>
                                      {state.quotes?.find((q) => q.code === u.code) && (
                                        <p
                                          style={{ fontSize: 13, fontWeight: 600, marginBottom: 0 }}
                                        >
                                          {money(
                                            state.quotes.find((q) => q.code === u.code)!.totalVnd,
                                          )}
                                        </p>
                                      )}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    ))}
                    {quote && (
                      <div className="status-panel">
                        <h3>Kiểm tra căn {quote.code}</h3>
                        <p>
                          {quote.areaCm2 / 10000} m² · {money(quote.totalVnd)}
                        </p>
                        <details>
                          <summary>Cách tính giá căn hộ</summary>
                          <p>
                            Hệ số chính xác: {quote.coefficientNumerator}/
                            {quote.coefficientDenominator}. Áp dụng phương án giá và quy tắc làm
                            tròn đã công bố ở trên.
                          </p>
                        </details>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={accepted}
                            onChange={(e) => setAccepted(e.target.checked)}
                          />
                          Tôi đã kiểm tra căn, giá, quy chế và xác nhận đây là dữ liệu diễn tập.
                        </label>
                        <Button
                          disabled={
                            busy ||
                            !accepted ||
                            !state.enabled ||
                            (state.mode === 'queue-choice' && !state.myTurn)
                          }
                          onClick={async () => {
                            setBusy(true);
                            setError('');
                            const key = retryKey ?? crypto.randomUUID();
                            setRetryKey(key);
                            try {
                              const r = await fetch(
                                '/api/workflow/citizen/inventory/' + projectId + '/allocate',
                                {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'If-Match': String(state.version),
                                  },
                                  body: JSON.stringify({
                                    unitCode: choose,
                                    accepted: true,
                                    idempotencyKey: key,
                                  }),
                                },
                              );
                              const b = await r.json();
                              if (!r.ok) throw new Error(b.detail ?? 'Không phân căn được');
                              await load();
                              setRetryKey(undefined);
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'Không phân căn được');
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Xác nhận căn diễn tập
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
