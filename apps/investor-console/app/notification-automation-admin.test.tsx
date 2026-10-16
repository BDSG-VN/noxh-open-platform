import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  NotificationAutomationEventView,
  NotificationAutomationPolicyView,
} from '@noxh/contracts';
import NotificationAutomationAdmin, {
  AutomationEventHistory,
  AutomationPolicyReview,
} from './notification-automation-admin';

const policy: NotificationAutomationPolicyView = {
  id: 'policy-1',
  eventType: 'application.approved',
  templateId: 'template-1',
  templateName: 'Kết quả xét duyệt',
  status: 'draft',
  version: 2,
  createdBy: 'author',
  reviewedBy: null,
  note: null,
};
const renderReview = (subject: string, permissions: string[], status = policy.status) =>
  renderToStaticMarkup(
    <AutomationPolicyReview
      policy={{ ...policy, status }}
      staff={{ subject, permissions }}
      busy={false}
      review={() => undefined}
    />,
  );

describe('automation decision and history presentation', () => {
  it('does not claim a verified enabled or disabled runtime before the workspace loads', () => {
    const html = renderToStaticMarkup(
      <NotificationAutomationAdmin project="project-1" templates={[]} />,
    );
    expect(html).toContain('Chưa xác định trạng thái bộ xử lý');
    expect(html).toContain('Tự động hóa mặc định tắt');
    expect(html).not.toContain('Bộ xử lý tự động đang tắt');
    expect(html).not.toContain('Đang bật xử lý diễn tập');
  });
  it('withholds approval controls from author and unprivileged staff', () => {
    const own = renderReview('author', ['form_legal_approver']);
    const viewer = renderReview('other', []);
    expect(own).toContain('Người soạn không tự duyệt');
    expect(own).not.toContain('<button');
    expect(viewer).not.toContain('<button');
  });
  it('independent review starts unconfirmed and exposes only decisions valid for state', () => {
    const draft = renderReview('reviewer', ['form_legal_approver']);
    expect(draft).toContain('Duyệt chính sách');
    expect(draft).toContain('Từ chối chính sách');
    expect(draft).not.toContain('Thu hồi chính sách');
    expect(draft).not.toContain('checked=""');
    expect(draft).toContain('disabled=""');
    const approved = renderReview('reviewer', ['form_legal_approver'], 'approved');
    expect(approved).toContain('Thu hồi chính sách');
    expect(approved).not.toContain('Duyệt chính sách');
    expect(renderReview('reviewer', ['form_legal_approver'], 'revoked')).toBe('');
  });
  it('shows terminal skip evidence without retry, raw reason code, or private recipient identity', () => {
    const event: NotificationAutomationEventView = {
      id: 'event-1',
      eventType: 'application.supplement-requested',
      applicationCode: 'HS-DEMO-01',
      applicationVersion: 7,
      status: 'skipped',
      reason: 'preference_unavailable',
      attemptCount: 1,
      createdAt: '2026-10-16T04:00:00Z',
      processedAt: '2026-10-16T04:00:02Z',
      messageId: null,
    };
    const html = renderToStaticMarkup(<AutomationEventHistory events={[event]} />);
    expect(html).toContain('HS-DEMO-01');
    expect(html).toContain('Phiên bản hồ sơ 7');
    expect(html).toContain('Lựa chọn nhận thông báo trong ứng dụng chưa cho phép');
    expect(html).toContain('Đã bỏ qua');
    expect(html).not.toContain('preference_unavailable');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('event-1');
  });
});
