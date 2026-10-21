import { expect, test } from '@playwright/test';
import { boot, openProject, pharmacy, trackConsole } from '../panels-a/helpers';

test.describe('panels fixes (real app)', () => {
  test('A11Y-09: Escape closes the diagram options dialog while its name field has focus', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy-fixes');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('Diagram options');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Diagram options' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Diagram name' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('UX-3: raising the font size keeps tables apart and says so', async ({ page }) => {
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy-fixes2');
    await page.getByRole('tab', { name: /Relational/ }).first().click().catch(() => undefined);
    const size = page.getByTestId('diagram-typography').getByLabel('Size', { exact: true });
    await size.fill('26');
    await size.press('Enter');
    await expect(page.getByText(/Moved \d+ tables? apart/)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(size).toHaveValue('14');
  });
});
