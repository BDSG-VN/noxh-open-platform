import type { Metadata } from 'next';
import { SkipLink } from '@noxh/ui';
import '@noxh/ui/styles.css';
export const metadata: Metadata = {
  title: 'Nhà ở xã hội, hành trình rõ ràng · NOXH Open Platform',
  description:
    'Giải pháp mã nguồn mở của BDSG Foundation. Khám phá dự án và chuẩn bị hồ sơ riêng tư.',
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
