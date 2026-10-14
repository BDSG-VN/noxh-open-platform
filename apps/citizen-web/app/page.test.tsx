import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Layout from './layout';
it('declares Vietnamese and renders its content', () => {
  const html = renderToStaticMarkup(
    <Layout>
      <main>Nhà ở xã hội, hành trình rõ ràng</main>
    </Layout>,
  );
  expect(html).toContain('lang="vi"');
  expect(html).toContain('Nhà ở xã hội, hành trình rõ ràng');
});
