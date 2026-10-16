import { useEffect, useRef, useState } from 'react';
import {
  AcceptedFieldsSchema,
  DeclarationSchema,
  DocumentUploadSchema,
  GenerateFormSchema,
  type Declaration,
  type DossierDetail,
  type ExtractionField,
  type MappingField,
  type PrivacyWorkspace,
} from '@noxh/contracts';
import type { ZaloChannel } from './channel';
import { WorkspaceLifecycle } from './workspace-lifecycle';
interface Doc {
  id: string;
  name: string;
  type: string;
  mime: string;
  scan_status: string;
  scan_message?: string;
}
interface Extraction {
  id: string;
  document_id: string;
  fields: ExtractionField[];
  warnings: string[];
  accepted_at: string | null;
}
interface Documents {
  items: Doc[];
  extractions: Extraction[];
  scannerConfigured: boolean;
}
interface Mapping {
  id: string;
  title: string;
  fields: MappingField[];
  mode: string;
  subject_group: number;
}
interface Generated {
  id: string;
  mapping_id: string;
  status: string;
  input_version: number;
  usable: boolean;
}
interface Forms {
  mappings: Mapping[];
  generated: Generated[];
  inputVersion: number;
}
const privacyLabels: Record<string, string> = {
  controller: 'Bên kiểm soát dữ liệu',
  contact: 'Đầu mối liên hệ',
  purposes: 'Mục đích',
  categories: 'Loại dữ liệu',
  legalBasis: 'Căn cứ xử lý',
  recipients: 'Bên nhận dữ liệu',
  retention: 'Thời hạn lưu/xóa',
  transfers: 'Chuyển dữ liệu',
  safeguards: 'Bảo vệ dữ liệu',
  rights: 'Quyền của bạn',
  consequences: 'Lựa chọn và hệ quả',
  governance: 'Trách nhiệm quản trị',
};
const docLabels: Record<string, string> = {
  identity: 'Nhân thân',
  housing: 'Chỗ ở',
  income: 'Thu nhập',
  subject: 'Đối tượng',
  'attested-form': 'Bản có xác nhận',
  other: 'Giấy tờ khác',
};
async function uploadBody(file: File, type: string) {
  if (file.size < 10 || file.size > 5 * 1024 * 1024)
    throw new Error('Chọn tệp từ 10 byte đến 5 MiB.');
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))
    throw new Error(
      'Chỉ nhận PDF, JPEG hoặc PNG. Nếu thiết bị không nhận dạng được tệp, hãy dùng cổng web.',
    );
  if (typeof FileReader === 'undefined')
    throw new Error('Thiết bị chưa hỗ trợ đọc tệp; hãy dùng cổng công dân web.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không đọc được tệp.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
  return DocumentUploadSchema.parse({ name: file.name, type, mime: file.type, base64 });
}
export default function MiniDossierWorkspace({
  channel,
  id,
  onBack,
}: {
  channel: ZaloChannel;
  id: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<DossierDetail>(),
    [data, setData] = useState<Declaration>(),
    [docs, setDocs] = useState<Documents>(),
    [forms, setForms] = useState<Forms>(),
    [privacy, setPrivacy] = useState<PrivacyWorkspace>(),
    [tab, setTab] = useState<'declaration' | 'documents' | 'forms' | 'privacy'>('declaration'),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [noticeChecked, setNoticeChecked] = useState(false),
    [file, setFile] = useState<File>(),
    [type, setType] = useState('identity'),
    [aiChecks, setAiChecks] = useState<Record<string, boolean>>({}),
    [mappingId, setMappingId] = useState(''),
    [values, setValues] = useState<Record<string, string>>({}),
    [evidenceIds, setEvidenceIds] = useState<string[]>([]),
    [selected, setSelected] = useState<Generated>(),
    [checked, setChecked] = useState<string[]>([]),
    [readPdf, setReadPdf] = useState(''),
    [download, setDownload] = useState<{ url: string; name: string }>();
  const urls = useRef<string[]>([]),
    live = useRef(true),
    lifecycle = useRef(new WorkspaceLifecycle()),
    fileInput = useRef<HTMLInputElement>(null);
  async function load(replace = false) {
    const ticket = lifecycle.current.beginLoad();
    const [d, p, documents, formData] = await Promise.all([
      channel.dossier(id),
      channel.privacy(),
      channel.dossierAction<Documents>(id, 'documents'),
      channel.dossierAction<Forms>(id, 'form-workspace'),
    ]);
    if (!lifecycle.current.accepts(ticket)) return;
    setDetail(d);
    setPrivacy(p);
    setDocs(documents);
    setForms(formData);
    if (lifecycle.current.adopt(ticket, replace, d.version)) {
      setData(d.declaration);
      setDirty(false);
    }
    if (
      selected &&
      !formData.generated.some((g) => g.id === selected.id && g.usable && g.status === 'draft')
    ) {
      setSelected(undefined);
      setChecked([]);
      setReadPdf('');
      setMessage(
        'Mẫu hoặc bản khai đã thay đổi. Hãy chọn lại bản PDF hiện hành trước khi kiểm tra.',
      );
    }
    if (mappingId && !formData.mappings.some((m) => m.id === mappingId)) {
      setMappingId('');
      setSelected(undefined);
      setValues({});
      setEvidenceIds([]);
      setChecked([]);
      setReadPdf('');
    }
  }
  useEffect(() => {
    live.current = true;
    lifecycle.current.mount();
    setDetail(undefined);
    setData(undefined);
    setDocs(undefined);
    setForms(undefined);
    setPrivacy(undefined);
    setDirty(false);
    setMappingId('');
    setSelected(undefined);
    setValues({});
    setEvidenceIds([]);
    setChecked([]);
    setReadPdf('');
    setDownload(undefined);
    setFile(undefined);
    setError('');
    setMessage('');
    load(true).catch((e) => {
      if (live.current) setError(e.message);
    });
    return () => {
      live.current = false;
      lifecycle.current.unmount();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [id, channel]);
  useEffect(() => {
    setNoticeChecked(false);
    setAiChecks({});
  }, [privacy?.notice?.id, privacy?.notice?.content_hash, privacy?.accepted, privacy?.restricted]);
  async function run(action: () => Promise<void>) {
    if (!lifecycle.current.startAction()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      if (live.current) await load();
    } catch (e) {
      if (live.current) {
        // A timed-out upload/scan may already have persisted a quarantined file.
        // Refresh evidence and consent, but retain the local draft and its original If-Match.
        try {
          await load();
        } catch {
          /* Keep the original action error if refresh is unavailable. */
        }
        if (live.current) setError(e instanceof Error ? e.message : 'Chưa thực hiện được.');
      }
    } finally {
      lifecycle.current.finishAction();
      if (live.current) setBusy(false);
    }
  }
  function change(patch: Partial<Declaration>) {
    if (!data) return;
    lifecycle.current.edited();
    setData({ ...data, ...patch, confirmed: false });
    setDirty(true);
    setSelected(undefined);
    setChecked([]);
    setReadPdf('');
  }
  async function downloadFile(resource: string, name: string, previewId?: string) {
    const blob = await channel.file(id, resource);
    if (!live.current) return;
    const url = URL.createObjectURL(blob);
    for (const previous of urls.current) URL.revokeObjectURL(previous);
    urls.current = [url];
    setDownload({ url, name });
    if (previewId) setReadPdf(previewId);
    setMessage(
      'Tệp đã sẵn sàng. Nhấn liên kết tải bên dưới; việc xem/tải phụ thuộc trình duyệt trong Zalo.',
    );
  }
  const canWrite = privacy?.accepted === true && !privacy.restricted;
  const mapping = forms?.mappings.find((m) => m.id === mappingId);
  if (!detail || !data)
    return (
      <section>
        <p role="status">Đang tải hồ sơ…</p>
        {error && <p role="alert">{error}</p>}
        <button onClick={onBack}>Quay lại</button>
      </section>
    );
  return (
    <section className="mini-workspace">
      <button
        disabled={busy}
        onClick={() => {
          if (dirty) {
            setError('Còn bản khai chưa lưu. Lưu hoặc bấm bỏ thay đổi trước khi quay lại.');
            return;
          }
          onBack();
        }}
      >
        ← Hồ sơ của tôi
      </button>
      <h2>{detail.project_name}</h2>
      <p>
        Bản khai {detail.version} · Mức độ chuẩn bị {detail.readiness.score}/100
      </p>
      <p>{detail.readiness.disclaimer}</p>
      {dirty && lifecycle.current.baseVersion !== detail.version && (
        <p role="alert" className="notice error">
          Bản khai trên máy chủ đã thay đổi. Bản bạn đang sửa dựa trên phiên bản{' '}
          {lifecycle.current.baseVersion}. Việc lưu sẽ bị từ chối để tránh ghi đè. Hãy giữ lại thông
          tin cần thiết, rồi bỏ thay đổi và tải lại bản đang lưu.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {busy && <p role="status">Đang xử lý…</p>}
      {!canWrite && (
        <p className="notice">
          Bạn vẫn có thể đọc và tải dữ liệu. Để gửi thêm thông tin, đọc thông báo hiện hành và kiểm
          tra lựa chọn tại mục Quyền riêng tư.
        </p>
      )}
      <nav className="mini-tabs" aria-label="Các bước chuẩn bị">
        {(
          [
            ['declaration', 'Bản khai'],
            ['documents', 'Giấy tờ'],
            ['forms', 'Biểu mẫu'],
            ['privacy', 'Quyền riêng tư'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            aria-current={tab === key ? 'step' : undefined}
            disabled={busy}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {download && (
        <p className="notice">
          <a href={download.url} download={download.name} target="_blank" rel="noopener noreferrer">
            Tải tệp đã yêu cầu: {download.name}
          </a>
          <br />
          <small>Liên kết chỉ tồn tại trong phiên hiện tại, không phải URL công khai.</small>
        </p>
      )}
      {tab === 'declaration' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const parsed = DeclarationSchema.parse(data);
              await channel.saveDeclaration(id, parsed, lifecycle.current.baseVersion);
              await load(true);
              setMessage('Đã lưu bản khai. PDF cũ cần đối chiếu lại với phiên bản mới.');
            });
          }}
        >
          <fieldset disabled={busy}>
            <h3>Thông tin người khai</h3>
            <label>
              Họ và tên
              <input
                required
                maxLength={200}
                value={data.fullName}
                onChange={(e) => change({ fullName: e.target.value })}
              />
            </label>
            <label>
              Ngày sinh
              <input
                type="date"
                value={data.dateOfBirth}
                onChange={(e) => change({ dateOfBirth: e.target.value })}
              />
            </label>
            <label>
              Địa chỉ cư trú
              <textarea
                maxLength={500}
                value={data.address}
                onChange={(e) => change({ address: e.target.value })}
              />
            </label>
            <label>
              Nghề nghiệp
              <input
                maxLength={200}
                value={data.occupation}
                onChange={(e) => change({ occupation: e.target.value })}
              />
            </label>
            <label>
              Tình trạng chỗ ở
              <select
                value={data.housingSituation}
                onChange={(e) =>
                  change({ housingSituation: e.target.value as Declaration['housingSituation'] })
                }
              >
                <option value="">Chọn tình trạng</option>
                <option value="renting">Đang thuê</option>
                <option value="with-family">Ở cùng gia đình</option>
                <option value="owned">Có nhà ở</option>
                <option value="other">Khác</option>
              </select>
            </label>
            <h3>Thành viên hộ gia đình</h3>
            {data.household.map((m, i) => (
              <fieldset key={i}>
                <legend>Thành viên {i + 1}</legend>
                <label>
                  Họ và tên
                  <input
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
                  Ngày sinh
                  <input
                    type="date"
                    value={m.dateOfBirth}
                    onChange={(e) =>
                      change({
                        household: data.household.map((v, j) =>
                          j === i ? { ...v, dateOfBirth: e.target.value } : v,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Quan hệ
                  <select
                    value={m.relationship}
                    onChange={(e) =>
                      change({
                        household: data.household.map((v, j) =>
                          j === i
                            ? { ...v, relationship: e.target.value as typeof v.relationship }
                            : v,
                        ),
                      })
                    }
                  >
                    <option value="spouse">Vợ/chồng</option>
                    <option value="child">Con</option>
                    <option value="parent">Cha/mẹ</option>
                    <option value="other">Khác</option>
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => change({ household: data.household.filter((_, j) => j !== i) })}
                >
                  Xóa thành viên
                </button>
              </fieldset>
            ))}
            <button
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
              Thêm thành viên
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={data.confirmed}
                onChange={(e) => {
                  lifecycle.current.edited();
                  setData({ ...data, confirmed: e.target.checked });
                  setDirty(true);
                }}
              />
              Tôi đã kiểm tra thông tin tự khai. Đây chưa phải nộp đơn chính thức hoặc xác nhận đủ
              điều kiện.
            </label>
            <button disabled={busy || !canWrite || !dirty}>Lưu bản khai</button>
            {dirty && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  lifecycle.current.discarded();
                  run(() => load(true));
                }}
              >
                Bỏ thay đổi và tải lại bản đang lưu
              </button>
            )}
          </fieldset>
        </form>
      )}
      {tab === 'documents' && (
        <div>
          <h3>Giấy tờ riêng tư</h3>
          <p>
            Chọn tệp trên thiết bị nếu ứng dụng hỗ trợ; có thể dùng cổng web khi không chọn/tải được
            tệp. Không gửi tệp sang OpenAI nếu bạn chưa đồng ý riêng.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!file) throw new Error('Hãy chọn tệp.');
                const body = await uploadBody(file, type);
                await channel.dossierAction<{ id: string }>(id, 'documents', body);
                setFile(undefined);
                if (fileInput.current) fileInput.current.value = '';
                setMessage(
                  'Đã tải và yêu cầu quét an toàn. Xem trạng thái thực của từng tệp bên dưới.',
                );
              });
            }}
          >
            <label>
              Loại giấy tờ
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {Object.entries(docLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tệp PDF/JPEG/PNG tối đa 5 MiB
              <input
                type="file"
                ref={fileInput}
                accept="application/pdf,image/jpeg,image/png"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <button disabled={busy || !canWrite || !file}>Tải vào kho riêng và quét</button>
          </form>
          {docs?.items.map((d) => (
            <article className="notice" key={d.id}>
              <h4>{d.name}</h4>
              <p>
                {docLabels[d.type]} ·{' '}
                {d.scan_status === 'clean'
                  ? 'Đã quét an toàn'
                  : d.scan_status === 'rejected'
                    ? 'Chưa đạt kiểm tra an toàn'
                    : 'Đang cách ly'}
              </p>
              <p>{d.scan_message}</p>
              <p>Kiểm tra an toàn không xác minh danh tính hoặc tính đúng của giấy tờ.</p>
              {d.scan_status === 'quarantined' && (
                <button
                  disabled={busy || !canWrite}
                  onClick={() =>
                    run(async () => {
                      await channel.dossierAction(id, 'documents/' + d.id + '/scan', {});
                    })
                  }
                >
                  Quét lại
                </button>
              )}
              {d.scan_status === 'clean' && (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        downloadFile(
                          'documents/' + d.id + '/download',
                          'noxh-document-' +
                            d.id +
                            (d.mime === 'application/pdf'
                              ? '.pdf'
                              : d.mime === 'image/png'
                                ? '.png'
                                : '.jpg'),
                        ),
                      )
                    }
                  >
                    Chuẩn bị tệp để tải
                  </button>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={aiChecks[d.id] ?? false}
                      onChange={(e) => setAiChecks({ ...aiChecks, [d.id]: e.target.checked })}
                    />
                    Tôi đồng ý gửi riêng tệp này tới OpenAI để đọc thông tin, theo chính sách nhà
                    cung cấp. Không gửi mật khẩu/OTP.
                  </label>
                  <button
                    disabled={busy || !canWrite || !aiChecks[d.id]}
                    onClick={() =>
                      run(async () => {
                        setAiChecks({ ...aiChecks, [d.id]: false });
                        await channel.dossierAction(id, 'documents/' + d.id + '/extract', {
                          accepted: true,
                          noticeVersion: 'document-extraction-v1',
                        });
                      })
                    }
                  >
                    Yêu cầu AI đọc tệp này
                  </button>
                </>
              )}
              <details>
                <summary>Rút giấy tờ khỏi hồ sơ chuẩn bị</summary>
                <p>
                  Tệp đã nằm trong hồ sơ nộp có thể phải xử lý theo quyền dữ liệu và thời hạn pháp
                  lý.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await channel.dossierAction(id, 'documents/' + d.id, undefined, 'DELETE');
                    })
                  }
                >
                  Xác nhận rút tệp này
                </button>
              </details>
            </article>
          ))}
          {docs?.extractions
            .filter((x) =>
              docs.items.some((d) => d.id === x.document_id && d.scan_status === 'clean'),
            )
            .map((x) => (
              <MiniExtraction
                key={x.id + ':' + x.accepted_at}
                extraction={x}
                busy={busy || !canWrite}
                save={(fields) =>
                  run(async () => {
                    await channel.dossierAction(
                      id,
                      'extractions/' + x.id + '/accept',
                      AcceptedFieldsSchema.parse({ accepted: true, fields }),
                    );
                  })
                }
                use={(fields) => {
                  if (!mappingId) {
                    setTab('forms');
                    setMessage(
                      'Chọn mẫu trước, rồi quay lại giấy tờ để chuyển dữ liệu đã kiểm tra. Các trường vẫn được lưu riêng.',
                    );
                    return;
                  }
                  setValues((v) => ({
                    ...v,
                    ...Object.fromEntries(fields.map((f) => [f.key, f.value])),
                  }));
                  setEvidenceIds((v) => [...new Set([...v, x.document_id])]);
                  setTab('forms');
                  setMessage(
                    'Đã chuyển các trường bạn kiểm tra vào vùng điền mẫu; chưa ghi bản khai hoặc tạo PDF.',
                  );
                }}
              />
            ))}
        </div>
      )}
      {tab === 'forms' && (
        <div>
          <h3>Điền và kiểm tra mẫu hiện hành</h3>
          <p>
            Chọn theo hướng dẫn chủ đầu tư, không tự suy ra đối tượng đủ điều kiện. Phần xác nhận cơ
            quan để trống, không tạo chữ ký hoặc con dấu.
          </p>
          {dirty && (
            <p className="notice error">Bản khai chưa lưu. Lưu trước khi tạo hoặc xác nhận PDF.</p>
          )}
          <label>
            Mẫu đã được duyệt
            <select
              value={mappingId}
              disabled={Boolean(selected)}
              onChange={(e) => {
                setMappingId(e.target.value);
                setValues({
                  fullName: detail.declaration.fullName,
                  dateOfBirth: detail.declaration.dateOfBirth,
                  address: detail.declaration.address,
                  occupation: detail.declaration.occupation,
                });
                setEvidenceIds([]);
              }}
            >
              <option value="">Chọn mẫu đang áp dụng</option>
              {forms?.mappings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title} ·{' '}
                  {m.mode === 'buy' ? 'Mua' : m.mode === 'rent-buy' ? 'Thuê mua' : 'Thuê'} · Nhóm{' '}
                  {m.subject_group}
                </option>
              ))}
            </select>
          </label>
          {forms && !forms.mappings.length && (
            <p>
              Chưa có ánh xạ mẫu đang được duyệt cho dự án. Chủ đầu tư cần rà soát và công bố trước.
            </p>
          )}
          {mapping && !selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty) return;
                run(async () => {
                  await channel.dossierAction(
                    id,
                    'generated-forms',
                    GenerateFormSchema.parse({
                      mappingId: mapping.id,
                      inputVersion: detail.version,
                      values: Object.fromEntries(
                        mapping.fields.map((f) => [
                          f.key,
                          f.externalConfirmation ? '' : (values[f.key] ?? ''),
                        ]),
                      ),
                      evidenceIds,
                    }),
                  );
                  setMessage('Đã tạo bản nháp. Hãy tải PDF, đọc và kiểm tra từng trường.');
                });
              }}
            >
              {mapping.fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.externalConfirmation ? ' · cần cơ quan xác nhận' : ''}
                  <textarea
                    disabled={f.externalConfirmation}
                    maxLength={1000}
                    value={f.externalConfirmation ? '' : (values[f.key] ?? '')}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </label>
              ))}
              <fieldset>
                <legend>Giấy tờ dẫn chứng, không gửi sang AI</legend>
                {docs?.items
                  .filter((d) => d.scan_status === 'clean')
                  .map((d) => (
                    <label className="check" key={d.id}>
                      <input
                        type="checkbox"
                        checked={evidenceIds.includes(d.id)}
                        onChange={(e) =>
                          setEvidenceIds((v) =>
                            e.target.checked ? [...v, d.id] : v.filter((id) => id !== d.id),
                          )
                        }
                      />
                      {d.name}
                    </label>
                  ))}
              </fieldset>
              <button disabled={busy || dirty || !canWrite}>Tạo PDF nháp</button>
            </form>
          )}
          {forms?.generated.map((g) => (
            <article className="notice" key={g.id}>
              <h4>
                {forms.mappings.find((m) => m.id === g.mapping_id)?.title ?? 'Biểu mẫu đã tạo'}
              </h4>
              <p>
                {g.status === 'confirmed' ? 'Người khai đã kiểm tra' : 'Bản nháp chưa kiểm tra'} ·
                bản khai {g.input_version}
              </p>
              {!g.usable && <p>Mẫu hoặc bản khai đã thay đổi; bản này chỉ giữ đối chiếu.</p>}
              <button
                disabled={busy}
                onClick={() =>
                  run(() =>
                    downloadFile(
                      'generated-forms/' + g.id + '/download',
                      'noxh-form-' + g.id + '.pdf',
                      g.id,
                    ),
                  )
                }
              >
                Chuẩn bị PDF để đọc/tải
              </button>
              {g.status === 'draft' && g.usable && (
                <button
                  disabled={busy || dirty || !canWrite}
                  onClick={() =>
                    run(async () => {
                      const content = await channel.dossierAction<{
                        values: Record<string, string>;
                      }>(id, 'generated-forms/' + g.id);
                      setSelected(g);
                      setMappingId(g.mapping_id);
                      setValues(content.values);
                      setChecked([]);
                    })
                  }
                >
                  Kiểm tra từng trường
                </button>
              )}
            </article>
          ))}
          {selected && mapping && (
            <form
              key={selected.id}
              className="notice"
              onSubmit={(e) => {
                e.preventDefault();
                if (dirty) return;
                run(async () => {
                  await channel.dossierAction(id, 'generated-forms/' + selected.id + '/confirm', {
                    accepted: true,
                    checkedFields: checked,
                  });
                  setSelected(undefined);
                  setChecked([]);
                  setReadPdf('');
                  setMessage(
                    'Đã ghi nhận bạn kiểm tra mẫu. Chưa thay xác nhận hoặc xét duyệt của cơ quan.',
                  );
                });
              }}
            >
              <h4>Xác nhận PDF sau khi đọc</h4>
              {mapping.fields.map((f) => (
                <label className="check" key={f.key}>
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
                  {f.externalConfirmation ? ' — cần xin xác nhận đúng thẩm quyền' : ''}
                </label>
              ))}
              <label className="check">
                <input type="checkbox" required />
                Tôi đã đọc PDF và đối chiếu toàn bộ thông tin, kể cả phần để trống. Xác nhận này
                không phải chữ ký/chứng thực của cơ quan.
              </label>
              {readPdf !== selected.id && <p>Chuẩn bị và mở PDF của bản này trước khi xác nhận.</p>}
              <button
                disabled={
                  busy ||
                  dirty ||
                  !canWrite ||
                  readPdf !== selected.id ||
                  checked.length !== mapping.fields.length
                }
              >
                Xác nhận đã kiểm tra bản PDF
              </button>
              <button type="button" disabled={busy} onClick={() => setSelected(undefined)}>
                Hủy kiểm tra
              </button>
            </form>
          )}
          {forms?.generated.some((g) => g.status === 'confirmed' && g.usable) && (
            <button
              disabled={busy}
              onClick={() =>
                run(() => downloadFile('form-packet', 'noxh-prepared-forms-' + id + '.zip'))
              }
            >
              Chuẩn bị bộ PDF hiện hành (.zip)
            </button>
          )}
        </div>
      )}
      {tab === 'privacy' && (
        <div>
          <h3>Thông báo và lựa chọn dữ liệu</h3>
          {privacy?.notice ? (
            <>
              <p>
                Phiên bản {privacy.notice.version} ·{' '}
                {privacy.accepted ? 'Đã ghi nhận đồng ý' : 'Chưa đồng ý thông báo hiện hành'}
                {privacy.restricted ? ' · đang hạn chế xử lý' : ''}
              </p>
              {Object.entries(privacy.notice)
                .filter(([key]) => Boolean(privacyLabels[key]))
                .map(([key, value]) => (
                  <details key={key}>
                    <summary>{privacyLabels[key]}</summary>
                    <p>{String(value)}</p>
                  </details>
                ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={noticeChecked}
                  onChange={(e) => setNoticeChecked(e.target.checked)}
                />
                Tôi đã đọc và đồng ý thông báo này. Gửi OpenAI từng tệp là lựa chọn riêng, không
                được tự bật ở đây.
              </label>
              <button
                disabled={busy || !noticeChecked}
                onClick={() =>
                  run(async () => {
                    await channel.acceptPrivacy(privacy.notice!.id, privacy.notice!.content_hash);
                    setNoticeChecked(false);
                  })
                }
              >
                Ghi nhận lựa chọn
              </button>
              <details>
                <summary>Rút đồng ý xử lý dữ liệu</summary>
                <p>Sẽ dừng các xử lý cần consent; bạn vẫn có thể xem và tải dữ liệu được phép.</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await channel.withdrawPrivacy();
                      setNoticeChecked(false);
                    })
                  }
                >
                  Xác nhận rút đồng ý
                </button>
              </details>
            </>
          ) : (
            <p>
              Chủ đầu tư chưa công bố thông báo dữ liệu được duyệt. Chưa thể gửi thêm thông tin.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
function MiniExtraction({
  extraction,
  busy,
  save,
  use,
}: {
  extraction: Extraction;
  busy: boolean;
  save: (fields: ExtractionField[]) => void;
  use: (fields: ExtractionField[]) => void;
}) {
  const [fields, setFields] = useState(extraction.fields),
    [checks, setChecks] = useState<string[]>([]);
  return (
    <form
      className="notice"
      onSubmit={(e) => {
        e.preventDefault();
        save(fields.filter((f) => checks.includes(f.key)));
      }}
    >
      <h4>
        {extraction.accepted_at ? 'Dữ liệu bạn đã kiểm tra' : 'AI trích xuất · cần bạn đối chiếu'}
      </h4>
      {extraction.warnings.map((w, i) => (
        <p key={i}>{w}</p>
      ))}
      {fields.map((f, i) => (
        <fieldset key={f.key}>
          <legend>{f.label}</legend>
          <p>
            Trang {f.page} · điểm tin cậy AI {Math.round(f.confidence * 100)}%, không xác minh danh
            tính/nội dung.
          </p>
          <p>{f.evidence}</p>
          <label>
            Giá trị đối chiếu
            <input
              maxLength={1000}
              disabled={Boolean(extraction.accepted_at)}
              value={f.value}
              onChange={(e) =>
                setFields(fields.map((v, j) => (j === i ? { ...v, value: e.target.value } : v)))
              }
            />
          </label>
          {!extraction.accepted_at && (
            <label className="check">
              <input
                type="checkbox"
                checked={checks.includes(f.key)}
                onChange={(e) =>
                  setChecks((v) =>
                    e.target.checked ? [...v, f.key] : v.filter((k) => k !== f.key),
                  )
                }
              />
              Tôi đã đối chiếu trường này với giấy tờ gốc
            </label>
          )}
        </fieldset>
      ))}
      {extraction.accepted_at ? (
        <button type="button" disabled={busy} onClick={() => use(fields)}>
          Chuyển dữ liệu đã kiểm tra vào mẫu
        </button>
      ) : (
        <button disabled={busy || !checks.length}>Lưu riêng các trường đã kiểm tra</button>
      )}
    </form>
  );
}
