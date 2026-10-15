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
