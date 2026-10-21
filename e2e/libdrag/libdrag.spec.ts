import { expect, test, type Page } from '@playwright/test';
import { boot } from '../panels-a/helpers';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

const lib = (page: Page) => page.getByTestId('dock-library');

/** Drag `partId` onto the sheet with raw mouse events (what a user does), while any inline editor stays open. */
async function mouseDrag(page: Page, partId: string, to: { x: number; y: number }): Promise<void> {
  const b = (await lib(page).locator(`[data-part-id="${partId}"]`).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

async function dropFour(page: Page, partId: string, mode: 'mouse' | 'dragTo'): Promise<void> {
  const sheet = page.locator('.sc-canvas').first();
  const box = (await sheet.boundingBox())!;
  const nodes = sheet.locator('[data-node-id]');
  for (let i = 0; i < 4; i++) {
    const pos = { x: 120 + (i % 2) * 330, y: 140 + Math.floor(i / 2) * 240 };
    if (mode === 'mouse') await mouseDrag(page, partId, { x: box.x + pos.x, y: box.y + pos.y });
    else await lib(page).locator(`[data-part-id="${partId}"]`).dragTo(sheet, { targetPosition: pos });
    await expect(nodes).toHaveCount(i + 1);
    const input = page.locator('.sc-inline-input');
    await expect(input).toBeFocused();
    await input.fill(`Part${i}`); // typed but NOT confirmed: the next drag must commit it
  }
  await page.keyboard.press('Enter');
  for (let i = 0; i < 4; i++) await expect(nodes.locator('text', { hasText: new RegExp(`^Part${i}$`) })).toHaveCount(1);
}

for (const mode of ['mouse', 'dragTo'] as const) {
  test(`ER sheet: four library drags in a row with the inline editor open (${mode})`, async ({ page }) => {
    await boot(page);
    await dropFour(page, 'entity', mode);
  });

  test(`relational sheet: four library drags in a row with the inline editor open (${mode})`, async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.locator('[data-item-id="new-relational-schema"]').click();
    await expect(page.getByRole('tab', { name: 'Relational Schema' })).toHaveAttribute('aria-selected', 'true');
    await dropFour(page, 'table', mode);
  });
}
