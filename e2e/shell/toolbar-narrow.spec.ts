import { expect, test } from '@playwright/test';
import { boot } from '../panels-a/helpers';

/** Regression (i18n-a11y-01): between ~700 and ~854 px the toolbar used to clip its right-edge controls. */
for (const width of [720, 800, 850]) {
  test(`every toolbar control is reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width: width, height: 800 });
    await page.goto('/');
    const bar = page.getByRole('toolbar');
    await expect(bar).toBeVisible();
    // clipped content must be user-scrollable (overflow:hidden made it unreachable)
    const clip = await bar.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, ox: getComputedStyle(el).overflowX }));
    if (clip.over) expect(['auto', 'scroll']).toContain(clip.ox);
    const buttons = bar.getByRole('button');
    const n = await buttons.count();
    expect(n).toBeGreaterThan(6);
    for (let i = 0; i < n; i++) {
      const b = buttons.nth(i);
      if (!(await b.isVisible()) || !(await b.isEnabled())) continue;
      await b.scrollIntoViewIfNeeded();
      const box = (await b.boundingBox())!;
      const vw = page.viewportSize()!.width;
      expect(box.x, (await b.getAttribute('aria-label')) ?? undefined).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vw + 0.5);
      await b.click({ trial: true, timeout: 3000 });
    }
    const settings = bar.getByRole('button', { name: /settings/i });
    await settings.scrollIntoViewIfNeeded();
    await settings.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
}

test('a fresh composite attribute dropped from the library has distinct children and no validation error', async ({ page }) => {
  await boot(page);
  const sheet = page.locator('.sc-canvas').first();
  const lib = page.getByTestId('dock-library');
  await lib.locator('[data-part-id="entity"]').dragTo(sheet, { targetPosition: { x: 300, y: 250 } });
  await expect(page.locator('.sc-inline-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await lib.locator('[data-part-id="composite"]').dragTo(sheet, { targetPosition: { x: 300, y: 250 } });
  await expect(sheet.locator('[data-node-id]')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await expect(sheet.locator('text', { hasText: /^Part 1$/ })).toHaveCount(1);
  await expect(sheet.locator('text', { hasText: /^Part 2$/ })).toHaveCount(1);
  await page.waitForTimeout(800);
  const label = (await page.getByTestId('status-issues').getAttribute('aria-label')) ?? '';
  expect(label).not.toMatch(/[1-9]\d* error/i);
});
