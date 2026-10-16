import type { Metadata } from 'next';
import { SkipLink } from '@noxh/ui';
import '@noxh/ui/styles.css';
import './lottery.css';
export const metadata: Metadata = {
  title: 'Cổng minh bạch · NOXH Open Platform',
  description: 'Cổng theo dõi cam kết và kết quả diễn tập bốc thăm của BDSG Foundation.',
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
