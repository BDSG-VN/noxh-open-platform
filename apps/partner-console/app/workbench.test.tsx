import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PartnerWorkbench from './workbench';
import type { PartnerRole } from '@noxh/contracts';
function workspace(role: PartnerRole) {
  return {
    actor: {
      organizationId: 'org',
      userId: 'synthetic-user',
      partnerId: 'synthetic-partner',
      memberId: 'synthetic-member',
      role,
      partnerName: 'ĐƠN VỊ GIẢ LẬP',
      name: 'NHÂN VIÊN GIẢ LẬP',
    },
    projects: [],
    campaigns: [],
    members: [],
    counts: { new: 0, processing: 0, closed: 0 },
  };
}
it('shows a consultant the assigned-customer workspace without personnel administration', () => {
  const html = renderToStaticMarkup(
    <PartnerWorkbench
      initial={workspace('consultant')}
      initialTab="overview"
      citizenUrl="http://localhost:3000"
    />,
  );
  expect(html).toContain('Khách được giao');
  expect(html).toContain('Chuyên viên tư vấn');
  expect(html).not.toContain('Nhân viên &amp; phân quyền');
});
it('allows agency manager personnel setup while campaign managers have campaign tools', () => {
  const manager = renderToStaticMarkup(
    <PartnerWorkbench
      initial={workspace('campaign_manager')}
      initialTab="campaigns"
      citizenUrl="http://localhost:3000"
    />,
  );
  expect(manager).toContain('Tạo chiến dịch');
  expect(manager).not.toContain('Nhân viên &amp; phân quyền');
  const admin = renderToStaticMarkup(
    <PartnerWorkbench
      initial={workspace('partner_admin')}
      initialTab="team"
      citizenUrl="http://localhost:3000"
    />,
  );
  expect(admin).toContain('Cấp tài khoản đăng nhập');
  expect(admin).toContain('Chuyên viên tư vấn');
});
