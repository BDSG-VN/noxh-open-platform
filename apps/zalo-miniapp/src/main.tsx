import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Project, PrivacyWorkspace } from '@noxh/contracts';
// Loaded only after a verified session reaches the dashboard; keeps the entry chunk small.
const MiniDossierWorkspace = lazy(() => import('./MiniDossierWorkspace'));
import { isZaloEnvironment, requestZaloToken, ZaloChannel, type MiniDashboard } from './channel';
import '@noxh/ui/fonts.css';
import './style.css';
import { WorkspaceLifecycle } from './workspace-lifecycle';
const inZalo = isZaloEnvironment(navigator.userAgent);
function App() {
  const [channel] = useState(() => {
      try {
        return new ZaloChannel();
      } catch {
        return null;
      }
    }),
    [enabled, setEnabled] = useState(false),
    [stage, setStage] = useState<'login' | 'phone' | 'verify' | 'link' | 'confirm' | 'dashboard'>(
      'login',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [phone, setPhone] = useState(''),
    [code, setCode] = useState(''),
    [accepted, setAccepted] = useState(false),
    [confirmation, setConfirmation] = useState(false),
    [dashboard, setDashboard] = useState<MiniDashboard>(),
    [workspaceId, setWorkspaceId] = useState(''),
    [projects, setProjects] = useState<Project[]>([]),
    [privacy, setPrivacy] = useState<PrivacyWorkspace>(),
    [privacyChecked, setPrivacyChecked] = useState(false),
    [newProject, setNewProject] = useState('');
  const lifecycle = useRef(new WorkspaceLifecycle());
  useEffect(() => {
    let active = true;
    lifecycle.current.mount();
    channel
      ?.status()
      .then((v) => {
        if (active) setEnabled(v.enabled);
      })
      .catch(() => {
        if (active) setError('Chưa kết nối được dịch vụ đăng nhập.');
      });
    return () => {
      active = false;
      lifecycle.current.unmount();
      channel?.clear();
    };
  }, [channel]);
  async function run(action: (assertCurrent: () => void) => Promise<void>) {
    if (!lifecycle.current.startAction()) return;
    const ticket = lifecycle.current.beginLoad();
    const assertCurrent = () => {
      if (!lifecycle.current.accepts(ticket))
        throw new Error('Phiên đã đóng. Hãy mở lại Mini App.');
    };
    setBusy(true);
    setError('');
    try {
      await action(assertCurrent);
    } catch (e) {
      if (lifecycle.current.accepts(ticket))
        setError(e instanceof Error ? e.message : 'Chưa thực hiện được.');
    } finally {
      lifecycle.current.finishAction();
      if (lifecycle.current.accepts(ticket)) setBusy(false);
    }
  }
  async function openDashboard() {
    const [d, p, n] = await Promise.all([
      channel!.dashboard(),
      channel!.projects(),
      channel!.privacy(),
    ]);
    setDashboard(d);
    setProjects(p.items);
    setPrivacy(n);
    setPrivacyChecked(false);
    setWorkspaceId('');
    setStage('dashboard');
  }
  const web = import.meta.env.VITE_CITIZEN_WEB_URL ?? 'http://localhost:3000';
  return (
    <main id="noi-dung" tabIndex={-1}>
      <small>BDSG FOUNDATION · KÊNH ZALO</small>
      <h1>
        Tiếp tục hồ sơ
        <br />
        của bạn.
      </h1>
      <p>
        Mở lại tài khoản điện thoại đã liên kết, theo dõi bản khai và việc cần chuẩn bị. Đăng nhập
        Zalo không xác nhận danh tính pháp lý hoặc điều kiện nhà ở xã hội.
      </p>
      {!inZalo && (
        <div className="notice">
          Bạn đang dùng trình duyệt. Tính năng SDK cần mở bên trong Zalo thật; bạn vẫn có thể dùng
          cổng công dân.
        </div>
      )}
      {!channel && <p role="alert">Chưa cấu hình địa chỉ API HTTPS cho Mini App.</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {busy && <p role="status">Đang xử lý…</p>}
      {stage === 'login' && (
        <section>
          <h2>Đăng nhập bằng Zalo</h2>
          <p>
            Chỉ mã tài khoản Zalo được xác minh ở máy chủ. Không cần chia sẻ tên, ảnh đại diện hoặc
            mật khẩu Zalo.
          </p>
          <button
            disabled={!channel || !enabled || !inZalo || busy}
            onClick={() =>
              run(async (assertCurrent) => {
                const token = await requestZaloToken();
                assertCurrent();
                const result = await channel!.exchange(token);
                assertCurrent();
                if (result.sessionEstablished) await openDashboard();
                else {
                  setStage('phone');
                  setAccepted(false);
                }
              })
            }
          >
            Tiếp tục bằng tài khoản Zalo
          </button>
          {!enabled && channel && (
            <p>Chủ đầu tư chưa mở đăng nhập Mini App hoặc dịch vụ chưa sẵn sàng.</p>
          )}
        </section>
      )}
      {stage === 'phone' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await channel!.requestPhone(phone, accepted);
              setStage('verify');
              setCode('');
            });
          }}
        >
          <h2>Liên kết với tài khoản điện thoại</h2>
          <p>
            Tài khoản Zalo chưa liên kết. Nhập số điện thoại tài khoản của bạn; mã xác thực sẽ được
            gửi qua dịch vụ Zalo do chủ đầu tư cấu hình.
          </p>
          <label>
            Số điện thoại
            <input
              type="tel"
              required
              autoComplete="tel"
              maxLength={24}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            Tôi đồng ý dùng số điện thoại để nhận mã và liên kết với tài khoản Zalo này.
          </label>
          <button disabled={busy || !accepted}>Gửi mã xác thực</button>
        </form>
      )}
      {stage === 'verify' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await channel!.verifyPhone(code);
              setStage('link');
              setConfirmation(false);
            });
          }}
        >
          <h2>Xác thực số điện thoại</h2>
          <p>Nhập mã 6 chữ số đã nhận. Không chia sẻ mã cho người khác.</p>
          <label>
            Mã xác thực
            <input
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <button disabled={busy}>Kiểm tra mã</button>
          <button type="button" disabled={busy} onClick={() => setStage('phone')}>
            Yêu cầu mã mới
          </button>
        </form>
      )}
      {stage === 'link' && (
        <section>
          <h2>Chuẩn bị liên kết</h2>
          <p>
            Phiên điện thoại phải được xác thực trong 5 phút gần nhất. Liên kết không tự gộp hai tài
            khoản đã có hồ sơ riêng.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await channel!.startLink(true);
                setStage('confirm');
                setConfirmation(false);
              })
            }
          >
            Xem yêu cầu liên kết
          </button>
        </section>
      )}
      {stage === 'confirm' && (
        <section>
          <h2>Xác nhận liên kết tài khoản</h2>
          <p>
            Tài khoản Zalo hiện tại sẽ mở đúng hồ sơ của tài khoản điện thoại vừa xác thực. Nếu một
            định danh đã gắn với tài khoản khác, hệ thống sẽ dừng để đối chiếu riêng.
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={confirmation}
              onChange={(e) => setConfirmation(e.target.checked)}
            />
            Tôi đã kiểm tra và đồng ý liên kết hai kênh đăng nhập của chính mình.
          </label>
          <button
            disabled={busy || !confirmation}
            onClick={() =>
              run(async () => {
                await channel!.confirmLink(confirmation);
                await openDashboard();
              })
            }
          >
            Xác nhận liên kết và mở hồ sơ
          </button>
        </section>
      )}
      {stage === 'dashboard' && workspaceId && (
        <Suspense fallback={<p role="status">Đang tải hồ sơ…</p>}>
          <MiniDossierWorkspace
            key={workspaceId}
            id={workspaceId}
            channel={channel!}
            onBack={() => run(openDashboard)}
          />
        </Suspense>
      )}
      {stage === 'dashboard' && dashboard && !workspaceId && (
        <section>
          <h2>Hồ sơ của tôi</h2>
          <p>Tài khoản: {dashboard.phoneMasked ?? 'Đã liên kết'}</p>
          {!dashboard.dossiers.length && (
            <p>Chưa có hồ sơ chuẩn bị. Bạn có thể chọn dự án bên dưới.</p>
          )}
          {dashboard.dossiers.map((d) => (
            <article key={d.id} className="notice">
              <h3>{d.project_name}</h3>
              <p>
                Bản khai {d.version} · {d.status === 'draft' ? 'Đang chuẩn bị' : 'Đã lưu trữ'}
              </p>
              <button disabled={busy || d.status !== 'draft'} onClick={() => setWorkspaceId(d.id)}>
                Mở và tiếp tục hồ sơ
              </button>
            </article>
          ))}
          <h3>Bắt đầu hồ sơ chuẩn bị</h3>
          {privacy?.notice && !privacy.accepted && (
            <details className="notice">
              <summary>Đọc thông báo dữ liệu trước khi gửi thông tin</summary>
              <p>Phiên bản {privacy.notice.version}</p>
              {Object.entries(privacy.notice)
                .filter(([key]) =>
                  [
                    'controller',
                    'contact',
                    'purposes',
                    'categories',
                    'legalBasis',
                    'recipients',
                    'retention',
                    'transfers',
                    'safeguards',
                    'rights',
                    'consequences',
                    'governance',
                  ].includes(key),
                )
                .map(([key, value]) => (
                  <p key={key}>{String(value)}</p>
                ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={privacyChecked}
                  onChange={(e) => setPrivacyChecked(e.target.checked)}
                />
                Tôi đã đọc và đồng ý thông báo hiện hành. Gửi tệp sang OpenAI cần lựa chọn riêng.
              </label>
              <button
                disabled={busy || !privacyChecked}
                onClick={() =>
                  run(async () => {
                    await channel!.acceptPrivacy(privacy.notice!.id, privacy.notice!.content_hash);
                    await openDashboard();
                  })
                }
              >
                Ghi nhận đồng ý
              </button>
            </details>
          )}
          {!privacy?.notice && <p>Chưa có thông báo dữ liệu được duyệt; chưa thể tạo hồ sơ mới.</p>}
          {privacy?.restricted && (
            <p>
              Bạn đang hạn chế xử lý. Có thể xem hồ sơ hiện có hoặc điều chỉnh lựa chọn ở cổng công
              dân.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const d = await channel!.createDossier(newProject);
                setWorkspaceId(d.id);
              });
            }}
          >
            <label>
              Dự án đã công bố
              <select value={newProject} required onChange={(e) => setNewProject(e.target.value)}>
                <option value="">Chọn dự án</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.synthetic ? ' · diễn tập' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button disabled={busy || !newProject || !privacy?.accepted || privacy.restricted}>
              Tạo hoặc mở hồ sơ dự án
            </button>
          </form>
        </section>
      )}
      {stage !== 'login' && (
        <button
          disabled={busy}
          onClick={() =>
            run(async () => {
              const ending = channel!.logout();
              setStage('login');
              setDashboard(undefined);
              setWorkspaceId('');
              setPrivacy(undefined);
              setProjects([]);
              setPrivacyChecked(false);
              setPhone('');
              setCode('');
              setAccepted(false);
              setConfirmation(false);
              await ending;
            })
          }
        >
          Đóng phiên và quay lại
        </button>
      )}
      <p>
        <a href={web} rel="noopener noreferrer" target="_blank">
          Mở cổng công dân ↗
        </a>
      </p>
      <footer>
        Token chỉ giữ trong bộ nhớ của phiên Mini App. Cổng web yêu cầu đăng nhập riêng; không
        chuyển token qua liên kết.
      </footer>
    </main>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
