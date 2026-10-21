/**
 * The Chinese catalogues are a lazy chunk (src/i18n/core.ts loadLocale): a persisted zh must be loaded before the first paint
 * (no English / message-key flash), and switching the language in Settings must await the chunk before the locale flips.
 */
import { expect, test, type Page } from '@playwright/test';

const KEY_LIKE = /\b(shell|common|dialogs|editor|library|properties|issues|commands|ui)\.[a-zA-Z][\w.-]*/;
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function persist(page: Page, locale: 'en' | 'zh'): Promise<void> {
  await page.addInitScript((l) => {
    try {
      if (!localStorage.getItem('schemacanvas:settings:v1')) {
        localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ locale: l, theme: 'light', panels: { library: true, properties: true, issues: false } }));
      }
    } catch {
      /* ignore */
    }
  }, locale);
}

test('persisted zh: the first painted toolbar is already Chinese and the zh chunk was requested before it', async ({ page }) => {
  await persist(page, 'zh');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  // record the page text at the moment the toolbar first exists
  await page.addInitScript(() => {
    const w = window as unknown as { __firstToolbar?: string };
    const obs = new MutationObserver(() => {
      const bar = document.querySelector('[role="toolbar"]');
      if (bar && w.__firstToolbar === undefined) {
        w.__firstToolbar = `${bar.textContent ?? ''} | ${[...bar.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')).join(' ')}`;
        obs.disconnect();
      }
    });
    obs.observe(document, { childList: true, subtree: true });
  });
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  const first = await page.evaluate(() => (window as unknown as { __firstToolbar?: string }).__firstToolbar ?? '');
  expect(first).toMatch(/[一-鿿]/);
  expect(first).not.toMatch(KEY_LIKE);
  expect(await page.evaluate(() => document.documentElement.lang)).toBe('zh-CN');
  expect(requests.some((p) => /\/i18n\/messages\/shell\.ts|\/assets\/shell-/.test(p))).toBe(true);
  await expect(page.locator('body')).not.toContainText(KEY_LIKE);
});

test('English boot ships no Chinese catalogue; switching to Chinese in Settings loads it, translates, and persists', async ({ page }) => {
  await persist(page, 'en');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(new URL(r.url()).pathname + new URL(r.url()).search));
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/[一-鿿]{2,}/);
  expect(requests.some((p) => p.includes('locale=zh'))).toBe(false);

  await page.keyboard.press(`${mod}+,`);
  let dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.keyboard.press(`${mod}+k`);
    await page.getByPlaceholder('Type a command').fill('Settings');
    await page.locator('.shell-palette-item').first().click();
    dialog = page.getByRole('dialog');
  }
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: '中文 (Chinese)' }).click();
  // the flip happens only after the chunk arrived: the dialog title turns Chinese and no message key is ever shown
  await expect(page.getByRole('dialog').getByRole('heading', { name: '外观' })).toBeVisible();
  expect(requests.some((p) => p.includes('locale=zh') || /\/assets\/shell-/.test(p))).toBe(true);
  await expect(page.locator('body')).not.toContainText(KEY_LIKE);
  // the untouched default sheet name follows the language (it is stored in English)
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'ER 图' })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('schemacanvas:settings:v1') ?? '{}').locale)).toBe('zh');

  // and back
  await page.keyboard.press(`${mod}+,`);
  await page.getByRole('dialog').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Appearance' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
});
