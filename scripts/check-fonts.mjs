import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/form-engine/package.json', import.meta.url));
const fontkit = require('@pdf-lib/fontkit');
const root = new URL('../packages/ui/fonts/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const vietnamese = new Set(
  [...`Đăng ký hồ sơ nhà ở xã hội • Chủ đầu tư • Khách hàng • Đối tác • Thuê, thuê mua, mua`].map(
    (c) => c.codePointAt(0),
  ),
);
for (let cp = 0x1ea0; cp <= 0x1ef9; cp++) vietnamese.add(cp);
let checked = 0;
for (const entry of manifest.files) {
  if (!/^(BeVietnamPro-(Regular|Medium|SemiBold|Bold)\.ttf|OFL\.txt)$/.test(entry.file))
    throw new Error('Unexpected font manifest path');
  const bytes = await readFile(new URL(entry.file, root));
  if (
    bytes.length !== entry.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== entry.sha256
  )
    throw new Error('Font source checksum mismatch: ' + entry.file);
  if (entry.file.endsWith('.ttf')) {
    const font = fontkit.create(bytes),
      supported = new Set(font.characterSet);
    if ([...vietnamese].some((cp) => !supported.has(cp)))
      throw new Error('Vietnamese glyph coverage missing: ' + entry.file);
    checked++;
  }
}
if (checked !== 4) throw new Error('Expected four local font weights');
console.log('Local font source/license hashes and Vietnamese glyph coverage passed for 4 weights.');
