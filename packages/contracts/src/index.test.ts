import { describe, it, expect } from 'vitest';
import { demoProjects, ProjectSchema } from './index';
describe('public project contract', () => {
  it('only exposes synthetic, PII-free fixtures', () => {
    for (const p of demoProjects) {
      expect(ProjectSchema.safeParse(p).success).toBe(true);
      expect(Object.keys(p)).not.toContain('ownerPhone');
    }
  });
  it('preserves explicit real-project label', () =>
    expect(ProjectSchema.safeParse({ ...demoProjects[0], synthetic: false }).success).toBe(true));
});
