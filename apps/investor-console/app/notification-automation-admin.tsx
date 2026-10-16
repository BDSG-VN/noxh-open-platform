'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  NotificationAutomationWorkspace,
  NotificationAutomationEventType,
  NotificationAutomationPolicyView,
  NotificationTemplateView,
  NotificationAutomationReason,
  NotificationAutomationEventView,
} from '@noxh/contracts';
import { Button } from '@noxh/ui';

const eventLabels: Record<NotificationAutomationEventType, string> = {
  'application.supplement-requested': 'Yêu cầu bổ sung hồ sơ',
  'application.approved': 'Hồ sơ được phê duyệt',
  'application.rejected': 'Hồ sơ bị từ chối',
};
const policyLabels: Record<NotificationAutomationPolicyView['status'], string> = {
  draft: 'Chờ duyệt độc lập',
  approved: 'Đã duyệt',
  rejected: 'Đã từ chối',
  revoked: 'Đã thu hồi',
};
const eventStates: Record<NotificationAutomationEventView['status'], string> = {
  pending: 'Chờ xử lý',
  processing: 'Đang xử lý',
  delivered: 'Đã phát trong ứng dụng',
  skipped: 'Đã bỏ qua',
  failed: 'Xử lý chưa thành công',
};
const reasonLabels: Record<NotificationAutomationReason, string> = {
  no_policy: 'Không có chính sách còn hiệu lực cho mốc nghiệp vụ này.',
  consent_unavailable: 'Chưa đáp ứng yêu cầu về thông báo riêng tư hoặc sự đồng ý của khách.',
  preference_unavailable: 'Lựa chọn nhận thông báo trong ứng dụng chưa cho phép mục đích này.',
  rule_unavailable: 'Hướng dẫn nghiệp vụ của dự án chưa đủ điều kiện áp dụng.',
  template_unavailable: 'Mẫu thông báo không còn đủ điều kiện sử dụng.',
  application_stale: 'Phiên bản hoặc trạng thái hồ sơ đã thay đổi so với sự kiện nguồn.',
  recipient_unavailable: 'Không xác định được người nhận hợp lệ trong phạm vi hồ sơ.',
  processing_restricted: 'Phạm vi xử lý diễn tập hoặc chốt vận hành chưa cho phép.',
  attempts_exhausted: 'Đã hết số lần xử lý cho phép; cần vận hành đối chiếu.',
  idempotency_conflict: 'Dấu vết xử lý trùng không khớp; cần vận hành đối chiếu.',
  processing_failed: 'Chưa xử lý thành công; xem trạng thái cuối cùng từ máy chủ.',
};
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString('vi-VN') : 'Chưa xử lý';

async function call<T>(
  project: string,
  path = '',
  body?: unknown,
  version?: number,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    '/api/admin/notifications/projects/' + encodeURIComponent(project) + '/automation' + path,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(version === undefined ? {} : { 'If-Match': String(version) }),
      },
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.detail ?? 'Chưa thực hiện được thao tác.');
  return value;
}

export function AutomationPolicyReview({
  policy,
  staff,
  busy,
  review,
}: {
  policy: NotificationAutomationPolicyView;
  staff?: { subject: string; permissions?: string[] };
  busy: boolean;
  review: (decision: 'approve' | 'reject' | 'revoke', note: string) => void;
}) {
  const [note, setNote] = useState(''),
    [accepted, setAccepted] = useState(false);
  const own = policy.createdBy === staff?.subject;
  const allowed = staff?.permissions?.includes('form_legal_approver') && !own;
  if (!['draft', 'approved'].includes(policy.status)) return null;
  if (!allowed)
    return (
      <p>
        {own
          ? 'Người soạn không tự duyệt hoặc thu hồi chính sách của mình. Chuyển nhân sự khác có quyền pháp chế rà soát.'
          : 'Cần nhân sự khác người soạn và có quyền duyệt pháp chế để quyết định.'}
      </p>
    );
  return (
    <div className="stack">
      <label>
        Căn cứ quyết định
        <textarea
          minLength={10}
          maxLength={1000}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Nêu phạm vi đã kiểm tra và lý do duyệt, từ chối hoặc thu hồi."
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={accepted}
          disabled={busy}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        <span>Tôi đã kiểm tra mẫu, mốc nghiệp vụ và phạm vi thông báo trong ứng dụng.</span>
      </label>
      <div className="actions">
        {(policy.status === 'draft' ? (['approve', 'reject'] as const) : (['revoke'] as const)).map(
          (decision) => (
            <Button
              key={decision}
              variant={decision === 'approve' ? 'default' : 'outline'}
              disabled={busy || !accepted || note.trim().length < 10}
              onClick={() => review(decision, note.trim())}
            >
              {decision === 'approve'
                ? 'Duyệt chính sách'
                : decision === 'reject'
                  ? 'Từ chối chính sách'
                  : 'Thu hồi chính sách'}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}

export default function NotificationAutomationAdmin({
  project,
  templates,
  staff,
}: {
  project: string;
  templates: NotificationTemplateView[];
  staff?: { subject: string; permissions?: string[] };
}) {
  const [data, setData] = useState<NotificationAutomationWorkspace>(),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false),
    [eventType, setEventType] = useState<NotificationAutomationEventType>(
      'application.supplement-requested',
    ),
    [templateId, setTemplateId] = useState('');
  const retry = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    if (project)
      call<NotificationAutomationWorkspace>(project, '', undefined, undefined, controller.signal)
        .then((value) => setData(value))
        .catch((e: unknown) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : 'Chưa tải được chính sách.');
        });
    return () => controller.abort();
  }, [project]);
  async function run(action: () => Promise<unknown>, message: string, onSuccess?: () => void) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
      setData(await call<NotificationAutomationWorkspace>(project));
      onSuccess?.();
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chưa thực hiện được thao tác.');
    } finally {
      setBusy(false);
    }
  }
  const choices = templates.filter(
    (template) =>
      template.projectId === project &&
      template.status === 'approved' &&
      template.channel === 'in_app' &&
      template.purpose === 'transactional',
  );
  if (!project) return <p>Chọn dự án để xem chính sách thông báo tự động.</p>;
  return (
    <div className="stack">
      <div className="help-note amber">
        <div>
          <strong>
            {!data
              ? 'Chưa xác định trạng thái bộ xử lý'
              : data.enabled
                ? 'Đang bật xử lý diễn tập'
                : 'Bộ xử lý tự động đang tắt'}
          </strong>
          <p>
            Tự động hóa mặc định tắt, chỉ xử lý thông báo nghiệp vụ trong ứng dụng cho dữ liệu diễn
            tập. Chính sách được duyệt không tự bật bộ xử lý và không mở gửi email hoặc Zalo.
          </p>
          {data?.notice && <p>{data.notice}</p>}
        </div>
      </div>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="feedback" role="status">
          {success}
        </p>
      )}
      {!data && !error && <p role="status">Đang tải chính sách và lịch sử sự kiện…</p>}
      {data && (
        <>
          <div className="form-grid" aria-label="Tổng hợp trạng thái sự kiện">
            <article>
              <strong>{data.stats.pending + data.stats.processing}</strong>
              <p>Đang chờ hoặc đang xử lý</p>
            </article>
            <article>
              <strong>{data.stats.delivered}</strong>
              <p>Đã phát trong ứng dụng</p>
            </article>
            <article>
              <strong>{data.stats.skipped}</strong>
              <p>Đã bỏ qua và giữ lý do</p>
            </article>
            <article>
              <strong>{data.stats.failed}</strong>
              <p>Xử lý không thành công</p>
            </article>
          </div>
          <div className="actions">
            <h3>Chính sách theo mốc xử lý hồ sơ</h3>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(async () => undefined, 'Đã làm mới trạng thái từ máy chủ.')}
            >
              Làm mới trạng thái
            </Button>
          </div>
          {!data.policies.length && (
            <p>Chưa có chính sách. Soạn bản nháp rồi chuyển người duyệt độc lập.</p>
          )}
          {data.policies.map((policy) => (
            <details key={policy.id + ':' + policy.version}>
              <summary>
                {eventLabels[policy.eventType]} ·{' '}
                {policyLabels[policy.status] ?? 'Cần đối chiếu trạng thái'}
              </summary>
              <div className="stack">
                <p>
                  Mẫu: <strong>{policy.templateName}</strong> · Phiên bản chính sách{' '}
                  {policy.version}
                </p>
                <p>
                  {policy.createdBy === staff?.subject
                    ? 'Bạn là người soạn.'
                    : 'Do nhân sự khác soạn.'}{' '}
                  {policy.reviewedBy
                    ? 'Đã ghi nhận người rà soát trên máy chủ.'
                    : 'Chưa có quyết định rà soát.'}
                </p>
                {policy.note && <p>Ghi chú rà soát: {policy.note}</p>}
                <AutomationPolicyReview
                  policy={policy}
                  staff={staff}
                  busy={busy}
                  review={(decision, note) =>
                    void run(
                      () =>
                        call(
                          project,
                          '/policies/' + policy.id + '/review',
                          { decision, accepted: true, note },
                          policy.version,
                        ),
                      'Đã ghi nhận quyết định chính sách. Trạng thái sự kiện được kiểm tra lại trên máy chủ.',
                    )
                  }
                />
              </div>
            </details>
          ))}
          <details>
            <summary>Soạn chính sách tự động mới</summary>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                const payload = { eventType, templateId },
                  key = JSON.stringify(payload);
                const idempotencyKey = retry.current.get(key) ?? crypto.randomUUID();
                retry.current.set(key, idempotencyKey);
                void run(
                  async () => {
                    await call(project, '/policies', { ...payload, idempotencyKey });
                  },
                  'Đã lưu bản nháp. Cần người khác duyệt trước khi chính sách có hiệu lực.',
                  () => retry.current.delete(key),
                );
              }}
            >
              <div className="form-grid">
                <label>
                  Mốc nghiệp vụ
                  <select
                    value={eventType}
                    disabled={busy}
                    onChange={(e) =>
                      setEventType(e.target.value as NotificationAutomationEventType)
                    }
                  >
                    {Object.entries(eventLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Mẫu nghiệp vụ trong ứng dụng đã duyệt
                  <select
                    required
                    value={templateId}
                    disabled={busy}
                    onChange={(e) => setTemplateId(e.target.value)}
                  >
                    <option value="">Chọn mẫu</option>
                    {choices.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {!choices.length && (
                <p>
                  Chưa có mẫu đủ điều kiện trong danh sách đã tải. Soạn và duyệt mẫu trong mục thông
                  báo thủ công trước.
                </p>
              )}
              <p>
                Mẫu phải được duyệt, thuộc dự án này, dùng kênh trong ứng dụng và mục đích nghiệp
                vụ. Máy chủ kiểm tra lại khi duyệt và xử lý sự kiện.
              </p>
              <Button disabled={busy || !choices.some((template) => template.id === templateId)}>
                Lưu bản nháp chính sách
              </Button>
            </form>
          </details>
          <AutomationEventHistory events={data.events} />
        </>
      )}
    </div>
  );
}

export function AutomationEventHistory({ events }: { events: NotificationAutomationEventView[] }) {
  return (
    <section aria-label="Lịch sử thông báo tự động" className="stack">
      <h3>Sự kiện gần đây</h3>
      <p>
        Đối chiếu theo mã hồ sơ và phiên bản nguồn. Sự kiện đã bỏ qua được giữ lại cùng lý do; không
        có thao tác gửi lại hoặc chuyển kênh ở đây.
      </p>
      {!events.length && <p>Chưa ghi nhận sự kiện tự động cho dự án này.</p>}
      {events.map((event) => (
        <article className="member-card" key={event.id}>
          <strong>
            {event.applicationCode} · {eventLabels[event.eventType]}
          </strong>
          <p>
            {eventStates[event.status] ?? 'Cần đối chiếu trạng thái'} · Phiên bản hồ sơ{' '}
            {event.applicationVersion} · Đã xử lý {event.attemptCount} lần
          </p>
          {event.reason && <p>Lý do: {reasonLabels[event.reason]}</p>}
          <p>
            Ghi nhận: {date(event.createdAt)} · {date(event.processedAt)}
          </p>
          {event.messageId && (
            <p>
              Đã liên kết thông báo trong hộp thư. Xem nội dung và trạng thái đọc ở mục thông báo
              thủ công.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
