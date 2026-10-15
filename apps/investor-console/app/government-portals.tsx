import { governmentPortals } from '@noxh/contracts';
export default function GovernmentPortals() {
  return (
    <div className="stack">
      <div className="feedback">
        <strong>Danh mục cổng chính thức · kiểm tra ngày 15/10/2026.</strong> Hiện hỗ trợ mở cổng và
        tra cứu. Chưa có API được cấp quyền để tự nộp, ký số hoặc đồng bộ trạng thái; không nhập tài
        khoản, mật khẩu hay OTP của cơ quan nhà nước vào NOXH Open Platform.
      </div>
      <div className="form-grid">
        {governmentPortals.map((p) => (
          <section key={p.id} className="surface">
            <div className="surface-body stack">
              <span className="status-badge blue">
                {p.mode === 'lookup' ? 'Tra cứu chính thức' : 'Mở cổng thực hiện thủ tục'}
              </span>
              <h2>{p.name}</h2>
              <p>{p.stage}</p>
              <p>{p.instructions}</p>
              <a className="button-link" href={p.url} target="_blank" rel="noopener noreferrer">
                Mở cổng chính thức ↗
              </a>
              <a href={p.source} target="_blank" rel="noopener noreferrer">
                Nguồn kiểm tra ↗
              </a>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
