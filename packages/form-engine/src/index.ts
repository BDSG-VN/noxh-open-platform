import { PDFDocument, PDFDict, PDFArray, PDFName, PDFStream, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createHash } from 'node:crypto';
export interface RenderField {
  key: string;
  label: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  required: boolean;
  externalConfirmation: boolean;
}
export interface RenderInput {
  source: Uint8Array;
  sourceHash: string;
  fields: RenderField[];
  values: Record<string, string>;
  font: Uint8Array;
  trackingId: string;
  mappingVersion: number;
  inputHash: string;
  confirmed: boolean;
  debugCoordinates?: boolean;
  timestamp: string;
}
export async function renderOfficialForm(input: RenderInput) {
  if (createHash('sha256').update(input.source).digest('hex') !== input.sourceHash)
    throw new Error('SOURCE_HASH_MISMATCH');
  const pdf = await PDFDocument.load(input.source, {
    updateMetadata: false,
    ignoreEncryption: false,
  });
  if (pdf.getPageCount() > 100) throw new Error('PAGE_LIMIT');
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(input.font, { subset: true });
  const missing: string[] = [];
  for (const f of input.fields) {
    const page = pdf.getPage(f.page - 1),
      value = input.values[f.key] ?? '';
    if (
      !page ||
      f.x < 0 ||
      f.y < 0 ||
      f.x + f.width > page.getWidth() ||
      f.y + f.height > page.getHeight()
    )
      throw new Error('INVALID_FIELD_BOUNDS:' + f.key);
    if (input.debugCoordinates) {
      page.drawRectangle({
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        borderWidth: 0.7,
        borderColor: rgb(0.1, 0.3, 0.8),
        opacity: 0.1,
      });
      if (font.widthOfTextAtSize(f.key, 7) < f.width)
        page.drawText(f.key, {
          x: f.x,
          y: f.y + f.height - 7,
          font,
          size: 7,
          color: rgb(0.1, 0.3, 0.8),
        });
    }
    if (f.required && !value.trim()) missing.push(f.key);
    if (!value) continue;
    const words = Array.from(value)
      .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
      .join('')
      .split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (font.widthOfTextAtSize(next, f.fontSize) > f.width) {
        if (!line || font.widthOfTextAtSize(word, f.fontSize) > f.width)
          throw new Error('FIELD_OVERFLOW:' + f.key);
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length * f.fontSize * 1.2 > f.height) throw new Error('FIELD_OVERFLOW:' + f.key);
    lines.forEach((s, i) =>
      page.drawText(s, {
        x: f.x,
        y: f.y + f.height - f.fontSize - i * f.fontSize * 1.2,
        font,
        size: f.fontSize,
        color: rgb(0, 0, 0),
      }),
    );
  }
  if (input.confirmed && missing.length) throw new Error('MISSING_REQUIRED_FIELDS');
  for (const p of pdf.getPages())
    if (!input.confirmed)
      p.drawText('BẢN NHÁP - CHƯA XÁC NHẬN', {
        x: 48,
        y: p.getHeight() / 2,
        size: 25,
        font,
        rotate: degrees(35),
        color: rgb(0.65, 0.12, 0.12),
        opacity: 0.18,
      });
  // Provenance is appended on a separate sheet; official source wording/margins are preserved.
  const appendix = pdf.addPage([595.28, 841.89]);
  const lines = [
    'THÔNG TIN TẠO BIỂU MẪU',
    `Mã theo dõi: ${input.trackingId}`,
    `Phiên bản ánh xạ: ${input.mappingVersion}`,
    `Trạng thái: ${input.confirmed ? 'Người khai đã kiểm tra' : 'Bản nháp chưa xác nhận'}`,
    `Thời điểm: ${input.timestamp}`,
    `SHA256 mẫu nguồn: ${input.sourceHash}`,
    `SHA256 dữ liệu đầu vào: ${input.inputHash}`,
    'Chỉ là bản điền mẫu; không phải chữ ký số, xác nhận cơ quan hay kết luận đủ điều kiện.',
  ];
  let y = 790;
  for (const l of lines) {
    const chunks = l.match(/.{1,80}/g) ?? [''];
    for (const c of chunks) {
      appendix.drawText(c, { x: 36, y, size: 9, font });
      y -= 18;
    }
  }
  if (missing.length)
    appendix.drawText('Trường còn thiếu: ' + missing.join(', ').slice(0, 100), {
      x: 36,
      y: y - 12,
      size: 9,
      font,
    });
  pdf.setCreationDate(new Date(input.timestamp));
  pdf.setModificationDate(new Date(input.timestamp));
  pdf.setProducer('BDSG NOXH deterministic form engine v1');
  const bytes = await pdf.save({ useObjectStreams: false });
  return { bytes, missing, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export async function validateMappingBounds(source: Uint8Array, fields: RenderField[]) {
  const pdf = await PDFDocument.load(source);
  for (const f of fields) {
    const p = pdf.getPages()[f.page - 1];
    if (!p || f.x + f.width > p.getWidth() || f.y + f.height > p.getHeight())
      throw new Error('INVALID_FIELD_BOUNDS:' + f.key);
  }
}

export async function validateStaticPdf(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
  if (pdf.getPageCount() < 1 || pdf.getPageCount() > 20) throw new Error('PDF_PAGE_LIMIT');
  const forbidden = new Set([
    'JavaScript',
    'JS',
    'Launch',
    'EmbeddedFile',
    'EmbeddedFiles',
    'RichMedia',
    'OpenAction',
    'AA',
    'SubmitForm',
    'ImportData',
    'XFA',
  ]);
  const visited = new Set<unknown>();
  const inspect = (obj: unknown) => {
    if (!obj || visited.has(obj)) return;
    visited.add(obj);
    if (obj instanceof PDFName && forbidden.has(obj.decodeText()))
      throw new Error('ACTIVE_PDF_CONTENT');
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        inspect(k);
        inspect(v);
      }
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) inspect(v);
    } else if (obj instanceof PDFStream) inspect(obj.dict);
  };
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) inspect(obj);
}
// Store-only ZIP: no compression or path extraction is used on customer data.
export function createFormPacket(entries: { name: string; bytes: Uint8Array }[]) {
  if (
    entries.length > 21 ||
    entries.some((e) => !/^[a-zA-Z0-9_.-]+$/.test(e.name)) ||
    new Set(entries.map((e) => e.name)).size !== entries.length
  )
    throw new Error('INVALID_PACKET_ENTRIES');
  let total = 0;
  for (const e of entries) {
    total += e.bytes.length;
    if (total > 20 * 1024 * 1024) throw new Error('PACKET_SIZE_LIMIT');
  }
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    centralSize = 0;
  const crc32 = (bytes: Uint8Array) => {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const e of entries) {
    const name = Buffer.from(e.name),
      crc = crc32(e.bytes),
      header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(e.bytes.length, 18);
    header.writeUInt32LE(e.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, Buffer.from(e.bytes));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x21, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(e.bytes.length, 20);
    c.writeUInt32LE(e.bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    centralSize += c.length + name.length;
    offset += header.length + name.length + e.bytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
