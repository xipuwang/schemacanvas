import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = '.tmp/repair';
mkdirSync(SHOTS, { recursive: true });

/** Open the Pharmacy example on its Relational Schema sheet (several tables: a real ELK run). */
async function openPharmacyRelational(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await page.getByRole('button', { name: 'Open an example' }).click();
  const dlg = page.getByRole('dialog', { name: 'Examples' });
  await dlg.getByRole('radio', { name: 'Relational schema' }).click();
  await dlg.getByTestId('examples-search').fill('Pharmacy');
  await dlg.getByRole('radio', { name: /Pharmacy/ }).first().click();
  await dlg.getByTestId('examples-open').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { selected: true })).toContainText(/Relational/);
}

const nodePositions = (page: Page): Promise<string> =>
  page.locator('[data-layer="nodes"] > [data-node-id]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-node-id')}:${e.getBoundingClientRect().x.toFixed(1)},${e.getBoundingClientRect().y.toFixed(1)}`).join('|'));

test.describe('auto-layout busy state (ELK runs in a worker)', () => {
  test('the toolbar button shows a spinner and is disabled while laying out, and Esc cancels without changing the diagram', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openPharmacyRelational(page);
    // hold the ELK worker script so the busy window is long enough to observe
    await page.route(/elk-worker/, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    const before = await nodePositions(page);
    expect(before.length).toBeGreaterThan(0);
    const button = page.getByRole('button', { name: 'Auto-layout' });
    await button.click();
    const busy = page.getByRole('button', { name: 'Laying out…' });
    await expect(busy).toBeVisible();
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByText('Laying out the diagram. Press Esc to cancel.')).toBeAttached();
    await page.screenshot({ path: `${SHOTS}/layout-busy.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Auto-layout' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Laying out…' })).toHaveCount(0);
    // cancelled: nothing moved, no error
    await page.waitForTimeout(3000);
    expect(await nodePositions(page)).toBe(before);
    expect(errors).toEqual([]);
  });

  test('without Esc the layout completes, the button returns to idle', async ({ page }) => {
    await openPharmacyRelational(page);
    const button = page.getByRole('button', { name: 'Auto-layout' });
    await button.click();
    await expect(page.getByRole('button', { name: 'Laying out…' })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Auto-layout' })).toBeEnabled();
  });
});
