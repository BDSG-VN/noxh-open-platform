import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Layout from './layout';
it('declares Vietnamese and renders its content', () => {
  const html = renderToStaticMarkup(
    <Layout>
      <main>Không gian chủ đầu tư</main>
    </Layout>,
  );
  expect(html).toContain('lang="vi"');
  expect(html).toContain('Không gian chủ đầu tư');
});
