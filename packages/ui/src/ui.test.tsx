import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Card, CardTitle } from './index';
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
