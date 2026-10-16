import { type Browser, type Page } from '@playwright/test';
import type { PageCase } from './pages';
export function urls(): Record<string, string> {
  const raw = process.env.A11Y_URLS;
  if (!raw) throw new Error('A11Y_URLS missing: run through tests/a11y/playwright.config.ts');
  return JSON.parse(raw) as Record<string, string>;
}
export async function openCase(
  browser: Browser,
  c: PageCase,
  viewport = { width: 1280, height: 900 },
) {
  const base = urls()[c.app]!;
  const context = await browser.newContext({ viewport, locale: 'vi-VN' });
  if (c.cookie) {
    const { hostname } = new URL(base);
    await context.addCookies([
      {
        name: c.cookie,
        value: c.cookieValue ?? 'synthetic-session-token',
        domain: hostname,
        path: '/',
      },
    ]);
  }
  const page = await context.newPage();
  const response = await page.goto(base + c.path, { waitUntil: 'networkidle' });
  if (!response || response.status() >= 400)
    throw new Error(`${c.app}${c.path} answered ${response?.status()}`);
  await settle(page);
  return { page, context };
}
export async function settle(page: Page) {
  // Client panels fetch after hydration; give them one more idle cycle.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);
}
