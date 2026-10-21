import { expect, test, type Page } from '@playwright/test';

/** Import a script whose tables have untyped columns, so Validate finds issues (one aggregated warning per table). */
async function importUntyped(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('welcome').getByRole('button', { name: 'Import SQL' }).click();
  const dlg = page.getByRole('dialog', { name: 'Import' });
  await dlg.locator('textarea').first().fill('CREATE TABLE Doctor (ssn, name, phone, PRIMARY KEY (ssn));\nCREATE TABLE Patient (pid, doc, PRIMARY KEY (pid));');
  await dlg.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Records every text change of the polite live regions (the persistence status is not interesting). */
async function watchLive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __live: string[] };
    w.__live = [];
    const seen = new WeakSet<Element>();
    const scan = (): void =>
      document.querySelectorAll('[aria-live],[role=status]').forEach((el) => {
        if (seen.has(el) || el.getAttribute('data-testid') === 'status-persist') return;
        seen.add(el);
        new MutationObserver(() => w.__live.push((el.textContent ?? '').trim())).observe(el, { childList: true, subtree: true, characterData: true });
      });
    scan();
    setInterval(scan, 50);
  });
}
const live = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __live: string[] }).__live);

test('F8 announces the result and moves focus to the first issue row; a mouse click announces but keeps focus', async ({ page }) => {
  await importUntyped(page);
  await watchLive(page);

  // mouse: announced, focus stays on the toolbar button
  const validate = page.getByRole('button', { name: 'Validate model' });
  await validate.click();
  await expect.poll(async () => (await live(page)).some((t) => /^Validation finished: /.test(t))).toBe(true);

  await page.waitForTimeout(200);
  await expect(validate).toBeFocused();

  // keyboard: F8 from the canvas
  await page.evaluate(() => ((window as unknown as { __live: string[] }).__live.length = 0));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('F8');
  await expect.poll(async () => (await live(page)).some((t) => /^Validation finished: /.test(t))).toBe(true);
  const rows = page.locator('.issues-list button.issue-row');
  await expect(rows).toHaveCount(2); // ONE warning per table, not one per column
  expect((await live(page)).some((t) => /^Validation finished: 0 errors, 2 warnings/.test(t))).toBe(true);
  await expect(rows.first()).toBeFocused();
});
