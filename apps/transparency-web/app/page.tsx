import { api } from '@noxh/contracts/server';
export const dynamic = 'force-dynamic';
export default async function Transparency() {
  let sessions: {
    id: string;
    title: string;
    status: string;
    config: { entries: string[]; seats: number };
  }[] = [];
  let failed = false;
  try {
    const r = await api('/api/v1/lotteries');
    if (!r.ok) throw new Error();
    sessions = (await r.json()).items;
  } catch {
    failed = true;
  }
  return (
    <main className="container section">
      <a className="brand" href="/">
        NOXH Open Platform<small>BDSG Foundation · Minh bạch</small>
      </a>
      <h1>
        Dấu vết công khai.
        <br />
        Dữ liệu riêng tư.
      </h1>
      <p>
        Theo dõi danh sách đã khóa, cam kết và kết quả diễn tập theo mã hồ sơ. Không công bố thông
        tin cá nhân.
      </p>
      <div className="status-panel">
        <strong>Bốc thăm thực tế đang khóa</strong>
        <p>
          Chỉ mở sau thẩm định độc lập và phê duyệt pháp lý. Bộ kiểm chứng sẽ sử dụng mã giả danh,
          không công bố thông tin cá nhân.
        </p>
        <span className="pill">DIỄN TẬP · DỮ LIỆU GIẢ LẬP</span>
      </div>
      {failed && <p role="alert">Chưa kết nối được danh sách phiên; hãy tải lại sau.</p>}
      <div className="lottery-cards">
        {sessions.map((s) => (
          <a className="lottery-card" key={s.id} href={'/lotteries/' + s.id}>
            <span className="status-badge blue">
              {s.status === 'published'
                ? 'Đã công bố'
                : s.status === 'voided'
                  ? 'Đã hủy'
                  : 'Đã công bố cam kết'}
            </span>
            <h2>{s.title}</h2>
            <p>
              {s.config.entries.length} mã hồ sơ · {s.config.seats} suất
            </p>
            <strong>Mở phòng công khai →</strong>
          </a>
        ))}
      </div>
      {!failed && !sessions.length && (
        <p>
          Chưa có phiên công bố cam kết. Phiên chỉ xuất hiện sau khi quy chế và danh sách đã được
          duyệt, khóa và có cam kết.
        </p>
      )}
    </main>
  );
}
