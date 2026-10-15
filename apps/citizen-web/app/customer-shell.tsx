import type { ReactNode } from 'react';
import { Workspace } from '@noxh/ui';
import { Logout } from './dashboard/actions';
export default function CustomerShell({
  children,
  dossier = false,
}: {
  children: ReactNode;
  dossier?: boolean;
}) {
  return (
    <Workspace
      audience="Không gian khách hàng"
      active={dossier ? '/dashboard#ho-so' : '/dashboard'}
      nav={[
        { href: '/dashboard', label: 'Tổng quan', icon: 'grid' },
        { href: '/dashboard#ho-so', label: 'Hồ sơ của tôi', icon: 'folder' },
        { href: '/dashboard#tu-van', label: 'Yêu cầu tư vấn', icon: 'chat' },
        { href: '/#du-an', label: 'Khám phá dự án', icon: 'building' },
      ]}
      actions={<Logout />}
    >
      {children}
    </Workspace>
  );
}
