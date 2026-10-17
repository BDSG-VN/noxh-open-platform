import type { Metadata } from 'next';
import { SkipLink } from '@noxh/ui';
import '@noxh/ui/styles.css';
export const metadata: Metadata = {
  title: 'Đối tác & tư vấn viên · NOXH Open Platform',
  description:
    'BDSG Foundation · Quản lý chiến dịch, nhân viên và yêu cầu tư vấn theo quyền được giao.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
