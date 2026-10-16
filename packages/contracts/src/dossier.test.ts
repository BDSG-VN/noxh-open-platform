import { expect, it } from 'vitest';
import { DeclarationSchema, emptyDeclaration, preparationReadiness } from './dossier';
it('scores only confirmed available preparation evidence and never legal eligibility', () => {
  expect(preparationReadiness(emptyDeclaration).score).toBe(0);
  const full = {
    ...emptyDeclaration,
    fullName: 'SYNTHETIC',
    dateOfBirth: '2000-01-01',
    address: 'SYNTHETIC',
    housingSituation: 'renting' as const,
    confirmed: true,
  };
  const a = preparationReadiness(full, '2026-10-15');
  expect(a.score).toBe(45);
  expect(a.missing).toEqual(['documents', 'forms']);
  expect(preparationReadiness(full, '2026-10-15')).toEqual(a);
  expect(a.disclaimer).toContain('không phải kết luận đủ điều kiện');
  expect(preparationReadiness({ ...full, confirmed: false }).score).toBeLessThan(45);
});
it('strictly validates fields and calendar dates', () => {
  expect(
    DeclarationSchema.safeParse({ ...emptyDeclaration, dateOfBirth: '2000-02-29' }).success,
  ).toBe(true);
  for (const dateOfBirth of ['2001-02-29', '2000-13-01', '2026-1-1'])
    expect(DeclarationSchema.safeParse({ ...emptyDeclaration, dateOfBirth }).success).toBe(false);
  expect(DeclarationSchema.safeParse({ ...emptyDeclaration, role: 'org_admin' }).success).toBe(
    false,
  );
});

it('explains preparation evidence without treating a safe scan as identity or legal verification', () => {
  const d = {
    ...emptyDeclaration,
    fullName: 'GIẢ LẬP',
    dateOfBirth: '2000-01-01',
    address: 'GIẢ LẬP',
    housingSituation: 'renting' as const,
    confirmed: true,
  };
  const evidence = {
    inputVersion: 4,
    documents: [
      {
        id: 'doc',
        type: 'identity',
        scanStatus: 'quarantined',
        sha256: 'a'.repeat(64),
        version: 1,
      },
    ],
    forms: [
      {
        id: 'pdf',
        formId: 'sample',
        status: 'confirmed',
        inputVersion: 3,
        active: true,
        sha256: 'b'.repeat(64),
        version: 2,
        mappingId: 'mapping',
        mappingVersion: 2,
        releaseId: 'release',
        releaseVersion: 3,
      },
    ],
  };
  let r = preparationReadiness(d, '2026-10-16', evidence);
  expect(r.score).toBe(45);
  expect(r.items.find((i) => i.code === 'documents')?.reasonCode).toBe('scan-pending');
  expect(r.items.find((i) => i.code === 'forms')?.reasonCode).toBe('form-input-stale');
  evidence.documents[0]!.scanStatus = 'clean';
  evidence.forms[0]!.inputVersion = 4;
  r = preparationReadiness(d, '2026-10-16', evidence);
  expect(r.score).toBe(100);
  expect(r.items.find((i) => i.code === 'forms')?.evidence[0]).toMatchObject({
    id: 'pdf',
    mappingVersion: 2,
    releaseVersion: 3,
  });
  expect(r.disclaimer).toContain('Điểm 100 không chứng minh danh tính');
  evidence.forms[0]!.active = false;
  expect(preparationReadiness(d, '2026-10-16', evidence).score).toBe(80);
});

it('requires each configured type/form and fails closed when guidance is revoked', () => {
  const d = { ...emptyDeclaration };
  const checklist = {
    id: 'policy',
    version: 2,
    title: 'Hướng dẫn giả lập',
    instructions: 'Chỉ hướng dẫn chuẩn bị, chưa phải quy định pháp lý.',
    sourceReference: 'Nguồn giả lập',
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    status: 'approved' as const,
    created_by: 'editor',
    approved_by: 'reviewer',
    created_at: '2026-01-01',
    approved_at: '2026-01-02',
    documentTypes: ['identity', 'income'] as ('identity' | 'income')[],
    formIds: ['sample-a', 'sample-b'],
  };
  const evidence = {
    inputVersion: 1,
    checklist,
    documents: [
      { id: 'doc', type: 'identity', scanStatus: 'clean', sha256: 'a'.repeat(64), version: 2 },
    ],
    forms: [],
  };
  const r = preparationReadiness(d, '2026-10-16', evidence);
  expect(r.categories.find((c) => c.code === 'documents')?.score).toBe(17);
  expect(r.missing).toContain('document:income');
  expect(r.configurationState).toBe('active');
  const unavailable = preparationReadiness(d, '2026-10-16', {
    ...evidence,
    configurationUnavailable: true,
  });
  expect(unavailable.score).toBe(0);
  expect(unavailable.configurationState).toBe('unavailable');
  expect(unavailable.items.find((i) => i.code === 'document:identity')?.reasonCode).toBe(
    'checklist-unavailable',
  );
});
