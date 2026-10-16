'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, EmptyState } from '@noxh/ui';
import type { ExtractionField, MappingField, OcrJobDetail, OcrJobView } from '@noxh/contracts';
async function request(
  path: string,
  body?: unknown,
  method = 'GET',
  signal?: AbortSignal,
  headers: Record<string, string> = {},
) {
  const r = await fetch('/api/workflow/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.detail ?? 'Không thực hiện được');
  return v;
}
interface Doc {
  id: string;
  name: string;
  type: string;
  bytes: number;
  scan_status: string;
  scan_message?: string;
  sha256: string;
}
interface Extraction {
  id: string;
  document_id: string;
  fields: ExtractionField[];
  warnings: string[];
  accepted_at: string | null;
  source_hash: string;
  model: string;
}
interface Mapping {
  id: string;
  title: string;
  fields: MappingField[];
  version: number;
  form_id: string;
}
interface Generated {
  usable?: boolean;
  id: string;
  status: string;
  sha256: string;
  input_version: number;
  mapping_id: string;
}
export function DocumentWorkspace({
  id,
  dirty = false,
  onEvidenceChanged,
}: {
  id: string;
  dirty?: boolean;
  onEvidenceChanged?: () => Promise<void>;
}) {
  const [docs, setDocs] = useState<{
      items: Doc[];
      extractions: Extraction[];
      scannerConfigured: boolean;
    }>(),
    [forms, setForms] = useState<{
      mappings: Mapping[];
      generated: Generated[];
      inputVersion: number;
    }>(),
    [ocr, setOcr] = useState<{
      enabled: boolean;
      items: OcrJobView[];
      qualityThreshold: number;
      notice: string;
    }>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [mapping, setMapping] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState<Generated>(),
    [checked, setChecked] = useState<string[]>([]),
    [uploading, setUploading] = useState(false);
  const upload = useRef<AbortController | null>(null);
  const base = 'dossiers/' + id;
  async function load() {
    const [d, f, o] = await Promise.all([
      request(base + '/documents'),
      request(base + '/form-workspace'),
      request(base + '/ocr-jobs'),
    ]);
    setDocs(d);
    setForms(f);
    setOcr(o);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [id]);
  // Poll only while a job is queued or running; the worker finishes outside the request.
  const polling = ocr?.items.some((j) => j.status === 'pending' || j.status === 'running');
  const succeededCount = ocr?.items.filter((j) => j.status === 'succeeded').length ?? 0;
  const seenSucceeded = useRef(succeededCount);
  seenSucceeded.current = succeededCount;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      request(base + '/ocr-jobs')
        .then(async (o: { items: OcrJobView[] }) => {
          const done = o.items.filter((j) => j.status === 'succeeded').length;
          setOcr(o as typeof ocr);
          // A newly finished job created an extraction proposal: refresh step 02.
          if (done > seenSucceeded.current) setDocs(await request(base + '/documents'));
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [polling, id]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
      await load();
      await onEvidenceChanged?.();
      setMessage('Đã lưu.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được');
    } finally {
      setBusy(false);
    }
  }
  const current = forms?.mappings.find((m) => m.id === mapping);
  return (
    <div className="dossier-process stack">
      {dirty && (
        <p className="feedback" role="status">
          Bản khai có thay đổi chưa lưu. Hãy lưu trước khi tạo hoặc xác nhận PDF; giấy tờ vẫn có thể
          tải và quét an toàn.
        </p>
      )}
      <header>
        <span className="kicker">HỒ SƠ CỦA BẠN</span>
        <h2>Chuẩn bị giấy tờ và biểu mẫu</h2>
        <p>Tải giấy tờ, đối chiếu thông tin rồi tạo bản in theo hướng dẫn của dự án.</p>
      </header>
      <div className="metric-grid" aria-label="Tiến độ chuẩn bị giấy tờ">
        <div className="metric">
          <span>Giấy tờ đã tải</span>
          <strong>{docs?.items.length ?? '—'}</strong>
          <small>Lưu trong kho riêng</small>
        </div>
        <div className="metric">
          <span>Đã quét an toàn</span>
          <strong>{docs?.items.filter((d) => d.scan_status === 'clean').length ?? '—'}</strong>
          <small>Sẵn sàng để đối chiếu</small>
        </div>
        <div className="metric">
          <span>Mẫu đang áp dụng</span>
          <strong>{forms?.mappings.length ?? '—'}</strong>
          <small>Theo cấu hình dự án</small>
        </div>
        <div className="metric">
          <span>Bản in đã kiểm tra</span>
          <strong>
            {forms?.generated.filter((g) => g.status === 'confirmed' && g.usable !== false)
              .length ?? '—'}
          </strong>
          <small>Sẵn sàng để tải xuống</small>
        </div>
      </div>
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
      {docs && !docs.scannerConfigured && (
        <p className="help-note amber">
          Chưa cấu hình dịch vụ quét. Tệp tải lên vẫn được cách ly; chưa thể tải xuống hoặc gửi AI.
        </p>
      )}
      <section className="surface stack" aria-labelledby="upload-documents-heading">
        <div>
          <span className="kicker">BƯỚC 01</span>
          <h3 id="upload-documents-heading">Bổ sung giấy tờ</h3>
          <p>Chọn đúng nhóm giấy tờ để dễ theo dõi. Tệp chỉ được sử dụng sau khi quét an toàn.</p>
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget),
              file = fd.get('file') as File;
            run(async () => {
              if (!file || file.size > 5 * 1024 * 1024 || !file.size)
                throw new Error('Chọn PDF/JPEG/PNG tối đa 5 MiB');
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('Không đọc được tệp'));
                reader.onload = () => resolve(String(reader.result).split(',')[1]!);
                reader.readAsDataURL(file);
              });
              const controller = new AbortController();
              upload.current = controller;
              setUploading(true);
              try {
                await request(
                  base + '/documents',
                  { name: file.name, mime: file.type, type: fd.get('type'), base64 },
                  'POST',
                  controller.signal,
                );
              } catch (e) {
                if (controller.signal.aborted)
                  throw new Error('Đã hủy tải lên. Tệp chưa được lưu.');
                throw e;
              } finally {
                upload.current = null;
                setUploading(false);
              }
            });
          }}
        >
          <label>
            Nhóm giấy tờ
            <select className="search-input" name="type">
              <option value="identity">Nhân thân</option>
              <option value="subject">Đối tượng</option>
              <option value="housing">Nhà ở</option>
              <option value="income">Thu nhập</option>
              <option value="attested-form">Mẫu đã được xác nhận</option>
              <option value="other">Khác</option>
            </select>
          </label>
          <label>
            PDF hoặc ảnh, tối đa 5 MiB
            <input
              className="search-input"
              type="file"
              name="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
          </label>
          <Button disabled={busy}>{uploading ? 'Đang tải lên…' : 'Tải vào kho riêng'}</Button>
          {uploading && (
            <p className="feedback" role="status" aria-live="polite">
              Đang tải giấy tờ vào kho riêng, vui lòng đợi.{' '}
              <button type="button" className="text-button" onClick={() => upload.current?.abort()}>
                Hủy tải lên
              </button>
            </p>
          )}
        </form>
        {docs && !docs.items.length && (
          <EmptyState
            title="Chưa có giấy tờ"
            description="Bắt đầu bằng giấy tờ nhân thân hoặc tài liệu theo danh mục của chủ đầu tư."
          />
        )}
        {docs?.items.map((d) => (
          <article className="member-card stack" key={d.id}>
            <h3>{d.name}</h3>
            <span className="status-badge">
              {d.scan_status === 'clean'
                ? 'Đã quét an toàn'
                : d.scan_status === 'rejected'
                  ? 'Bị từ chối'
                  : 'Đang cách ly'}
            </span>
            <small>
              {Math.ceil(d.bytes / 1024)} KiB · {documentTypeLabel(d.type)}
            </small>
            {d.scan_status !== 'clean' && d.scan_message && (
              <p className="help-note amber">{d.scan_message}</p>
            )}
            {d.scan_status === 'clean' ? (
              <>
                <a
                  className="text-button"
                  href={'/api/workflow/' + base + '/documents/' + d.id + '/download'}
                >
                  Tải bản gốc
                </a>
                <details>
                  <summary>Hỗ trợ đọc giấy tờ bằng AI · tùy chọn</summary>
                  <p>
                    Chỉ tệp này được gửi để gợi ý thông tin. Bạn có thể tự điền mẫu mà không dùng
                    AI.
                  </p>
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() =>
                        request(
                          base + '/documents/' + d.id + '/extract',
                          { accepted: true, noticeVersion: 'document-extraction-v1' },
                          'POST',
                        ),
                      );
                    }}
                  >
                    <label className="check-row">
                      <input type="checkbox" required />
                      Tôi đồng ý riêng gửi nội dung tệp này đến OpenAI để trích xuất; nhà cung cấp
                      có chính sách lưu giữ riêng. Tôi sẽ kiểm tra lại kết quả.
                    </label>
                    <Button disabled={busy}>Đọc thông tin từ tệp này</Button>
                  </form>
                </details>
                {ocr?.enabled && (
                  <details>
                    <summary>Đọc chữ trên giấy tờ (OCR nội bộ) · tùy chọn</summary>
                    <p>
                      Giấy tờ được đọc bằng phần mềm chạy trên máy chủ của tổ chức, không gửi ra
                      ngoài. Kết quả chỉ là gợi ý để bạn đối chiếu; chưa đánh giá chất lượng trên
                      giấy tờ thật.
                    </p>
                    <form
                      className="stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(() =>
                          request(
                            base + '/documents/' + d.id + '/ocr',
                            { accepted: true, noticeVersion: 'document-ocr-v1' },
                            'POST',
                          ),
                        );
                      }}
                    >
                      <label className="check-row">
                        <input type="checkbox" required />
                        Tôi đồng ý riêng cho việc đọc chữ trên tệp này bằng OCR nội bộ và sẽ kiểm
                        tra lại kết quả trước khi dùng.
                      </label>
                      <Button
                        disabled={
                          busy ||
                          ocr.items.some(
                            (j) =>
                              j.documentId === d.id &&
                              (j.status === 'pending' || j.status === 'running'),
                          )
                        }
                      >
                        Đọc chữ trên giấy tờ (OCR nội bộ)
                      </Button>
                    </form>
                  </details>
                )}
              </>
            ) : (
              <Button
                disabled={busy || d.scan_status === 'rejected'}
                onClick={() =>
                  run(() => request(base + '/documents/' + d.id + '/scan', {}, 'POST'))
                }
              >
                Quét lại
              </Button>
            )}
            <details>
              <summary>Thông tin tệp và quản lý</summary>
              <p>
                Mã kiểm chứng SHA256: <code>{d.sha256}</code>
              </p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => request(base + '/documents/' + d.id, undefined, 'DELETE'))}
              >
                Rút khỏi hồ sơ chuẩn bị
              </Button>
            </details>
          </article>
        ))}
      </section>
      {ocr?.enabled && (
        <section className="surface stack" aria-labelledby="ocr-heading">
          <div>
            <span className="kicker">OCR NỘI BỘ</span>
            <h3 id="ocr-heading">Tác vụ đọc chữ trên giấy tờ</h3>
            <p>{ocr.notice}</p>
          </div>
          {polling && (
            <p className="feedback" role="status" aria-live="polite">
              Đang chờ máy chủ đọc chữ; trang tự cập nhật.
            </p>
          )}
          {!ocr.items.length && (
            <EmptyState
              title="Chưa có tác vụ OCR"
              description="Chọn một giấy tờ đã quét an toàn ở bước 01 và bấm “Đọc chữ trên giấy tờ (OCR nội bộ)”."
            />
          )}
          {ocr.items.map((j) => (
            <OcrJobCard
              key={j.id + ':' + j.version}
              job={j}
              base={base}
              busy={busy}
              threshold={ocr.qualityThreshold}
              name={docs?.items.find((d) => d.id === j.documentId)?.name ?? 'Giấy tờ'}
              cancel={() =>
                run(() =>
                  request(base + '/ocr-jobs/' + j.id + '/cancel', {}, 'POST', undefined, {
                    'If-Match': String(j.version),
                  }),
                )
              }
            />
          ))}
        </section>
      )}
      <section className="surface stack" aria-labelledby="extraction-heading">
        <div>
          <span className="kicker">BƯỚC 02 · TÙY CHỌN</span>
          <h3 id="extraction-heading">Đối chiếu thông tin được gợi ý</h3>
          <p>
            AI chỉ đề xuất. Đối chiếu từng trường với giấy tờ gốc trước khi chuyển sang điền mẫu.
          </p>
        </div>
        {docs && !docs.extractions.length && (
          <EmptyState
            title="Chưa có thông tin trích xuất"
            description="Nếu dùng AI ở bước trên, kết quả sẽ xuất hiện tại đây. Bạn vẫn có thể tự điền mẫu ở bước 03."
          />
        )}
        {docs?.extractions.map((x) => (
          <ExtractionReview
            key={x.id + ':' + (x.accepted_at ?? 'draft')}
            value={x}
            busy={busy}
            accept={(fields) =>
              run(() =>
                request(
                  base + '/extractions/' + x.id + '/accept',
                  { accepted: true, fields },
                  'POST',
                ),
              )
            }
            useFields={(fields) => {
              setValues((v) => ({
                ...v,
                ...Object.fromEntries(fields.map((f) => [f.key, f.value])),
              }));
              setMessage('Đã chuyển dữ liệu được kiểm tra vào vùng điền mẫu.');
            }}
          />
        ))}
      </section>
      <section className="surface stack" aria-labelledby="fill-form-heading">
        <div>
          <span className="kicker">BƯỚC 03</span>
          <h3 id="fill-form-heading">Điền mẫu theo hướng dẫn dự án</h3>
          <p>
            Chọn mẫu đang áp dụng và kiểm tra thông tin trước khi tạo PDF. Các vị trí chưa có thông
            tin được để trống trên bản nháp.
          </p>
        </div>
        {forms && !forms.mappings.length && (
          <EmptyState
            title="Chưa có mẫu sẵn sàng để điền"
            description="Chủ đầu tư cần hoàn tất việc kiểm tra và duyệt mẫu. Bạn có thể tiếp tục chuẩn bị giấy tờ trong thời gian chờ."
          />
        )}
        <label>
          Mẫu áp dụng
          <select
            className="search-input"
            value={mapping}
            onChange={(e) => {
              setMapping(e.target.value);
              setSelected(undefined);
              setChecked([]);
            }}
          >
            <option value="">Chọn mẫu</option>
            {forms?.mappings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} · bản {m.version}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) return;
              run(() =>
                request(
                  base + '/generated-forms',
                  {
                    mappingId: current.id,
                    inputVersion: forms!.inputVersion,
                    values: Object.fromEntries(
                      current.fields.map((f) => [f.key, values[f.key] ?? '']),
                    ),
                    evidenceIds:
                      docs?.items.filter((d) => d.scan_status === 'clean').map((d) => d.id) ?? [],
                  },
                  'POST',
                ),
              );
            }}
          >
            {current.fields.map((f) => (
              <label key={f.key}>
                {f.label}
                {f.required ? ' *' : ''}
                {f.externalConfirmation ? ' · cần xác nhận bên ngoài' : ''}
                <textarea
                  className="search-input"
                  rows={2}
                  value={values[f.key] ?? ''}
                  maxLength={1000}
                  disabled={Boolean(selected)}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                />
              </label>
            ))}
            <Button disabled={busy || dirty}>Tạo PDF nháp để kiểm tra</Button>
          </form>
        )}
      </section>
      <section className="surface stack" aria-labelledby="print-form-heading">
        <div>
          <span className="kicker">BƯỚC 04</span>
          <h3 id="print-form-heading">Kiểm tra bản in và tải bộ mẫu</h3>
          <p>
            Mở PDF để kiểm tra trình bày, sau đó xác nhận từng trường. Bản in không thay chữ ký,
            chứng thực hoặc kết luận đủ điều kiện.
          </p>
        </div>
        {forms?.generated.some((g) => g.status === 'confirmed' && g.usable !== false) && (
          <p>
            <a className="text-button" href={'/api/workflow/' + base + '/form-packet'}>
              Tải bộ mẫu đã kiểm tra (.zip)
            </a>
          </p>
        )}
        {forms && !forms.generated.length && (
          <EmptyState
            title="Chưa có bản in"
            description="Điền mẫu ở bước 03 để tạo PDF nháp. Bạn có thể xem lại và xác nhận sau."
          />
        )}
        {forms?.generated.map((g) => (
          <article className="member-card" key={g.id}>
            <strong>
              {g.status === 'confirmed' ? 'Đã được người khai kiểm tra' : 'Bản nháp chưa xác nhận'}
            </strong>
            <p>
              {forms.mappings.find((m) => m.id === g.mapping_id)?.title ?? 'Biểu mẫu đã tạo'} · bản
              khai {g.input_version}
            </p>
            <details>
              <summary>Nguồn gốc bản in</summary>
              <p>Mã bản in: {g.id}</p>
              <p>
                SHA256: <code>{g.sha256}</code>
              </p>
            </details>
            <a
              href={'/api/workflow/' + base + '/generated-forms/' + g.id + '/download'}
              className="text-button"
            >
              Tải PDF {g.status === 'draft' ? 'nháp' : ''}
            </a>
            {g.usable === false && (
              <p className="help-note amber">
                Mẫu hoặc bản khai không còn hiện hành; bản này chỉ giữ để đối chiếu. Hãy tạo lại
                theo mẫu đang được duyệt.
              </p>
            )}
            {g.status === 'draft' && g.usable !== false && (
              <Button
                onClick={() =>
                  run(async () => {
                    const d = await request(base + '/generated-forms/' + g.id);
                    setSelected(g);
                    setMapping(g.mapping_id);
                    setValues(d.values);
                    setChecked([]);
                  })
                }
              >
                Kiểm tra và xác nhận từng trường
              </Button>
            )}
          </article>
        ))}
        {selected && current && (
          <form
            className="status-panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) return;
              run(async () => {
                await request(
                  base + '/generated-forms/' + selected.id + '/confirm',
                  { accepted: true, checkedFields: checked },
                  'POST',
                );
                setSelected(undefined);
              });
            }}
          >
            <h3>Xác nhận sau khi xem PDF #{selected.id.slice(0, 8)}</h3>
            {current.fields.map((f) => (
              <label className="check-row" key={f.key}>
                <input
                  type="checkbox"
                  required
                  checked={checked.includes(f.key)}
                  onChange={(e) =>
                    setChecked((v) =>
                      e.target.checked ? [...v, f.key] : v.filter((k) => k !== f.key),
                    )
                  }
                />
                {f.label}: {values[f.key] || '(để trống)'}
                {f.externalConfirmation ? ' — tôi hiểu cần xin xác nhận đúng thẩm quyền' : ''}
              </label>
            ))}
            <label className="check-row">
              <input type="checkbox" required />
              Tôi đã đọc bản PDF nháp và kiểm tra toàn bộ thông tin. Việc xác nhận này không thay
              chữ ký hoặc xác nhận của cơ quan.
            </label>
            <Button disabled={busy || dirty}>Xác nhận để tạo bản in</Button>
          </form>
        )}
      </section>
    </div>
  );
}
function documentTypeLabel(type: string) {
  return (
    (
      {
        identity: 'Nhân thân',
        subject: 'Đối tượng',
        housing: 'Nhà ở',
        income: 'Thu nhập',
        'attested-form': 'Mẫu đã được xác nhận',
        other: 'Giấy tờ khác',
      } as Record<string, string>
    )[type] ?? 'Giấy tờ'
  );
}
function ocrStatusLabel(status: OcrJobView['status']) {
  return (
    (
      {
        pending: 'Đang chờ xử lý',
        running: 'Đang đọc chữ',
        succeeded: 'Đã đọc xong',
        failed: 'Không đọc được',
        cancelled: 'Đã hủy',
      } as Record<string, string>
    )[status] ?? status
  );
}
function ocrReasonLabel(reason: OcrJobView['reason']) {
  return (
    (
      {
        worker_unavailable: 'Dịch vụ đọc chữ chưa phản hồi; hệ thống sẽ thử lại có giới hạn.',
        worker_timeout: 'Dịch vụ đọc chữ quá thời gian; hệ thống sẽ thử lại có giới hạn.',
        worker_rejected: 'Dịch vụ đọc chữ không nhận tệp này (ảnh/PDF không đọc được).',
        invalid_result: 'Kết quả trả về không hợp lệ và đã bị loại bỏ.',
        document_unavailable: 'Giấy tờ không còn ở trạng thái quét an toàn hoặc đã bị rút.',
        consent_unavailable: 'Đồng ý xử lý đã được rút; kết quả không được lưu.',
        attempts_exhausted: 'Đã hết số lần thử; bạn có thể gửi yêu cầu mới sau.',
        processing_failed: 'Lỗi xử lý nội bộ; hệ thống sẽ thử lại có giới hạn.',
        cancelled_by_owner: 'Bạn đã hủy tác vụ này.',
        requeued: 'Người vận hành đã đưa tác vụ vào hàng đợi lại.',
      } as Record<string, string>
    )[reason ?? ''] ?? ''
  );
}
export function OcrJobCard({
  job: j,
  base,
  busy,
  threshold,
  name,
  cancel,
}: {
  job: OcrJobView;
  base: string;
  busy: boolean;
  threshold: number;
  name: string;
  cancel: () => void;
}) {
  const [detail, setDetail] = useState<OcrJobDetail>(),
    [loadError, setLoadError] = useState('');
  const active = j.status === 'pending' || j.status === 'running';
  return (
    <article className="member-card stack">
      <h3>{name}</h3>
      <span className="status-badge">{ocrStatusLabel(j.status)}</span>
      <small>
        Lần thử {j.attemptCount}/{j.attemptBudget}
        {j.engine ? ' · bộ đọc ' + j.engine : ''}
        {j.qualityScore !== null
          ? ' · chất lượng ước lượng ' + Math.round(j.qualityScore * 100) + '%'
          : ''}
      </small>
      {j.reason && j.status !== 'succeeded' && (
        <p className="help-note amber">{ocrReasonLabel(j.reason)}</p>
      )}
      {j.lowQuality && (
        <p className="help-note amber" role="status">
          Chất lượng nhận dạng thấp (dưới ngưỡng {Math.round(threshold * 100)}%). Kết quả có thể sai
          nhiều; hãy đối chiếu kỹ với bản gốc hoặc tải ảnh rõ hơn.
        </p>
      )}
      {active && (
        <Button variant="outline" disabled={busy} onClick={cancel}>
          Hủy tác vụ OCR
        </Button>
      )}
      {j.status === 'succeeded' && !detail && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setLoadError('');
            request(base + '/ocr-jobs/' + j.id)
              .then(setDetail)
              .catch((e) => setLoadError(e instanceof Error ? e.message : 'Không tải được'));
          }}
        >
          Xem chữ đã đọc
        </Button>
      )}
      {loadError && (
        <p role="alert" className="feedback error">
          {loadError}
        </p>
      )}
      {detail?.result && (
        <div className="stack">
          <p>
            {detail.result.pages} trang · {detail.result.blocks.length} dòng ·{' '}
            {detail.result.engine} {detail.result.engine_version}
          </p>
          {detail.result.blocks.length ? (
            <ol>
              {detail.result.blocks.map((b, i) => (
                <li key={i}>
                  <span>{b.text || '(trống)'}</span>{' '}
                  <small>
                    trang {b.page} · độ tin cậy {Math.round(b.confidence * 100)}%
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <p className="help-note amber">Không phát hiện được chữ trên giấy tờ.</p>
          )}
          <p>
            Các dòng này cũng xuất hiện ở bước 02 dưới dạng đề xuất; bạn kiểm tra và lưu từng dòng
            trước khi dùng để điền mẫu. Không có dữ liệu nào tự ghi vào bản khai.
          </p>
        </div>
      )}
    </article>
  );
}
function ExtractionReview({
  value: x,
  busy,
  accept,
  useFields,
}: {
  value: Extraction;
  busy: boolean;
  accept: (fields: ExtractionField[]) => void;
  useFields: (fields: ExtractionField[]) => void;
}) {
  const [fields, setFields] = useState(x.fields),
    [checked, setChecked] = useState<string[]>([]);
  return (
    <form
      className="member-card stack"
      onSubmit={(e) => {
        e.preventDefault();
        accept(fields.filter((f) => checked.includes(f.key)));
      }}
    >
      <strong>
        {x.accepted_at ? 'Thông tin đã được bạn đối chiếu' : 'Thông tin cần bạn kiểm tra'}
      </strong>
      <details>
        <summary>Nguồn trích xuất</summary>
        <p>
          Đề xuất {x.id} · mô hình {x.model}
        </p>
        <p>
          Mã tệp gốc: <code>{x.source_hash}</code>
        </p>
        <p>Độ tin cậy do AI tự ước lượng, không phải chứng nhận nội dung chính xác.</p>
      </details>
      {x.warnings.map((w, i) => (
        <p className="help-note amber" key={i}>
          {w}
        </p>
      ))}
      {fields.map((f, i) => (
        <div key={f.key}>
          <label>
            {f.label}
            <input
              className="search-input"
              disabled={Boolean(x.accepted_at)}
              value={f.value}
              maxLength={1000}
              onChange={(e) =>
                setFields((v) => v.map((a, j) => (j === i ? { ...a, value: e.target.value } : a)))
              }
            />
          </label>
          <small>
            Trang {f.page} · Độ tin cậy do AI ước lượng: {Math.round(f.confidence * 100)}%
          </small>
          <p>Trích từ giấy tờ: {f.evidence}</p>
          {!x.accepted_at && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={checked.includes(f.key)}
                onChange={(e) =>
                  setChecked((v) =>
                    e.target.checked ? [...v, f.key] : v.filter((k) => k !== f.key),
                  )
                }
              />
              Tôi đã đối chiếu trường này với bản gốc
            </label>
          )}
        </div>
      ))}
      {x.accepted_at ? (
        <Button type="button" onClick={() => useFields(fields)}>
          Dùng dữ liệu đã kiểm tra để điền mẫu
        </Button>
      ) : (
        <Button disabled={busy || !checked.length}>Lưu các trường đã kiểm tra</Button>
      )}
    </form>
  );
}
