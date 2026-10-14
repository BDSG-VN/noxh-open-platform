import { describe, it, expect } from 'vitest';
import { demoProjects, ProjectSchema } from './index';
describe('public project contract', () => {
  it('only exposes synthetic, PII-free fixtures', () => {
    for (const p of demoProjects) {
      expect(ProjectSchema.safeParse(p).success).toBe(true);
      expect(Object.keys(p)).not.toContain('ownerPhone');
    }
  });
  it('rejects a real-data fixture', () =>
    expect(ProjectSchema.safeParse({ ...demoProjects[0], synthetic: false }).success).toBe(false));
});
