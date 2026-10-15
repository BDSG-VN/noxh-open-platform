'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState } from '@noxh/ui';
import {
  applicationRequest,
  documentTypes,
  type SubmissionOptions,
} from '../../applications/application-ui';
const groups = [
  'Người có công với cách mạng, thân nhân liệt sĩ',
  'Hộ nghèo, cận nghèo tại nông thôn',
  'Hộ tại nông thôn vùng thiên tai, biến đổi khí hậu',
  'Hộ nghèo, cận nghèo tại đô thị',
  'Người thu nhập thấp tại đô thị',
  'Công nhân, người lao động tại doanh nghiệp',
  'Lực lượng vũ trang, cơ yếu thuộc phạm vi quy định',
  'Cán bộ, công chức, viên chức',
  'Người đã trả lại nhà ở công vụ',
  'Hộ, cá nhân bị thu hồi đất, giải tỏa theo quy định',
  'Học sinh, sinh viên (thuê trong thời gian học)',
  'Doanh nghiệp, hợp tác xã tại khu công nghiệp (nhà lưu trú công nhân)',
  'Người có từ 2 con đẻ trở lên (cần rà soát hướng dẫn áp dụng)',
];
export default function SubmissionWorkspace({
  id,
  dirty = false,
}: {
  id: string;
  dirty?: boolean;
}) {
  const router = useRouter(),
    [data, setData] = useState<SubmissionOptions>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [group, setGroup] = useState(''),
    [mode, setMode] = useState('buy');
  const attempt = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      applicationRequest('dossiers/' + id + '/submission'),
      applicationRequest('dossiers/' + id + '/documents'),
    ])
      .then(([v, docs]) => {
        if (live)
          setData({
            ...v,
            documents: v.documents.map((d: { id: string }) => ({
              ...d,
              name: docs.items.find((f: { id: string; name: string }) => f.id === d.id)?.name,
            })),
          });
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [id, dirty]);
  const eligibleToSend = Boolean(
    data &&
    data.confirmed &&
    data.privacyAccepted &&
    data.rounds.length &&
    data.documents.length &&
    !dirty,
  );
  return (
    <div className="dossier-process stack">
      <span className="kicker">TIẾP NHẬN / XÁC NHẬN GỬI HỒ SƠ</span>
      <h2>Kiểm tra trước khi nộp</h2>
      <p>
        Hồ sơ chuẩn bị chỉ chuyển thành hồ sơ tiếp nhận sau thao tác gửi riêng ở đây. Tiếp nhận
        không đồng nghĩa đủ điều kiện, được mua/thuê hay được chọn căn. Chủ đầu tư thẩm định theo
        căn cứ và quy trình được áp dụng.
      </p>
      {error && (
        <p role="alert" className="feedback error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Đang kiểm tra đợt tiếp nhận và giấy tờ…</p>}
      {dirty && (
        <p className="help-note amber">
          Bạn có thông tin chưa lưu. Lưu bản khai và kiểm tra lại trước khi gửi.
        </p>
      )}
      {data && (
        <>
          <div className="member-card">
            <h3>Điều kiện kỹ thuật để gửi</h3>
            <ul>
              <li>{data.confirmed ? '✓' : '○'} Bản khai hiện tại đã được bạn xác nhận</li>
              <li>
                {data.privacyAccepted ? '✓' : '○'} Đã đọc và đồng ý thông báo bảo vệ dữ liệu hiện
                hành — <a href="/privacy">xem quyền riêng tư</a>
              </li>
              <li>{data.rounds.length ? '✓' : '○'} Có đợt tiếp nhận đang mở</li>
              <li>{data.documents.length ? '✓' : '○'} Có giấy tờ đã quét an toàn để lựa chọn</li>
            </ul>
            <p>
              Điểm chuẩn bị và đề xuất AI không thay kết quả thẩm định. Hãy đối chiếu đủ danh mục
              giấy tờ/hướng dẫn của dự án; các dấu kiểm trên chỉ là điều kiện kỹ thuật.
            </p>
          </div>
          {!data.rounds.length && (
            <EmptyState
              title="Chưa có đợt tiếp nhận đang mở"
              description="Bạn vẫn có thể chuẩn bị bản khai, giấy tờ và biểu mẫu. Đợt mới sẽ hiện sau khi chủ đầu tư công bố."
            />
          )}
          <form
            className="surface"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!eligibleToSend) return;
              const fd = new FormData(e.currentTarget);
              if (!fd.getAll('document').length) {
                setError('Chọn ít nhất một giấy tờ đã quét an toàn để gửi.');
                return;
              }
              const body = {
                roundId: fd.get('round'),
                inputVersion: data.inputVersion,
                documentIds: fd.getAll('document'),
                generatedFormIds: fd.getAll('form'),
                mode,
                subjectGroup: Number(group),
                noticeId: data.noticeId,
                accepted: true,
                noConcurrentHouseholdApplication: true,
              };
              const serialized = JSON.stringify(body);
              if (attempt.current?.body !== serialized)
                attempt.current = { body: serialized, key: crypto.randomUUID() };
              setBusy(true);
              setError('');
              try {
                const r = await applicationRequest(
                  'dossiers/' + id + '/applications',
                  body,
                  'POST',
                  { idempotencyKey: attempt.current.key },
                );
                router.push('/applications/' + r.id);
                router.refresh();
              } catch (ex) {
                setError(ex instanceof Error ? ex.message : 'Chưa gửi được');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Đợt tiếp nhận
              <select name="round" required disabled={busy || !data.rounds.length}>
                {data.rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · đến {new Date(r.closes_at).toLocaleString('vi-VN')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Nhóm đối tượng bạn đề nghị xem xét
              <select
                required
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  if (['11', '12'].includes(e.target.value)) setMode('rent');
                }}
              >
                <option value="">Chọn nhóm theo hướng dẫn dự án</option>
                {groups.map((label, i) => (
                  <option key={i + 1} value={i + 1}>
                    Nhóm {i + 1}: {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hình thức đăng ký
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="buy" disabled={group === '11' || group === '12'}>
                  Mua
                </option>
                <option value="rent-buy" disabled={group === '11' || group === '12'}>
                  Thuê mua
                </option>
                <option value="rent">Thuê</option>
              </select>
            </label>
            {['7', '12', '13'].includes(group) && (
              <p className="help-note amber">
                Trường hợp này cần rà soát chế độ, điều kiện và biểu mẫu chuyên biệt. Việc chọn nhóm
                không phải kết luận được hưởng chính sách; chủ đầu tư phải kiểm tra phạm vi trước
                khi tiếp nhận thực tế.
              </p>
            )}
            <fieldset>
              <legend>Giấy tờ gửi kèm</legend>
              <p>Chỉ những tệp bạn chọn mới được lưu vào hồ sơ gửi chủ đầu tư.</p>
              {data.documents.map((d, i) => (
                <label className="check-row" key={d.id}>
                  <input type="checkbox" name="document" value={d.id} />
                  {d.name ?? (documentTypes[d.type] ?? 'Giấy tờ') + ' ' + (i + 1)} · tải{' '}
                  {new Date(d.created_at).toLocaleDateString('vi-VN')} · {d.sha256.slice(0, 10)}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Biểu mẫu đã điền và kiểm tra (nếu áp dụng)</legend>
              {!data.forms.length && (
                <p>
                  Chưa có bản điền mẫu đã xác nhận. Chọn giấy tờ đã ký/xác nhận trong danh mục giấy
                  tờ ở trên nếu được hướng dẫn áp dụng.
                </p>
              )}
              {data.forms.map((f, i) => (
                <label className="check-row" key={f.id}>
                  <input
                    type="checkbox"
                    name="form"
                    value={f.id}
                    disabled={f.input_version !== data.inputVersion}
                  />
                  Bản điền mẫu {i + 1} · {new Date(f.created_at).toLocaleDateString('vi-VN')}
                  {f.input_version !== data.inputVersion ? ' · thuộc bản khai cũ, cần tạo lại' : ''}
                </label>
              ))}
            </fieldset>
            <label className="check-row">
              <input type="checkbox" required />
              Tôi đã xem bản khai hiện tại, đối chiếu các tệp lựa chọn với yêu cầu dự án và chịu
              trách nhiệm về tính chính xác; hiểu việc gửi cho phép người được phân quyền của chủ
              đầu tư xử lý theo thông báo dữ liệu hiện hành.
            </label>
            <label className="check-row">
              <input type="checkbox" required />
              Tôi xác nhận việc đăng ký của hộ gia đình phù hợp quy định, không gửi đăng ký đồng
              thời trái quy định; sẽ thông báo nếu có thay đổi.
            </label>
            <Button disabled={busy || !eligibleToSend}>
              {busy ? 'Đang gửi…' : 'Xác nhận gửi và nhận biên nhận'}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
