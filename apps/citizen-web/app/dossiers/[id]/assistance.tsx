'use client';
import { useEffect, useState } from 'react';
import { Button, Icon, EmptyState } from '@noxh/ui';
import type {
  AiProposal,
  FormRelease,
  OnlineCase,
  OnlineCaseInput,
  OnlineProcedure,
} from '@noxh/contracts';
async function request(path: string, body?: unknown, method = 'GET', version?: number) {
  const r = await fetch('/api/workflow/' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(version === undefined ? {} : { 'If-Match': String(version) }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.detail ?? 'Không thực hiện được');
  return value;
}
interface Services {
  procedures: OnlineProcedure[];
  cases: OnlineCase[];
  forms: FormRelease[];
  sync: { notice: string };
}
function useServices(id: string) {
  const [data, setData] = useState<Services>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    request('dossiers/' + id + '/services')
      .then((v) => {
        if (live) setData(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return { data, setData, error, setError };
}
export function ProjectForms({ id }: { id: string }) {
  const { data, error } = useServices(id);
  return (
    <>
      <span className="kicker">BIỂU MẪU / HƯỚNG DẪN DỰ ÁN</span>
      <h2>Mẫu nguồn và cách chuẩn bị</h2>
      <p>
        Tải mẫu gốc, đọc hướng dẫn và điền theo trường hợp của bạn. Mỗi bản hướng dẫn gắn với một
        nguồn và phiên bản.
      </p>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải mẫu dự án…</p>}
      {data && !data.forms.length && (
        <EmptyState
          title="Chủ đầu tư chưa công bố mẫu cho dự án"
          description="Mẫu chỉ xuất hiện sau khi chủ đầu tư rà soát nguồn và hướng dẫn áp dụng."
        />
      )}
      {data?.forms.map((f) => (
        <article className="member-card" key={f.id}>
          <span className="status-badge green">
            {f.mode === 'buy' ? 'Mua' : f.mode === 'rent-buy' ? 'Thuê mua' : 'Thuê'} · Nhóm{' '}
            {f.subject_group} · Bản {f.version}
          </span>
          <h3>{f.title}</h3>
          <p>
            <strong>Nơi nhận:</strong> {f.recipient}
          </p>
          <p className="request-message">{f.instructions}</p>
          <small>
            Công bố {new Date(f.created_at).toLocaleDateString('vi-VN')} · Mã nguồn{' '}
            {f.source_hash.slice(0, 12)}
          </small>
          <p>
            <a className="text-button" href={'/api/forms/' + f.form_id}>
              <Icon name="file" size={15} /> Tải PDF mẫu gốc
            </a>
          </p>
        </article>
      ))}
      <div className="help-note amber">
        <Icon name="shield" />
        <p>
          Giấy xác nhận phải do đúng cơ quan có thẩm quyền xác nhận. Chức năng đọc giấy tờ và xuất
          bộ PDF đã điền đang được triển khai; bản này chưa tạo bộ hồ sơ hoàn chỉnh tự động.
        </p>
      </div>
    </>
  );
}
const statuses: Record<string, string> = {
  submitted: 'Đã nộp',
  processing: 'Đang xử lý',
  additional: 'Cần bổ sung',
  completed: 'Đã có kết quả',
  rejected: 'Không được tiếp nhận / từ chối',
};
const blank: OnlineCaseInput = {
  procedureId: '1.014632',
  reference: '',
  authority: '',
  status: 'submitted',
  note: '',
};
export function OnlineServices({ id }: { id: string }) {
  const { data, setData, error, setError } = useServices(id),
    [editing, setEditing] = useState<OnlineCase>(),
    [form, setForm] = useState<OnlineCaseInput>(blank),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  return (
    <>
      <span className="kicker">CỔNG DỊCH VỤ CÔNG QUỐC GIA</span>
      <h2>Làm thủ tục trực tuyến</h2>
      <p>
        Chọn đúng thủ tục, địa phương và cơ quan trên cổng chính thức. Sau khi nộp, lưu mã biên nhận
        tại đây để theo dõi cùng hồ sơ.
      </p>
      <div className="help-note">
        <Icon name="shield" />
        <p>
          {data?.sync.notice ??
            'Mở cổng chính thức để đăng nhập bằng tài khoản của bạn. Không nhập mật khẩu hoặc OTP dịch vụ công vào NOXH.'}
        </p>
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
      {data?.procedures.map((p) => (
        <article className="member-card" key={p.id}>
          <span className="kicker">THỦ TỤC {p.id}</span>
          <h3>{p.title}</h3>
          <p>{p.appliesTo}</p>
          <p>{p.purpose}</p>
          <a className="text-button" href={p.url} target="_blank" rel="noopener noreferrer">
            Mở trên dichvucong.gov.vn ↗
          </a>
        </article>
      ))}
      <h3 style={{ marginTop: 24 }}>Biên nhận của tôi</h3>
      {!data?.cases.length && (
        <p>Chưa lưu biên nhận. Chỉ nhập mã sau khi đã nộp trên cổng chính thức.</p>
      )}
      {data?.cases.map((c) => (
        <article className="member-card" key={c.id}>
          <span className="status-badge amber">Tự cập nhật · {statuses[c.status]}</span>
          <p>
            <strong>{c.reference}</strong> · {c.authority}
          </p>
          <p className="request-message">{c.note}</p>
          <small>Chưa xác minh qua API · {new Date(c.updated_at).toLocaleString('vi-VN')}</small>
          <p>
            <button
              className="text-button"
              onClick={() => {
                setEditing(c);
                setForm({
                  procedureId: c.procedureId,
                  reference: c.reference,
                  authority: c.authority,
                  status: c.status,
                  note: c.note,
                });
                setMessage('');
              }}
            >
              Cập nhật biên nhận
            </button>
          </p>
        </article>
      ))}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setMessage('');
          try {
            await request(
              'dossiers/' + id + '/online-cases' + (editing ? '/' + editing.id : ''),
              form,
              editing ? 'PUT' : 'POST',
              editing?.version,
            );
            setData(await request('dossiers/' + id + '/services'));
            setForm({ ...blank });
            setEditing(undefined);
            setMessage('Đã lưu thông tin biên nhận vào hồ sơ của bạn.');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Không lưu được');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h3>{editing ? 'Cập nhật biên nhận' : 'Thêm biên nhận đã nộp'}</h3>
        <label>
          Thủ tục
          <select
            className="search-input"
            value={form.procedureId}
            onChange={(e) =>
              setForm({ ...form, procedureId: e.target.value as OnlineCaseInput['procedureId'] })
            }
          >
            {data?.procedures.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.title}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <label>
            Mã biên nhận
            <input
              className="search-input"
              required
              maxLength={120}
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </label>
          <label>
            Cơ quan tiếp nhận
            <input
              className="search-input"
              required
              maxLength={200}
              value={form.authority}
              onChange={(e) => setForm({ ...form, authority: e.target.value })}
            />
          </label>
        </div>
        <label>
          Trạng thái bạn biết
          <select
            className="search-input"
            value={form.status}
            onChange={(e) =>
              setForm({ ...form, status: e.target.value as OnlineCaseInput['status'] })
            }
          >
            {Object.entries(statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ghi chú từ biên nhận
          <textarea
            className="search-input"
            maxLength={1000}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </label>
        <div className="top-actions">
          <Button disabled={busy || !data}>{busy ? 'Đang lưu…' : 'Lưu biên nhận'}</Button>
          {editing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditing(undefined);
                setForm({ ...blank });
              }}
            >
              Hủy sửa
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
export function AiAssistant({ id, dirty }: { id: string; dirty: boolean }) {
  const [enabled, setEnabled] = useState<boolean>(),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [accepted, setAccepted] = useState(false),
    [share, setShare] = useState(false),
    [busy, setBusy] = useState(false),
    [answer, setAnswer] = useState(''),
    [proposals, setProposals] = useState<AiProposal[]>([]),
    [checks, setChecks] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    request('dossiers/' + id + '/assistant')
      .then((v) => {
        if (live) setEnabled(v.enabled);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <>
      <span className="kicker">TRỢ LÝ HỒ SƠ / OPENAI</span>
      <h2>Chuẩn bị cùng trợ lý AI</h2>
      <p>
        Hỏi về việc cần làm, mẫu chủ đầu tư đã công bố, hoặc yêu cầu soạn thông tin khai báo và câu
        hỏi hỗ trợ.
      </p>
      {enabled === false && (
        <div className="help-note amber">
          <Icon name="settings" />
          <p>
            Chủ đầu tư chưa cấu hình và bật OpenAI. Các chức năng khai báo, biểu mẫu và dịch vụ công
            vẫn dùng được.
          </p>
        </div>
      )}
      {dirty && (
        <p className="feedback error">
          Bạn có thay đổi chưa lưu. Lưu bản nháp trước khi dùng hoặc áp dụng đề xuất AI.
        </p>
      )}
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setAnswer('');
          setProposals([]);
          setChecks({});
          try {
            const v = await request(
              'dossiers/' + id + '/assistant',
              { message, accepted, shareDeclaration: share },
              'POST',
            );
            setAnswer(v.answer);
            setProposals(v.proposals);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'AI chưa phản hồi');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Yêu cầu của bạn
          <textarea
            className="search-input"
            required
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Ví dụ: Tôi cần chuẩn bị gì tiếp theo? Hoặc: Hãy soạn câu hỏi về mẫu xác nhận nhà ở để gửi chủ đầu tư."
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            Tôi đồng ý gửi nội dung yêu cầu và hướng dẫn mẫu liên quan tới OpenAI để được hỗ trợ.
            OpenAI xử lý dữ liệu theo chính sách của nhà cung cấp. Không nhập mật khẩu, OTP hay khóa
            bí mật.
          </span>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          <span>
            Cho phép gửi thêm bản khai đã lưu của hồ sơ này, gồm thông tin người khai và thành viên
            hộ gia đình, để AI hỗ trợ theo thông tin của tôi.
          </span>
        </label>
        <Button disabled={busy || !enabled || !accepted || dirty}>
          {busy ? 'AI đang chuẩn bị…' : 'Gửi yêu cầu cho AI'}
        </Button>
      </form>
      {answer && (
        <div className="assistant-answer">
          <span className="kicker">PHẢN HỒI AI · CẦN KIỂM TRA</span>
          <p className="request-message">{answer}</p>
        </div>
      )}
      {proposals.map((p) => (
        <article className="member-card" key={p.id}>
          <span className="status-badge amber">Đề xuất chờ bạn xác nhận</span>
          <h3>{p.kind === 'declaration' ? 'Cập nhật bản khai' : 'Gửi câu hỏi cho chủ đầu tư'}</h3>
          <dl className="proposal-fields">
            {Object.entries(p.payload)
              .filter(([, v]) => v !== null)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>
                    {(
                      {
                        fullName: 'Họ và tên',
                        dateOfBirth: 'Ngày sinh',
                        address: 'Địa chỉ',
                        occupation: 'Nghề nghiệp',
                        message: 'Nội dung câu hỏi',
                      } as Record<string, string>
                    )[k] ?? k}
                  </dt>
                  <dd>{String(v) || '(Để trống)'}</dd>
                </div>
              ))}
          </dl>
          <p>
            Áp dụng cho phiên bản {p.inputVersion}. Hết hiệu lực lúc{' '}
            {new Date(p.expiresAt).toLocaleTimeString('vi-VN')}.{' '}
            {p.kind === 'support'
              ? 'Nội dung câu hỏi sẽ được chia sẻ với chủ đầu tư.'
              : 'Thông tin mới vẫn cần bạn xác nhận lại ở bước Kiểm tra.'}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={checks[p.id] ?? false}
              onChange={(e) => setChecks({ ...checks, [p.id]: e.target.checked })}
            />
            <span>
              Tôi đã xem nội dung và đồng ý{' '}
              {p.kind === 'support'
                ? 'gửi câu hỏi này tới chủ đầu tư'
                : 'áp dụng các trường hiển thị vào bản khai'}
              .
            </span>
          </label>
          <Button
            disabled={busy || dirty || !checks[p.id]}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await request(
                  'dossiers/' + id + '/assistant/' + p.id + '/confirm',
                  { accepted: true },
                  'POST',
                );
                window.location.reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Chưa áp dụng được');
                setBusy(false);
              }
            }}
          >
            {p.kind === 'support' ? 'Xác nhận gửi câu hỏi' : 'Xác nhận cập nhật bản khai'}
          </Button>
        </article>
      ))}
      <div className="help-note">
        <Icon name="shield" />
        <p>
          AI hiện đọc checklist, mẫu và chuẩn bị đề xuất. AI chưa đọc tệp giấy tờ, ký xác nhận,
          quyết định điều kiện hay nộp hồ sơ trên Cổng Dịch vụ công.
        </p>
      </div>
    </>
  );
}
