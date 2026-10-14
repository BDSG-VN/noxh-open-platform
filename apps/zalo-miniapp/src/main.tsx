import { createRoot } from 'react-dom/client';
import { isZaloEnvironment } from './channel';
import './style.css';
const inZalo = isZaloEnvironment(navigator.userAgent);
function App() {
  return (
    <main>
      <small>BDSG FOUNDATION · KÊNH ZALO</small>
      <h1>
        Một hồ sơ.
        <br />
        Nhiều cách tiếp cận.
      </h1>
      <p>
        Khung tích hợp SDK chính thức đã được chuẩn bị. Trao đổi token phía máy chủ và liên kết tài
        khoản chưa hoạt động.
      </p>
      <div className="notice">
        {inZalo
          ? 'Đang ở môi trường có dấu hiệu Zalo. Chưa xác minh danh tính.'
          : 'Bạn đang dùng trình duyệt web. Hãy xem cổng công dân.'}
      </div>
      <button disabled>Chưa mở đăng nhập Zalo</button>
      <p>
        <a href={import.meta.env.VITE_CITIZEN_WEB_URL ?? 'http://localhost:3000'}>
          Mở cổng công dân →
        </a>
      </p>
      <footer>Sprint 0 · Không nhập thông tin cá nhân</footer>
    </main>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
