import { it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OcrJobView } from '@noxh/contracts';
import { OcrJobCard } from './document-workspace';
const base: OcrJobView = {
  id: '50000000-0000-4000-8000-000000000001',
  documentId: '60000000-0000-4000-8000-000000000001',
  status: 'pending',
  reason: null,
  attemptCount: 0,
  attemptBudget: 3,
  requeueCount: 0,
  nextAttemptAt: null,
  qualityScore: null,
  lowQuality: null,
  engine: null,
  extractionId: null,
  version: 1,
  createdAt: '2026-10-17T00:00:00Z',
  updatedAt: '2026-10-17T00:00:00Z',
};
const render = (job: OcrJobView) =>
  renderToStaticMarkup(
    <OcrJobCard
      job={job}
      base="dossiers/x"
      busy={false}
      threshold={0.6}
      name="CCCD giả lập"
      cancel={() => {}}
    />,
  );
it('offers cancellation only while the job is pending or running', () => {
  expect(render(base)).toContain('Hủy tác vụ OCR');
  expect(render({ ...base, status: 'running' })).toContain('Hủy tác vụ OCR');
  expect(render({ ...base, status: 'cancelled', reason: 'cancelled_by_owner' })).not.toContain(
    'Hủy tác vụ OCR',
  );
});
it('warns about low quality and explains failure reasons in Vietnamese without raw codes', () => {
  const low = render({
    ...base,
    status: 'succeeded',
    attemptCount: 1,
    qualityScore: 0.31,
    lowQuality: true,
    engine: 'tesseract',
    extractionId: base.id,
  });
  expect(low).toContain('Chất lượng nhận dạng thấp');
  expect(low).toContain('60%');
  expect(low).toContain('Xem chữ đã đọc');
  const failed = render({
    ...base,
    status: 'failed',
    reason: 'attempts_exhausted',
    attemptCount: 3,
  });
  expect(failed).toContain('Đã hết số lần thử');
  expect(failed).not.toContain('attempts_exhausted');
});
