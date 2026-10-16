'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@noxh/ui';

type Proposal = {
  id: string;
  signerId: string;
  cursor: { sequence: string; eventCount: string; head: string };
};
type Status = {
  trustedKeysConfigured: boolean;
  trustedSignerIds: string[];
  databaseHead: { sequence: string; head: string };
  latestStoredCheckpoint: { proposal: Proposal; signature: string } | null;
  notice: string;
};
type Page = {
  proposal: Proposal;
  events: unknown[];
  nextAfterSequence: string | null;
  segmentOnly: true;
  notice: string;
};
async function call(path = '', body?: unknown) {
  const response = await fetch('/api/admin/audit/checkpoints' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail ?? 'Không thực hiện được thao tác kiểm chứng.');
  return value;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
export default function AuditCheckpointAdmin() {
  const requestId = useRef<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [signer, setSigner] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposalId, setProposalId] = useState('');
  const [page, setPage] = useState<Page | null>(null);
  const [after, setAfter] = useState('0');
  const [pageNumber, setPageNumber] = useState(1);
  const [envelope, setEnvelope] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function refresh() {
    const value = (await call()) as Status;
    setStatus(value);
    setSigner((s) => s || value.trustedSignerIds[0] || '');
  }
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thực hiện được.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <section className="surface completion-panel">
        <div className="surface-head">
          <div>
            <h2>Checkpoint nhật ký có chữ ký</h2>
            <p>Đối chiếu toàn bộ chuỗi tới một mốc được ký bằng khóa Ed25519 đã đăng ký.</p>
          </div>
          <Button disabled={busy} onClick={() => run(refresh)}>
            Cập nhật trạng thái
          </Button>
        </div>
        <div className="surface-body stack">
          {status && (
            <>
              <p>
                Đầu nhật ký trong cơ sở dữ liệu: thứ tự{' '}
                <strong>{status.databaseHead.sequence}</strong>. Mốc đã nhập gần nhất:{' '}
                <strong>
                  {status.latestStoredCheckpoint?.proposal.cursor.sequence ?? 'Chưa có'}
                </strong>
                .
              </p>
              <p className="feedback">{status.notice}</p>
              {status.latestStoredCheckpoint && (
                <Button
                  onClick={() => download('signed-checkpoint.json', status.latestStoredCheckpoint)}
                >
                  Tải mốc có chữ ký đã nhập
                </Button>
              )}
            </>
          )}
          {status && !status.trustedKeysConfigured && (
            <p className="feedback">
              Chưa cấu hình khóa công khai tin cậy cho tổ chức. Đơn vị vận hành cần cấu hình
              AUDIT_CHECKPOINT_TRUSTED_KEYS trên máy chủ; chức năng ký và xác minh chưa sẵn sàng.
            </p>
          )}
          <p>
            Chỉ quản trị toàn tổ chức được truy cập. Người lập đề nghị và người nhập mốc phải khác
            tài khoản. Chữ ký không tự chứng minh bản lưu đã được giữ ngoài hệ thống.
          </p>
        </div>
      </section>
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
      <section className="surface completion-panel">
        <div className="surface-head">
          <h3>1. Lập đề nghị và chuyển cho người giữ khóa</h3>
        </div>
        <div className="surface-body stack">
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const value = await call('/proposals', {
                  requestId: (requestId.current ??= crypto.randomUUID()),
                  signerId: signer,
                });
                requestId.current = null;
                setProposal(value.proposal);
                setProposalId(value.proposal.id);
                setPage(null);
                setAfter('0');
                setPageNumber(1);
                await refresh();
                setMessage('Đã tạo đề nghị bất biến. Tải JSON để ký bằng công cụ ngoại tuyến.');
              });
            }}
          >
            <label>
              Khóa công khai đã đăng ký
              <select
                className="search-input"
                required
                value={signer}
                onChange={(e) => {
                  requestId.current = null;
                  setSigner(e.target.value);
                }}
              >
                <option value="">Chọn người giữ khóa</option>
                {status?.trustedSignerIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <Button disabled={busy || !status?.trustedKeysConfigured} type="submit">
                Tạo đề nghị kiểm chứng
              </Button>
            </div>
          </form>
          {proposal && (
            <>
              <p>
                Mã đề nghị: <code>{proposal.id}</code> · {proposal.cursor.eventCount} sự kiện.
              </p>
              <div>
                <Button onClick={() => download('audit-proposal.json', proposal)}>
                  Tải đề nghị JSON
                </Button>
              </div>
            </>
          )}
          <p>
            Khóa bí mật chỉ dùng với công cụ ngoại tuyến. Không tải khóa bí mật lên ứng dụng hoặc
            dán vào biểu mẫu.
          </p>
        </div>
      </section>
      <details className="surface">
        <summary className="surface-head">
          <strong>2. Tải bằng chứng theo trang</strong>
        </summary>
        <div className="surface-body stack">
          <p>
            Mỗi trang tối đa 500 sự kiện. Tải tuần tự từ trang 1; từng trang riêng lẻ không chứng
            minh nhật ký đầy đủ. Tệp có thể chứa định danh nhân sự trong nhật ký, cần lưu ở nơi
            riêng được phân quyền.
          </p>
          <label>
            Mã đề nghị
            <input
              className="search-input"
              value={proposalId}
              onChange={(e) => {
                setProposalId(e.target.value);
                setAfter('0');
                setPageNumber(1);
                setPage(null);
              }}
            />
          </label>
          <div>
            <Button
              disabled={busy || !proposalId || (page !== null && page.nextAfterSequence === null)}
              onClick={() =>
                run(async () => {
                  const value = (await call(
                    '/proposals/' +
                      encodeURIComponent(proposalId) +
                      '/evidence?afterSequence=' +
                      encodeURIComponent(after),
                  )) as Page;
                  setPage(value);
                  download('page-' + String(pageNumber).padStart(6, '0') + '.json', value);
                  setAfter(value.nextAfterSequence ?? after);
                  setPageNumber((n) => n + 1);
                  setMessage(
                    value.nextAfterSequence === null
                      ? 'Đã tải trang cuối. Hãy kiểm toàn bộ trang với mốc có chữ ký đã ghim độc lập.'
                      : 'Đã tải trang bằng chứng. Tiếp tục tải trang kế tiếp.',
                  );
                })
              }
            >
              Tải trang {pageNumber}
            </Button>
          </div>
          {page && (
            <p>
              {page.events.length} sự kiện trong trang vừa tải. {page.notice}
            </p>
          )}
        </div>
      </details>
      <section className="surface completion-panel">
        <div className="surface-head">
          <h3>3. Nhập mốc có chữ ký hoặc kiểm chứng</h3>
        </div>
        <div className="surface-body stack">
          <p>
            Chọn tệp JSON chỉ chứa đề nghị và chữ ký. Kiểm chứng chỉ xác nhận đầy đủ tới mốc được
            cung cấp; đối chiếu hash và bản mới nhất từ kho độc lập theo quy trình vận hành.
          </p>
          <label>
            Tệp checkpoint có chữ ký
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void run(async () => {
                  if (file.size > 65_536) throw new Error('Tệp checkpoint tối đa 64 KiB.');
                  const text = await file.text();
                  const value = JSON.parse(text) as Record<string, unknown>;
                  if (Object.keys(value).sort().join(',') !== 'proposal,signature')
                    throw new Error('Chỉ nhận đề nghị và chữ ký; không tải khóa bí mật.');
                  setEnvelope(text);
                  setResult(null);
                  setMessage('Đã đọc tệp. Chưa nhập hoặc xác minh trên máy chủ.');
                });
              }}
            />
          </label>
          {envelope && <p>Đã chọn tệp JSON có chữ ký.</p>}
          <div className="action-row">
            <Button
              disabled={busy || !envelope || !status?.trustedKeysConfigured}
              onClick={() =>
                run(async () => {
                  const value = await call('/verify', JSON.parse(envelope));
                  setResult(value);
                  setMessage('Đã kiểm chứng tới mốc có chữ ký.');
                })
              }
            >
              Kiểm chứng với nhật ký
            </Button>{' '}
            <Button
              disabled={busy || !envelope || !status?.trustedKeysConfigured}
              onClick={() =>
                run(async () => {
                  setResult(await call('/imports', JSON.parse(envelope)));
                  await refresh();
                  setMessage('Đã nhập mốc có chữ ký và ghi nhật ký.');
                })
              }
            >
              Nhập mốc vào tổ chức
            </Button>
          </div>
          {result && (
            <div className="feedback">
              <p>
                {result.completeToCheckpoint === true
                  ? 'Chuỗi đầy đủ từ đầu tới checkpoint đã cung cấp.'
                  : 'Máy chủ đã xử lý checkpoint.'}
              </p>
              {result.currentHeadMatches === false && (
                <p>Nhật ký hiện có sự kiện sau mốc này; kết quả không bao phủ những sự kiện đó.</p>
              )}
              <p>
                Hash checkpoint:{' '}
                <code style={{ overflowWrap: 'anywhere' }}>
                  {String(result.checkpointHash ?? '')}
                </code>
              </p>
              <p>Việc lưu giữ ngoài hệ thống chưa được chứng nhận.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
