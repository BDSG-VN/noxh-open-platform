import { test, expect } from '@playwright/test';
import { pages } from './pages';
import { openCase } from './helpers';

// 390px phone width and 200% zoom (1280px desktop zoomed = 640 CSS px) must not create
// horizontal page scrolling (WCAG 1.4.10 Reflow) and must keep form/text readable.
const viewports = [
  { label: '390px', width: 390, height: 844 },
  { label: '200% zoom', width: 640, height: 450 },
];
for (const c of pages) {
  for (const v of viewports) {
    test(`reflow ${v.label} · ${c.app} ${c.path} · ${c.name}`, async ({ browser }) => {
      const { page, context } = await openCase(browser, c, { width: v.width, height: v.height });
      try {
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const wide: string[] = [];
          for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
            const r = el.getBoundingClientRect();
            if (
              r.right > doc.clientWidth + 1 &&
              r.width > 0 &&
              getComputedStyle(el).position !== 'fixed'
            ) {
              // Elements inside an explicit horizontal scroller are allowed to be wider.
              let p: HTMLElement | null = el.parentElement;
              let scrolls = false;
              while (p && p !== document.body) {
                const o = getComputedStyle(p).overflowX;
                if (o === 'auto' || o === 'scroll' || o === 'hidden') {
                  scrolls = true;
                  break;
                }
                p = p.parentElement;
              }
              if (!scrolls)
                wide.push(
                  `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} right=${Math.round(r.right)}`,
                );
            }
          }
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            bodyScroll: document.body.scrollWidth,
            wide: wide.slice(0, 8),
          };
        });
        expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(
          overflow.clientWidth + 1,
        );
        expect(overflow.bodyScroll, JSON.stringify(overflow)).toBeLessThanOrEqual(
          overflow.clientWidth + 1,
        );
        expect(overflow.wide, JSON.stringify(overflow)).toEqual([]);
        // Reduced motion: no element may run a CSS animation when the user asks for less motion.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const animating = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('*'))
            .filter((el) => {
              const s = getComputedStyle(el);
              return (
                s.animationName !== 'none' &&
                s.animationDuration !== '0s' &&
                s.animationPlayState !== 'paused'
              );
            })
            .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0])
            .slice(0, 5),
        );
        expect(animating, 'animations stop under prefers-reduced-motion').toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
}
