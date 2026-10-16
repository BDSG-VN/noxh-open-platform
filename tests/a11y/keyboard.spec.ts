import { test, expect } from '@playwright/test';
import { pages } from './pages';
import { openCase } from './helpers';

// Keyboard operability: the first Tab lands on a skip link that moves focus into <main>,
// every focusable control is a native interactive element (no div/span click targets),
// and the focused element always shows a visible focus ring.
for (const c of pages) {
  test(`keyboard · ${c.app} ${c.path} · ${c.name}`, async ({ browser }) => {
    const { page, context } = await openCase(browser, c);
    try {
      // 1. The first Tab stop is the skip link; activating it moves focus into <main>.
      await page.keyboard.press('Tab');
      const skip = page.locator(':focus');
      await expect(skip, 'first Tab stop must be the skip link').toHaveAttribute(
        'href',
        /#(noi-dung|main)$/,
      );
      await page.keyboard.press('Enter');
      const target = await page.evaluate(() => {
        const main = document.querySelector('main');
        return main
          ? main.contains(document.activeElement) || main === document.activeElement
          : false;
      });
      expect(target, 'activating the skip link moves focus into <main>').toBe(true);

      const offenders = await page.evaluate(() => {
        const interactive = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
        const bad: string[] = [];
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>('[tabindex], [onclick]'),
        )) {
          if (interactive.has(el.tagName)) continue;
          const role = el.getAttribute('role');
          const ti = el.getAttribute('tabindex');
          if (ti === '-1') continue;
          if (
            !role ||
            !['button', 'link', 'tab', 'menuitem', 'checkbox', 'switch', 'option'].includes(role)
          )
            bad.push(
              `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`,
            );
        }
        return bad;
      });
      expect(offenders, 'custom click targets must be native controls or have a role').toEqual([]);

      // 2. Walk a bounded number of Tab stops from the top of the document: each stop must
      // be visible, inside a landmark (the skip link itself sits above them by design) and
      // show a focus outline (global :focus-visible styles in @noxh/ui).
      await page.locator('.skip-link').focus();
      const seen: string[] = [];
      for (let i = 0; i < 26; i++) {
        if (i > 0) await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const name =
            el.getAttribute('aria-label') ||
            el.textContent?.trim().slice(0, 40) ||
            el.getAttribute('placeholder') ||
            el.id;
          return {
            tag: el.tagName,
            // Chromium tabs through the day/month/year parts of native date pickers and
            // drops :focus-visible on the last part; the control itself still has the ring.
            nativePicker:
              el.tagName === 'INPUT' &&
              ['date', 'datetime-local', 'time', 'month'].includes(el.getAttribute('type') ?? ''),
            name,
            outline: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0,
            boxShadow: style.boxShadow !== 'none',
            visible: rect.width > 0 && rect.height > 0,
            inLandmark:
              el.classList.contains('skip-link') ||
              Boolean(el.closest('main, nav, header, footer, aside, [role="dialog"]')),
          };
        });
        if (!info) break;
        seen.push(`${info.tag}:${info.name}`);
        expect(info.visible, `focused ${info.tag} "${info.name}" is visible`).toBe(true);
        expect(info.inLandmark, `focused ${info.tag} "${info.name}" sits inside a landmark`).toBe(
          true,
        );
        if (!info.nativePicker)
          expect(
            info.outline || info.boxShadow,
            `focused ${info.tag} "${info.name}" has a focus ring`,
          ).toBe(true);
      }
      expect(seen.length, 'page exposes keyboard-reachable controls').toBeGreaterThan(1);
    } finally {
      await context.close();
    }
  });
}
