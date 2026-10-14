import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Layout from './layout';
it('declares Vietnamese and renders its content', () => {
  const html = renderToStaticMarkup(
    <Layout>
      <main>Cổng minh bạch</main>
    </Layout>,
  );
  expect(html).toContain('lang="vi"');
  expect(html).toContain('Cổng minh bạch');
});
