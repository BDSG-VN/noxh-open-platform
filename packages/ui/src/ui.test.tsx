import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Card, CardTitle, EmptyState, SkipLink, Workspace } from './index';
it('preserves disabled semantics and headings', () => {
  expect(renderToStaticMarkup(<Button disabled>Chưa mở</Button>)).toContain('disabled');
  expect(
    renderToStaticMarkup(
      <Card>
        <CardTitle>Dự án mẫu</CardTitle>
      </Card>,
    ),
  ).toContain('<h3');
});
it('keeps outline buttons readable on any surface', () => {
  expect(renderToStaticMarkup(<Button variant="outline">Xem</Button>)).toContain('text-foreground');
});
it('renders the skip link and a single focusable main landmark', () => {
  expect(renderToStaticMarkup(<SkipLink />)).toContain('href="#noi-dung"');
  const html = renderToStaticMarkup(
    <Workspace nav={[]} active="/" audience="Kiểm thử">
      <p>Nội dung</p>
    </Workspace>,
  );
  expect(html).toContain('<main id="noi-dung" tabindex="-1"');
  expect(html).toContain('aria-label="Thanh bên không gian"');
});
it('does not turn empty states into headings', () => {
  const html = renderToStaticMarkup(<EmptyState title="Trống" description="Chưa có dữ liệu" />);
  expect(html).not.toContain('<h3');
  expect(html).toContain('empty-title');
});
