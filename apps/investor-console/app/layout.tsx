import type { Metadata } from 'next';
import { SkipLink } from '@noxh/ui';
import '@noxh/ui/styles.css';
import './operations-workspaces.css';
import './investor-workspaces.css';
export const metadata: Metadata = {
  title: 'Không gian chủ đầu tư · NOXH Open Platform',
  description:
    'Giải pháp mã nguồn mở của BDSG Foundation. Quản trị dự án, hồ sơ và vận hành nhà ở xã hội.',
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
