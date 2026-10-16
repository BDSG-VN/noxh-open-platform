import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { pages } from './pages';
import { openCase } from './helpers';

// WCAG 2.1 A/AA via axe-core, plus the structural best-practice rules the design system
// promises (one h1, ordered headings, one main landmark, everything inside a landmark).
const structuralRules = {
  'heading-order': { enabled: true },
  'page-has-heading-one': { enabled: true },
  'landmark-one-main': { enabled: true },
  'landmark-no-duplicate-main': { enabled: true },
  'landmark-no-duplicate-banner': { enabled: true },
  'landmark-no-duplicate-contentinfo': { enabled: true },
  region: { enabled: true },
  'skip-link': { enabled: true },
  'empty-heading': { enabled: true },
  'label-title-only': { enabled: true },
};

for (const c of pages) {
  test(`axe · ${c.app} ${c.path} · ${c.name}`, async ({ browser }) => {
    const { page, context } = await openCase(browser, c);
    try {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .options({ rules: structuralRules })
        .analyze();
      if (process.env.A11Y_REPORT_DIR) {
        // Optional machine-readable dump used when updating docs/VALIDATION.md.
        mkdirSync(process.env.A11Y_REPORT_DIR, { recursive: true });
        writeFileSync(
          join(process.env.A11Y_REPORT_DIR, `${c.app}${c.path.replace(/[^a-z0-9]+/gi, '_')}.json`),
          JSON.stringify(
            {
              app: c.app,
              path: c.path,
              name: c.name,
              violations: results.violations.map((v) => ({
                id: v.id,
                impact: v.impact,
                nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
              })),
            },
            null,
            2,
          ),
        );
      }
      const summary = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.slice(0, 5).map((n) => ({ target: n.target, summary: n.failureSummary })),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
      expect(await page.locator('html').getAttribute('lang')).toBe('vi');
      expect(await page.locator('h1').count()).toBe(1);
    } finally {
      await context.close();
    }
  });
}
