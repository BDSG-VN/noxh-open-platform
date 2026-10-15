'use client';
import { useState } from 'react';
import type { ApplicationDetail } from '@noxh/contracts';
import { Button, PageHeading } from '@noxh/ui';
import {
  applicationRequest,
  applicationStatuses,
  documentTypes,
  housingModes,
  type SubmissionOptions,
} from '../application-ui';
const text = (value: unknown) => (typeof value === 'string' ? value : 'Chưa khai');
export default function ApplicationClient({ initial }: { initial: ApplicationDetail }) {
  const [data, setData] = useState(initial),
    [options, setOptions] = useState<SubmissionOptions>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const base = 'citizen/applications/' + data.id;
  async function reload() {
    const d = await applicationRequest(base);
    setData(d);
    if (d.status === 'supplement')
      setOptions(await applicationRequest('dossiers/' + d.dossier_id + '/submission'));
  }
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await reload();
      setMessage('Đã lưu.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const declaration = data.snapshot.declaration;
  const originalDocs = new Set(data.snapshot.documents.map((d) => d.id));
  const originalForms = new Set(data.snapshot.forms.map((f) => f.id));
  return (
    <>
      <a href="/dashboard#da-nop" className="auth-back">
        ← Hồ sơ đã gửi
      </a>
      <PageHeading
        eyebrow={data.public_code}
        title={data.project_name}
        description={data.round_name}
        action={
          <span className="status-badge">{applicationStatuses[data.status] ?? data.status}</span>
        }
      />
      {data.synthetic && (
        <p className="feedback error" role="status">
          <strong>BIÊN NHẬN DEMO — DỮ LIỆU GIẢ LẬP.</strong> Không có giá trị chứng minh đã nộp hồ
          sơ ngoài hệ thống thử nghiệm.
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="feedback success">
          {message}
        </p>
      )}
      <section className="surface">
        <div className="surface-head">
          <div>
            <span className="kicker">BIÊN NHẬN CỦA NỀN TẢNG</span>
            <h2 className="section-title">{data.receipt_code}</h2>
          </div>
        </div>
        <div className="surface-body">
          <dl className="detail-grid">
            <div>
              <dt>Thời điểm gửi</dt>
              <dd>{new Date(data.submitted_at).toLocaleString('vi-VN')}</dd>
            </div>
            <div>
              <dt>Người khai</dt>
              <dd>{text(declaration.fullName)}</dd>
            </div>
            <div>
              <dt>Hình thức</dt>
              <dd>{housingModes[data.snapshot.mode] ?? data.snapshot.mode}</dd>
            </div>
            <div>
              <dt>Nhóm đề nghị xem xét</dt>
              <dd>Nhóm {data.snapshot.subjectGroup}</dd>
            </div>
            <div>
              <dt>Ngày sinh đã khai</dt>
              <dd>{text(declaration.dateOfBirth)}</dd>
            </div>
            <div>
              <dt>Địa chỉ đã khai</dt>
              <dd>{text(declaration.address)}</dd>
            </div>
          </dl>
          <p>
            Biên nhận ghi lại bản khai và các tệp bạn đã chọn tại thời điểm gửi. Kết quả xét điều
            kiện và phân bổ căn hộ phải theo quyết định, quy trình áp dụng; tiếp nhận không bảo đảm
            được mua/thuê hoặc được chọn căn.
          </p>
          <details>
            <summary>Kiểm tra tính toàn vẹn</summary>
            <p>Mã bản khai: {data.snapshot.inputVersion}</p>
            <p className="request-message">SHA256: {data.snapshot_hash}</p>
          </details>
          <div className="button-row">
            <Button variant="outline" disabled={busy} onClick={() => run(reload)}>
              Cập nhật tiến độ
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              In biên nhận
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const bytes = JSON.stringify(
                  {
                    schema: 'noxh-citizen-receipt-v1',
                    receiptCode: data.receipt_code,
                    synthetic: data.synthetic,
                    submittedAt: data.submitted_at,
                    project: data.project_name,
                    round: data.round_name,
                    publicCode: data.public_code,
                    snapshotHash: data.snapshot_hash,
                    snapshot: data.snapshot,
                  },
                  null,
                  2,
                );
                const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' })),
                  a = document.createElement('a');
                a.href = url;
                a.download = data.receipt_code + '.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Tải bản lưu biên nhận của tôi
            </Button>
          </div>
        </div>
      </section>
      <section className="surface">
        <div className="surface-body">
          <h2>Tiến độ xử lý</h2>
          <ol>
            <li>
              <strong>Đã tiếp nhận:</strong> {new Date(data.submitted_at).toLocaleString('vi-VN')}
            </li>
            <li>
              <strong>Giai đoạn hiện tại:</strong> {applicationStatuses[data.status] ?? data.status}
            </li>
            <li>
              <strong>Phản hồi của chủ đầu tư:</strong>{' '}
              {data.decision_reason || 'Chưa có thông báo kết quả hoặc yêu cầu bổ sung.'}
            </li>
          </ol>
          {data.status === 'approved' && (
            <p className="help-note amber">
              Hồ sơ đã được chủ đầu tư phê duyệt. Việc lựa chọn đối tượng, ưu tiên, bốc thăm hoặc
              chọn căn được thực hiện ở bước riêng theo quy trình được công bố.
            </p>
          )}
          <p>
            <a href={'/dossiers/' + data.dossier_id}>Mở hồ sơ chuẩn bị và tải thêm giấy tờ →</a>
          </p>
        </div>
      </section>
      <section className="surface">
        <div className="surface-body">
          <h2>Giấy tờ đã gửi</h2>
          <p>Chỉ những tệp dưới đây và các lần bổ sung được tiếp nhận mới thuộc bộ hồ sơ này.</p>
          {data.snapshot.documents.map((d, i) => (
            <p key={d.id}>
              <a
                href={
                  '/api/workflow/dossiers/' + data.dossier_id + '/documents/' + d.id + '/download'
                }
              >
                {documentTypes[d.type] ?? 'Giấy tờ'} {i + 1}
              </a>{' '}
              · mã kiểm {d.sha256.slice(0, 12)}
            </p>
          ))}
          {data.snapshot.forms.map((f, i) => (
            <p key={f.id}>
              <a
                href={
                  '/api/workflow/dossiers/' +
                  data.dossier_id +
                  '/generated-forms/' +
                  f.id +
                  '/download'
                }
              >
                Bản điền mẫu đã kiểm tra {i + 1}
              </a>{' '}
              · mã kiểm {f.sha256.slice(0, 12)}
            </p>
          ))}
          {data.supplements.map((s, i) => (
            <article key={s.id} className="member-card">
              <h3>Bổ sung lần {i + 1}</h3>
              <small>{new Date(s.created_at).toLocaleString('vi-VN')}</small>
              <p className="request-message">{s.message}</p>
              {s.documentIds.map((id, j) => (
                <p key={id}>
                  <a
                    href={
                      '/api/workflow/dossiers/' + data.dossier_id + '/documents/' + id + '/download'
                    }
                  >
                    Giấy tờ bổ sung {j + 1}
                  </a>
                </p>
              ))}
              {s.formIds.map((id, j) => (
                <p key={id}>
                  <a
                    href={
                      '/api/workflow/dossiers/' +
                      data.dossier_id +
                      '/generated-forms/' +
                      id +
                      '/download'
                    }
                  >
                    Mẫu bổ sung {j + 1}
                  </a>
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>
      {data.status === 'supplement' && (
        <section className="surface">
          <div className="surface-body">
            <h2>Gửi tài liệu bổ sung</h2>
            <p>{data.decision_reason}</p>
            <p>
              Tải giấy tờ vào hồ sơ chuẩn bị, đợi quét an toàn, sau đó cập nhật danh sách và chọn
              đúng tài liệu bổ sung.
            </p>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setOptions(
                    await applicationRequest('dossiers/' + data.dossier_id + '/submission'),
                  ),
                )
              }
            >
              Tải danh sách giấy tờ mới
            </Button>
            {options && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  run(() =>
                    applicationRequest(
                      base + '/supplements',
                      {
                        documentIds: fd.getAll('document'),
                        generatedFormIds: fd.getAll('form'),
                        message: fd.get('message'),
                        accepted: true,
                      },
                      'POST',
                      { version: data.version },
                    ),
                  );
                }}
              >
                <fieldset>
                  <legend>Giấy tờ bổ sung</legend>
                  {options.documents
                    .filter((d) => !originalDocs.has(d.id))
                    .map((d, i) => (
                      <label className="check-row" key={d.id}>
                        <input type="checkbox" name="document" value={d.id} />
                        {documentTypes[d.type] ?? 'Giấy tờ'} {i + 1} ·{' '}
                        {new Date(d.created_at).toLocaleString('vi-VN')}
                      </label>
                    ))}
                </fieldset>
                <fieldset>
                  <legend>Mẫu đã kiểm tra kèm theo</legend>
                  {options.forms
                    .filter((f) => !originalForms.has(f.id))
                    .map((f, i) => (
                      <label className="check-row" key={f.id}>
                        <input type="checkbox" name="form" value={f.id} />
                        Mẫu {i + 1} · {new Date(f.created_at).toLocaleString('vi-VN')}
                      </label>
                    ))}
                </fieldset>
                <label>
                  Nội dung giải trình hoặc bổ sung
                  <textarea name="message" minLength={5} maxLength={2000} required rows={4} />
                </label>
                <label className="check-row">
                  <input type="checkbox" required />
                  Tôi đã kiểm tra và đồng ý gửi các tài liệu đã chọn cho chủ đầu tư. Bản gốc và các
                  lần bổ sung trước vẫn được lưu làm dấu vết.
                </label>
                <Button disabled={busy}>Gửi bổ sung và tiếp tục thẩm định</Button>
              </form>
            )}
          </div>
        </section>
      )}
      {['submitted', 'under_review', 'supplement', 'recommended'].includes(data.status) && (
        <section className="surface">
          <div className="surface-body">
            <h2>Rút hồ sơ khỏi quy trình</h2>
            <p>
              Hồ sơ đã rút không tiếp tục thẩm định. Biên nhận và dấu vết vẫn được lưu theo quy định
              lưu trữ; thao tác này không tự xóa toàn bộ dữ liệu.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(() => applicationRequest(base, undefined, 'DELETE', { version: data.version }));
              }}
            >
              <label className="check-row">
                <input type="checkbox" required />
                Tôi hiểu ảnh hưởng và xác nhận muốn rút hồ sơ này.
              </label>
              <Button disabled={busy} variant="outline">
                Xác nhận rút hồ sơ
              </Button>
            </form>
          </div>
        </section>
      )}
      <section className="surface">
        <div className="surface-body">
          <h2>Đề nghị xem xét lại</h2>
          <p>
            Phản hồi được gửi đến chủ đầu tư và lưu theo hồ sơ. Đối chiếu kênh, thời hạn và quy
            trình giải quyết chính thức trong thông báo dự án; thông điệp trên nền tảng không tự
            thay thế thủ tục khiếu nại theo pháp luật.
          </p>
          {data.appeals.map((a) => (
            <article key={a.id} className="member-card">
              <span className="status-badge">
                {a.status === 'open' ? 'Chờ trả lời' : 'Đã trả lời'}
              </span>
              <small>{new Date(a.created_at).toLocaleString('vi-VN')}</small>
              <p className="request-message">{a.message}</p>
              {a.reply && <p className="help-note">Phản hồi: {a.reply}</p>}
            </article>
          ))}
          {['approved', 'rejected'].includes(data.status) &&
          !data.appeals.some((a) => a.status === 'open') ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                run(() =>
                  applicationRequest(
                    base + '/appeals',
                    { message: fd.get('message'), accepted: true },
                    'POST',
                  ),
                );
              }}
            >
              <label>
                Nội dung đề nghị, căn cứ cần đối chiếu
                <textarea name="message" required minLength={10} maxLength={3000} rows={5} />
              </label>
              <label className="check-row">
                <input type="checkbox" required />
                Tôi đã xem nội dung và đồng ý gửi đề nghị đến người được phân quyền giải quyết của
                chủ đầu tư.
              </label>
              <Button disabled={busy}>Gửi đề nghị xem xét lại</Button>
            </form>
          ) : (
            !data.appeals.length && <p>Có thể gửi đề nghị sau khi hồ sơ có quyết định.</p>
          )}
          <p>
            <a href="/privacy">Thực hiện quyền đối với dữ liệu cá nhân →</a>
          </p>
        </div>
      </section>
    </>
  );
}
