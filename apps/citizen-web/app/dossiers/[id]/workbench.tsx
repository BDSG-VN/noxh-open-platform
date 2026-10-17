'use client';
import { useEffect, useState } from 'react';
import { type DossierDetail, type Declaration, type Readiness } from '@noxh/contracts';
import { Button, Icon } from '@noxh/ui';
import { ProjectForms, OnlineServices, AiAssistant } from './assistance';
import { DocumentWorkspace } from './document-workspace';
import SubmissionWorkspace from './submission-workspace';
import InventorySelection from '../../dashboard/inventory-selection';
const steps = [
  ['declarations', 'Thông tin người khai'],
  ['household', 'Thành viên hộ gia đình'],
  ['documents', 'Giấy tờ & biểu mẫu'],
  ['summary', 'Kiểm tra & xác nhận'],
  ['submission', 'Nộp & theo dõi hồ sơ'],
  ['inventory', 'Lựa chọn căn hộ'],
  ['support', 'Hỗ trợ từ chủ đầu tư'],
  ['online', 'Thủ tục trực tuyến'],
  ['assistant', 'Trợ lý AI'],
];
const formatDate = (s: string) =>
  new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
async function call(path: string, body: unknown, method = 'POST', version?: number) {
  const r = await fetch('/api/workflow/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    body: JSON.stringify(body),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.detail ?? 'Không thực hiện được. Hãy thử lại.');
  return b;
}
export default function DossierWorkbench({
  initial,
  initialTab,
}: {
  initial: DossierDetail;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(
      steps.some(([id]) => id === initialTab) ? String(initialTab) : 'declarations',
    ),
    [data, setData] = useState<Declaration>(initial.declaration),
    [version, setVersion] = useState(initial.version),
    [readiness, setReadiness] = useState<Readiness>(initial.readiness),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [dirty, setDirty] = useState(false),
    [help, setHelp] = useState(''),
    [accepted, setAccepted] = useState(false),
    [requests, setRequests] = useState(initial.requests),
    [history, setHistory] = useState(initial.history);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (patch: Partial<Declaration>) => {
    setData({ ...data, ...patch, confirmed: false });
    setDirty(true);
    setMessage('');
  };
  const save = async () => {
    const b = await call('dossiers/' + initial.id + '/declarations', data, 'PATCH', version);
    setVersion(b.version);
    setReadiness(b.readiness);
    setDirty(false);
    setMessage('Đã lưu bản nháp. Bạn có thể quay lại để tiếp tục.');
    setHistory([
      { version: b.version, created_at: new Date().toISOString(), source: 'citizen' },
      ...history,
    ]);
    return b.version as number;
  };
  const execute = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không xử lý được');
    } finally {
      setBusy(false);
    }
  };
  const refreshEvidence = async () => {
    const response = await fetch('/api/workflow/dossiers/' + initial.id, { cache: 'no-store' });
    if (!response.ok)
      throw new Error('Thao tác đã lưu. Chưa cập nhật được checklist; hãy tải lại.');
    const updated: DossierDetail = await response.json();
    setReadiness(updated.readiness);
    setHistory(updated.history);
    setRequests(updated.requests);
    if (!dirty) {
      setData(updated.declaration);
      setVersion(updated.version);
    } else if (updated.version !== version)
      setError(
        'Bản khai trên máy chủ đã thay đổi. Bản đang nhập chưa bị ghi đè; hãy đối chiếu trước khi lưu lại.',
      );
  };
  const activeRequest = requests.find((r) => r.status !== 'closed');
  return (
    <div
      className={
        'content-columns' +
        (['documents', 'submission', 'inventory'].includes(tab) ? ' focused-dossier' : '')
      }
    >
      <div className="stack">
        <section className="surface">
          <div className="surface-head">
            <div>
              <h2 className="section-title">Chuẩn bị hồ sơ</h2>
              <p className="section-subtitle">
                Thông tin được mã hóa khi lưu · Phiên bản {version}
              </p>
            </div>
            <span className={'status-badge ' + (dirty ? 'amber' : 'green')}>
              {dirty ? 'Chưa lưu thay đổi' : 'Đã lưu trên máy chủ'}
            </span>
          </div>
          <div className="wizard-layout">
            <nav className="wizard-steps" aria-label="Các bước khai báo">
              {steps.map(([id, label], i) => (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  className={tab === id ? 'active' : ''}
                  onClick={() => {
                    setTab(id!);
                    setMessage('');
                    setError('');
                  }}
                >
                  <span className="step-circle">{i + 1}</span>
                  {label}
                </button>
              ))}
            </nav>
            <div className="wizard-panel">
              {error && (
                <div role="alert" className="feedback error">
                  {error}{' '}
                  <button className="text-button" onClick={() => window.location.reload()}>
                    Tải lại hồ sơ
                  </button>
                </div>
              )}
              {message && (
                <div role="status" className="feedback">
                  {message}
                </div>
              )}
              {tab === 'declarations' && (
                <>
                  <span className="kicker">BƯỚC 01 / THÔNG TIN CƠ BẢN</span>
                  <h2>Thông tin người khai</h2>
                  <p>Nhập theo thông tin của bạn. Có thể lưu ngay cả khi chưa khai đầy đủ.</p>
                  <div className="form-grid">
                    <label>
                      Họ và tên
                      <input
                        className="search-input"
                        maxLength={200}
                        autoComplete="name"
                        value={data.fullName}
                        onChange={(e) => change({ fullName: e.target.value })}
                      />
                    </label>
                    <label>
                      Ngày sinh
                      <input
                        type="date"
                        className="search-input"
                        value={data.dateOfBirth}
                        onInput={(e) => change({ dateOfBirth: e.currentTarget.value })}
                        onChange={(e) => change({ dateOfBirth: e.target.value })}
                      />
                    </label>
                    <label className="span-all">
                      Địa chỉ đang cư trú
                      <textarea
                        className="search-input"
                        maxLength={500}
                        value={data.address}
                        onChange={(e) => change({ address: e.target.value })}
                      />
                    </label>
                    <label>
                      Nghề nghiệp
                      <input
                        className="search-input"
                        maxLength={200}
                        value={data.occupation}
                        onChange={(e) => change({ occupation: e.target.value })}
                      />
                    </label>
                    <label>
                      Tình trạng chỗ ở
                      <select
                        className="search-input"
                        value={data.housingSituation}
                        onChange={(e) =>
                          change({
                            housingSituation: e.target.value as Declaration['housingSituation'],
                          })
                        }
                      >
                        <option value="">Chọn tình trạng hiện tại</option>
                        <option value="renting">Đang thuê nhà</option>
                        <option value="with-family">Ở cùng gia đình</option>
                        <option value="owned">Có nhà ở</option>
                        <option value="other">Trường hợp khác</option>
                      </select>
                    </label>
                  </div>
                  <div className="help-note">
                    <Icon name="shield" />
                    <p>
                      Thông tin tự khai chưa được xác minh. Việc chọn tình trạng chỗ ở không tự kết
                      luận điều kiện đăng ký.
                    </p>
                  </div>
                </>
              )}
              {tab === 'household' && (
                <>
                  <span className="kicker">BƯỚC 02 / HỘ GIA ĐÌNH</span>
                  <h2>Những người cùng hộ</h2>
                  <p>
                    Người khai đã được tính riêng. Chỉ thêm thành viên cần khai trong hồ sơ của bạn.
                  </p>
                  {!data.household.length && (
                    <div className="empty-state">
                      <Icon name="user" size={30} />
                      <h3>Chưa thêm thành viên</h3>
                      <p>Nếu khai một mình, bạn có thể giữ trống danh sách.</p>
                    </div>
                  )}
                  {data.household.map((m, i) => (
                    <div className="member-card" key={i}>
                      <div>
                        <strong>Thành viên {i + 1}</strong>
                        <button
                          type="button"
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            change({ household: data.household.filter((_, j) => i !== j) })
                          }
                        >
                          Xóa thành viên
                        </button>
                      </div>
                      <div className="form-grid">
                        <label>
                          Họ và tên
                          <input
                            className="search-input"
                            maxLength={200}
                            value={m.fullName}
                            onChange={(e) =>
                              change({
                                household: data.household.map((v, j) =>
                                  j === i ? { ...v, fullName: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Quan hệ với người khai
                          <select
                            className="search-input"
                            value={m.relationship}
                            onChange={(e) =>
                              change({
                                household: data.household.map((v, j) =>
                                  j === i
                                    ? {
                                        ...v,
                                        relationship: e.target.value as typeof m.relationship,
                                      }
                                    : v,
                                ),
                              })
                            }
                          >
                            <option value="spouse">Vợ / chồng</option>
                            <option value="child">Con</option>
                            <option value="parent">Cha / mẹ</option>
                            <option value="other">Khác</option>
                          </select>
                        </label>
                        <label>
                          Ngày sinh
                          <input
                            className="search-input"
                            type="date"
                            value={m.dateOfBirth}
                            onInput={(e) => {
                              const value = e.currentTarget.value;
                              change({
                                household: data.household.map((v, j) =>
                                  j === i ? { ...v, dateOfBirth: value } : v,
                                ),
                              });
                            }}
                            onChange={(e) =>
                              change({
                                household: data.household.map((v, j) =>
                                  j === i ? { ...v, dateOfBirth: e.target.value } : v,
                                ),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy || data.household.length >= 20}
                    onClick={() =>
                      change({
                        household: [
                          ...data.household,
                          { fullName: '', dateOfBirth: '', relationship: 'other' },
                        ],
                      })
                    }
                  >
                    <Icon name="plus" size={16} /> Thêm thành viên
                  </Button>
                </>
              )}
              {tab === 'documents' && (
                <div className="stack">
                  <DocumentWorkspace
                    id={initial.id}
                    dirty={dirty}
                    onEvidenceChanged={refreshEvidence}
                  />
                  <ProjectForms id={initial.id} />
                </div>
              )}
              {tab === 'submission' && <SubmissionWorkspace id={initial.id} dirty={dirty} />}
              {tab === 'inventory' && <InventorySelection projectId={initial.project_id} />}
              {tab === 'online' && <OnlineServices id={initial.id} />}
              {tab === 'assistant' && <AiAssistant id={initial.id} dirty={dirty} />}
              {tab === 'summary' && (
                <>
                  <span className="kicker">BƯỚC 04 / KIỂM TRA THÔNG TIN</span>
                  <h2>Xem lại trước khi xác nhận</h2>
                  <p>Xác nhận dưới đây chỉ áp dụng cho thông tin khai báo đang lưu.</p>
                  <dl className="split-summary">
                    <div>
                      <dt>Người khai</dt>
                      <dd>{data.fullName || 'Chưa khai'}</dd>
                    </div>
                    <div>
                      <dt>Ngày sinh</dt>
                      <dd>{data.dateOfBirth || 'Chưa khai'}</dd>
                    </div>
                    <div>
                      <dt>Địa chỉ cư trú</dt>
                      <dd>{data.address || 'Chưa khai'}</dd>
                    </div>
                    <div>
                      <dt>Quy mô hộ đã khai</dt>
                      <dd>{1 + data.household.length} người</dd>
                    </div>
                  </dl>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={data.confirmed}
                      onChange={(e) => {
                        setData({ ...data, confirmed: e.target.checked });
                        setDirty(true);
                      }}
                    />
                    <span>
                      Tôi đã kiểm tra và xác nhận thông tin tự khai ở trên. Đây chưa phải việc nộp
                      đơn đăng ký chính thức.
                    </span>
                  </label>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      execute(async () => {
                        const v = dirty ? await save() : version;
                        const b = await call(
                          'dossiers/' + initial.id + '/readiness',
                          {},
                          'POST',
                          v,
                        );
                        setReadiness(b);
                        setMessage('Đã đánh giá mức độ chuẩn bị theo thông tin đã lưu.');
                      })
                    }
                  >
                    Đánh giá mức độ chuẩn bị
                  </Button>
                  <div className="help-note">
                    <Icon name="shield" />
                    <p>{readiness.disclaimer}</p>
                  </div>
                </>
              )}
              {tab === 'support' && (
                <>
                  <span className="kicker">BƯỚC 05 / KẾT NỐI CHỦ ĐẦU TƯ</span>
                  <h2>Hỗ trợ chuẩn bị hồ sơ</h2>
                  <p>
                    Gửi câu hỏi về quy trình hoặc danh mục cần chuẩn bị. Không nhập số giấy tờ hay
                    thông tin nhạy cảm.
                  </p>
                  {activeRequest ? (
                    <div className="member-card">
                      <span
                        className={
                          'status-badge ' +
                          (activeRequest.status === 'responded' ? 'green' : 'amber')
                        }
                      >
                        {activeRequest.status === 'responded'
                          ? 'Đã có phản hồi'
                          : 'Chờ chủ đầu tư phản hồi'}
                      </span>
                      <p className="request-message">{activeRequest.message}</p>
                      {activeRequest.reply && (
                        <div className="request-reply">
                          <strong>Chủ đầu tư trả lời</strong>
                          <p>{activeRequest.reply}</p>
                        </div>
                      )}
                      <Button
                        variant="outline"
                        className="mt-5"
                        disabled={busy}
                        onClick={() =>
                          execute(async () => {
                            await call(
                              'citizen/requests/' + activeRequest.id + '/close',
                              {},
                              'POST',
                              activeRequest.version,
                            );
                            setRequests(
                              requests.map((r) =>
                                r.id === activeRequest.id
                                  ? { ...r, status: 'closed', version: r.version + 1 }
                                  : r,
                              ),
                            );
                            setMessage('Đã đóng yêu cầu.');
                          })
                        }
                      >
                        Đóng yêu cầu
                      </Button>
                    </div>
                  ) : (
                    <>
                      <label>
                        Nội dung cần hỗ trợ
                        <textarea
                          className="search-input"
                          maxLength={2000}
                          value={help}
                          onChange={(e) => setHelp(e.target.value)}
                          placeholder="Ví dụ: Tôi cần chuẩn bị những giấy tờ nào cho đợt tiếp nhận này?"
                        />
                      </label>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={accepted}
                          onChange={(e) => setAccepted(e.target.checked)}
                        />
                        <span>
                          Tôi đồng ý chia sẻ nội dung yêu cầu này với chủ đầu tư để nhận hỗ trợ.
                          Thông tin khai báo trong hồ sơ vẫn riêng tư.
                        </span>
                      </label>
                      <Button
                        disabled={busy || !accepted || !help.trim()}
                        onClick={() =>
                          execute(async () => {
                            await call('dossiers/' + initial.id + '/support', {
                              message: help,
                              accepted,
                            });
                            const r = await fetch('/api/workflow/dossiers/' + initial.id);
                            if (!r.ok) throw new Error('Đã gửi. Hãy tải lại để xem trạng thái.');
                            setRequests((await r.json()).requests);
                            setHelp('');
                            setAccepted(false);
                            setMessage('Đã gửi yêu cầu tới chủ đầu tư.');
                          })
                        }
                      >
                        Gửi yêu cầu hỗ trợ
                      </Button>
                    </>
                  )}
                  {requests
                    .filter((r) => r.status === 'closed')
                    .map((r) => (
                      <div className="timeline-row" key={r.id}>
                        <Icon name="check" />
                        <div>
                          <strong>Yêu cầu đã đóng</strong>
                          <small>{formatDate(r.updated_at)}</small>
                          <p className="request-message">{r.message}</p>
                          {r.reply && <p className="request-reply">{r.reply}</p>}
                        </div>
                      </div>
                    ))}
                </>
              )}
              {['declarations', 'household', 'summary'].includes(tab) && (
                <div className="wizard-footer">
                  <small>{dirty ? 'Có thay đổi chưa lưu' : 'Đang hiển thị thông tin đã lưu'}</small>
                  <Button disabled={busy || !dirty} onClick={() => execute(save)}>
                    {busy ? 'Đang lưu…' : 'Lưu bản nháp'}
                  </Button>
                </div>
              )}
              {['declarations', 'household'].includes(tab) && (
                <button
                  className="text-button mt-4"
                  disabled={busy}
                  onClick={() => setTab(tab === 'declarations' ? 'household' : 'summary')}
                >
                  Tiếp tục bước sau →
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
      <aside
        aria-label="Mức độ chuẩn bị và hỗ trợ"
        className={
          'stack' +
          (['documents', 'submission', 'inventory'].includes(tab) ? ' dossier-secondary' : '')
        }
      >
        <section className="surface">
          <div className="surface-head">
            <h2 className="section-title">Mức độ chuẩn bị</h2>
            <Icon name="shield" />
          </div>
          <div className="surface-body">
            <div className="readiness-score">
              <div className="score-ring">
                <strong>
                  {readiness.score}
                  <small>/100</small>
                </strong>
              </div>
              <div>
                <strong>{readiness.checklist?.title ?? 'Checklist chuẩn bị chung'}</strong>
                <p className="section-subtitle">
                  {readiness.checklist
                    ? 'Hướng dẫn phiên bản ' + readiness.checklist.version
                    : readiness.version}
                  <br />
                  {dirty ? 'Lưu thay đổi để cập nhật' : 'Tính từ dữ liệu đã lưu'}
                </p>
              </div>
            </div>
            {readiness.categories.map((c) => (
              <div key={c.code} style={{ marginBottom: 15 }}>
                <div className="section-head" style={{ fontSize: 12, marginBottom: 6 }}>
                  <span>{c.label}</span>
                  <strong>
                    {c.score}/{c.maximum}
                  </strong>
                </div>
                <div className="progress-track">
                  <span style={{ width: (c.score / c.maximum) * 100 + '%' }} />
                </div>
              </div>
            ))}
            {readiness.configurationState === 'generic' && (
              <p className="help-note">
                Chưa có checklist dự án được duyệt. Mục chung chỉ tính ít nhất một tệp an toàn và
                một PDF hiện hành, không phải bộ hồ sơ pháp lý đầy đủ.
              </p>
            )}
            {readiness.configurationState === 'unavailable' && (
              <p role="status" className="feedback error">
                Hướng dẫn dự án đã hết hiệu lực hoặc bị thu hồi. Giấy tờ và mẫu tạm chưa tính hoàn
                thành; chờ bản cập nhật được duyệt.
              </p>
            )}
            {readiness.checklist && (
              <details>
                <summary>Hướng dẫn áp dụng</summary>
                <p>{readiness.checklist.instructions}</p>
                <p>Nguồn: {readiness.checklist.sourceReference}</p>
                <p>
                  Hiệu lực: {readiness.checklist.effectiveFrom}
                  {readiness.checklist.effectiveTo ? ' đến ' + readiness.checklist.effectiveTo : ''}
                </p>
              </details>
            )}
            <p style={{ fontSize: 12 }}>{readiness.disclaimer}</p>
            <Button variant="outline" disabled={busy} onClick={() => execute(refreshEvidence)}>
              Cập nhật checklist
            </Button>
          </div>
        </section>
        <section className="surface">
          <div className="surface-head">
            <h2 className="section-title">Việc cần làm</h2>
          </div>
          <div className="surface-body">
            {readiness.items.map((i) => (
              <div className="checklist-item" key={i.code}>
                <span className={'checklist-marker ' + (i.done ? 'done' : '')}>
                  {i.done ? <Icon name="check" size={13} /> : <Icon name="clock" size={13} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{i.label}</strong>
                  <p style={{ fontSize: 12, margin: '4px 0' }}>{i.reason}</p>
                  {i.evidence.length > 0 && (
                    <details>
                      <summary>{i.evidence.length} chứng cứ chuẩn bị</summary>
                      {i.evidence.map((e) => (
                        <p key={e.id}>
                          <a
                            className="text-button"
                            href={
                              '/api/workflow/dossiers/' +
                              initial.id +
                              (e.kind === 'document' ? '/documents/' : '/generated-forms/') +
                              e.id +
                              '/download'
                            }
                          >
                            Tải {e.kind === 'document' ? 'giấy tờ' : 'PDF'} · {e.id.slice(0, 8)}
                          </a>
                          <br />
                          <small>
                            Phiên bản {e.version}
                            {e.mappingVersion ? ' · ánh xạ ' + e.mappingVersion : ''}
                            {e.releaseVersion ? ' · hướng dẫn ' + e.releaseVersion : ''}
                          </small>
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                {!i.done && (
                  <button type="button" className="text-button" onClick={() => setTab(i.action)}>
                    Xem
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="surface">
          <div className="surface-head">
            <h2 className="section-title">Lịch sử lưu</h2>
            <Icon name="clock" />
          </div>
          <div className="surface-body">
            {history.length ? (
              history.slice(0, 5).map((h) => (
                <div className="timeline-row" key={h.version}>
                  <Icon name="check" size={16} />
                  <div>
                    <strong>Bản khai phiên bản {h.version}</strong>
                    <small>{formatDate(h.created_at)}</small>
                  </div>
                </div>
              ))
            ) : (
              <p>Chưa lưu bản khai. Bắt đầu từ thông tin người khai.</p>
            )}
          </div>
        </section>
      </aside>
    </div>
  );
}
