/** Regenerate from the actual application protocol: node --import tsx crates/audit-verifier/tests/fixtures/generate-node-fixture.ts */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { auditHash } from '../../../../apps/api/src/audit';
const org = '10000000-0000-4000-8000-000000000001';
let previous = '0'.repeat(64);
const events = [
  {
    id: '70000000-0000-4000-8000-000000000001',
    actor_ref: 'DIỄN TẬP — người kiểm tra 👩🏽‍💻',
    action: 'hồ_sơ.đã_nhận',
    resource_ref: 'Tệp "giả lập" \\ mẫu\n\t\b\f\r\u0000\u001f / <>& \u2028 \u2029',
    occurred_at: '2026-10-15T07:00:00.001Z',
    sequence: '1',
  },
  {
    id: '70000000-0000-4000-8000-000000000002',
    actor_ref: 'e\u0301 không chuẩn hóa thành é',
    action: 'biểu_mẫu.đối_chiếu',
    resource_ref: 'Dữ liệu GIẢ LẬP — không có hồ sơ thật',
    occurred_at: '2026-10-15T07:00:00.001Z',
    sequence: 4,
  },
  {
    id: '70000000-0000-4000-8000-000000000003',
    actor_ref: 'nhân sự giả lập',
    action: 'hồ_sơ.kiểm_tra',
    resource_ref: 'Nguồn tổng hợp: kiểm thử UTF-8',
    occurred_at: '2026-10-15T06:59:59.999Z',
    sequence: '9007199254740993',
  },
].map((value) => {
  const row = { ...value, organization_id: org, prev_hash: previous, event_hash: '' };
  row.event_hash = auditHash(row);
  previous = row.event_hash;
  return row;
});
writeFileSync(
  resolve('crates/audit-verifier/tests/fixtures/node-golden.json'),
  JSON.stringify({ events, expectedOrganizationId: org }, null, 2) + '\n',
);
writeFileSync(
  resolve('crates/audit-verifier/tests/fixtures/node-golden-result.json'),
  JSON.stringify({ valid: true, checked: events.length, head: previous }, null, 2) + '\n',
);
