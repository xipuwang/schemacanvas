/** SA-01: a new Crow's Foot / Physical "View of" sheet opens with non-overlapping tables (real app). */
import { mkdirSync } from 'node:fs';
import { expect, openApp, openExample, settle, test } from '../acceptance/helpers';

const SHOTS = '.tmp/vertical/pw';
mkdirSync(SHOTS, { recursive: true });

async function overlappingPairs(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const r = [...document.querySelectorAll('.sc-canvas [data-node-id]')].map((n) => [n.textContent!.slice(0, 12), n.getBoundingClientRect()] as const);
    const out: string[] = [];
    for (let i = 0; i < r.length; i++)
      for (let j = i + 1; j < r.length; j++) {
        const a = r[i]![1];
        const b = r[j]![1];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(`${r[i]![0]}~${r[j]![0]}`);
      }
    return out;
  });
}

for (const [label, index] of [["Crow's Foot ERD", 1], ['Physical model', 2]] as const) {
  test(`${label} view of the Pharmacy model opens without overlapping tables`, async ({ page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'relational');
    await page.locator('button[aria-label="New diagram"], .sheet-tabs button').last().click();
    await page.locator('[role=menuitem]').filter({ hasText: 'View of' }).nth(index).click();
    await settle(page, 1200);
    expect(await page.locator('.sc-canvas [data-node-id]').count()).toBe(8);
    expect(await overlappingPairs(page)).toEqual([]);
  });
}
