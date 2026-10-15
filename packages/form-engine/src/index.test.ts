import { it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderOfficialForm, createFormPacket, validateStaticPdf } from './index';
import { createHash } from 'node:crypto';
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  const source = await pdf.save();
  return {
    source,
    sourceHash: hash(source),
    font: await readFile(resolve(__dirname, '../assets/DejaVuSerif.ttf')),
    fields: [
      {
        key: 'fullName',
        label: 'Họ tên',
        page: 1,
        x: 100,
        y: 600,
        width: 350,
        height: 30,
        fontSize: 11,
        required: true,
        externalConfirmation: false,
      },
    ],
    values: { fullName: 'NGUYỄN THỊ ÁNH - DỮ LIỆU GIẢ LẬP' },
    trackingId: 'synthetic-0001',
    mappingVersion: 1,
    inputHash: '1'.repeat(64),
    confirmed: false,
    timestamp: '2026-10-15T00:00:00.000Z',
  };
}
it('renders Vietnamese, retains source pages, adds provenance and produces repeatable bytes', async () => {
  const f = await fixture(),
    a = await renderOfficialForm(f),
    b = await renderOfficialForm(f);
  expect(a.sha256).toBe(b.sha256);
  expect(a.missing).toEqual([]);
  expect((await PDFDocument.load(a.bytes)).getPageCount()).toBe(2);
  await mkdir(resolve(__dirname, '../../../tmp/pdfs'), { recursive: true });
  await writeFile(resolve(__dirname, '../../../tmp/pdfs/form-engine-synthetic.pdf'), a.bytes);
});
it('fails closed for changed source, missing values, overflowing text and invalid coordinates', async () => {
  const f = await fixture();
  await expect(renderOfficialForm({ ...f, sourceHash: '0'.repeat(64) })).rejects.toThrow(
    'SOURCE_HASH',
  );
  await expect(renderOfficialForm({ ...f, values: {}, confirmed: true })).rejects.toThrow(
    'MISSING_REQUIRED',
  );
  await expect(
    renderOfficialForm({ ...f, values: { fullName: 'A'.repeat(1000) } }),
  ).rejects.toThrow('OVERFLOW');
  await expect(renderOfficialForm({ ...f, fields: [{ ...f.fields[0]!, x: 590 }] })).rejects.toThrow(
    'BOUNDS',
  );
});

it('validates static parsed PDF and creates bounded packets with safe names', async () => {
  const f = await fixture();
  await expect(validateStaticPdf(f.source)).resolves.toBeUndefined();
  const packet = createFormPacket([
    { name: 'form.pdf', bytes: f.source },
    { name: 'manifest.json', bytes: Buffer.from('{}') },
  ]);
  expect(packet.subarray(0, 4).toString('hex')).toBe('504b0304');
  expect(() => createFormPacket([{ name: '../unsafe.pdf', bytes: f.source }])).toThrow(
    'INVALID_PACKET',
  );
  await writeFile(resolve(__dirname, '../../../tmp/pdfs/form-engine-synthetic.zip'), packet);
});
