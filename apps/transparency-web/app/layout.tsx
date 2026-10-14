import type { Metadata } from 'next';
import '@noxh/ui/styles.css';
export const metadata: Metadata = {
  title: 'Cổng minh bạch · NOXH Open Platform',
  description: 'Giải pháp mã nguồn mở của BDSG Foundation. Sprint 0, dữ liệu giả lập.',
  robots: { index: false, follow: false },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
