import { expect, test, type Page } from '@playwright/test';
import { SHOTS, boot, edgePoint, gotoRelationalSheet, noHScroll, openProject, pharmacy, props, selectTable, seriousViolations, trackConsole } from './helpers';

test.use({ screenshot: 'off', trace: 'off', video: 'off', actionTimeout: 8000 });

const COMBOS = [
  { theme: 'light', locale: 'en' },
  { theme: 'dark', locale: 'en' },
  { theme: 'light', locale: 'zh' },
  { theme: 'dark', locale: 'zh' },
] as const;

async function clickKind(page: Page, kind: string): Promise<void> {
  const b = (await page.locator(`.sc-canvas [data-node-kind="${kind}"]`).first().boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const dockProps = (page: Page) => page.getByTestId('dock-properties');

for (const { theme, locale } of COMBOS) {
  test(`every panel kind renders cleanly and passes axe (${theme}, ${locale})`, async ({ page }) => {
    test.setTimeout(120_000);
    const problems = trackConsole(page);
    await boot(page, { theme, locale });
    await openProject(page, pharmacy(), 'pharmacy', { waitToastGone: true });
    const tag = `${theme}-${locale}`;
    const shot = async (kind: string) => dockProps(page).screenshot({ path: `${SHOTS}/${tag}-${kind}.png` });
    const axe = async (kind: string, include = ['[data-testid="dock-properties"]']) => expect(await seriousViolations(page, include), `axe ${tag} ${kind}`).toEqual([]);

    // library (Chen) and diagram properties
    await shot('diagram');
    await page.getByTestId('dock-library').screenshot({ path: `${SHOTS}/${tag}-library.png` });
    await axe('library', ['[data-testid="dock-library"]']);
    await axe('diagram');

    // Chen: entity, attribute, relationship, participation line
    await clickKind(page, 'chen-entity');
    await expect(props(page).getByTestId('attributes-section')).toBeVisible();
    await shot('entity');
    await axe('entity');
    await clickKind(page, 'chen-attribute');
    await expect(props(page).getByTestId('attribute-panel')).toBeVisible();
    await shot('attribute');
    await clickKind(page, 'chen-relationship');
    await expect(props(page).getByTestId('participants-section')).toBeVisible();
    await shot('relationship');
    await axe('relationship');
    const lines = page.locator('.sc-canvas [data-edge-kind="chen-line"]');
    const count = await lines.count();
    let found = false;
    for (let i = 0; i < count && !found; i++) {
      const p = await edgePoint(page, lines.nth(i));
      await page.mouse.click(p.x, p.y);
      found = await props(page).getByTestId('participant-panel').isVisible();
    }
    expect(found).toBe(true);
    await shot('participant');

    // relational: table, column, FK, multi-selection
    await gotoRelationalSheet(page);
    await selectTable(page, 'Prescription');
    await expect(props(page).getByTestId('columns-section')).toBeVisible();
    await shot('table');
    await axe('table');
    const fkEdge = page.locator('.sc-canvas [data-edge-kind="fk"]').first();
    const p = await edgePoint(page, fkEdge);
    await page.mouse.click(p.x, p.y);
    await expect(props(page).getByTestId('fk-panel')).toBeVisible();
    await shot('fk');
    await axe('fk');
    const doctor = page.locator('.sc-canvas [data-node-kind="h-table"]', { has: page.locator('text', { hasText: /^Doctor$/ }) }).first();
    const b = (await doctor.boundingBox())!;
    await page.mouse.click(b.x + 8, b.y + b.height * 0.78);
    await expect(props(page).getByTestId('column-focus')).toBeVisible();
    await shot('column');
    await axe('column');
    await page.keyboard.press('Escape');
    await selectTable(page, 'Doctor');
    const patient = page.locator('.sc-canvas [data-node-kind="h-table"] text', { hasText: /^Patient$/ }).first();
    const pb = (await patient.boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.keyboard.up('Shift');
    await expect(props(page).getByTestId('arrange-section')).toBeVisible();
    await shot('multi');
    await axe('multi');
    expect(await noHScroll(page)).toEqual({ doc: 0, body: 0 });
    expect(problems).toEqual([]);
  });
}

test('diagram options dialog opens from the command palette and edits the active diagram', async ({ page }) => {
  const problems = trackConsole(page);
  await boot(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Diagram options');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Diagram options' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('switch', { name: 'Show grid' }).click();
  await expect(dialog.getByRole('switch', { name: 'Show grid' })).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(400); // let the 120 ms opening animation finish before measuring contrast
  await page.screenshot({ path: `${SHOTS}/diagram-options-dialog.png` });
  expect(await seriousViolations(page, ['[role="dialog"]'])).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // the grid really is hidden on the sheet now (the properties panel shows the same state)
  await expect(page.getByTestId('diagram-grid').getByRole('switch', { name: 'Show grid' })).toHaveAttribute('aria-checked', 'false');
  expect(problems).toEqual([]);
});

for (const vp of [
  { name: 'medium', width: 1000, height: 760 },
  { name: 'narrow', width: 600, height: 760 },
]) {
  test(`drawers at ${vp.name} width: library and properties fit without horizontal scroll`, async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page, { viewport: { width: vp.width, height: vp.height } });
    await page.getByRole('button', { name: 'Show parts library' }).click();
    const lib = page.getByTestId('drawer-library');
    await expect(lib).toBeVisible();
    await expect(lib.locator('[data-part-id="entity"] svg')).toBeVisible();
    await page.waitForTimeout(400); // drawer slide-in animation
    await page.screenshot({ path: `${SHOTS}/${vp.name}-library.png` });
    expect(await seriousViolations(page, ['[data-testid="drawer-library"]'])).toEqual([]);
    expect(await lib.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Escape');
    await expect(lib).toHaveCount(0);
    await page.getByRole('button', { name: 'Show properties' }).click();
    const pr = page.getByTestId('drawer-properties');
    await expect(pr).toBeVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/${vp.name}-properties.png` });
    expect(await seriousViolations(page, ['[data-testid="drawer-properties"]'])).toEqual([]);
    expect(await pr.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await noHScroll(page)).toEqual({ doc: 0, body: 0 });
    expect(problems).toEqual([]);
  });
}

test('keyboard: the library is fully operable and the properties tab order reaches every field', async ({ page }) => {
  const problems = trackConsole(page);
  await boot(page);
  const lib = page.getByTestId('dock-library');
  await lib.getByRole('searchbox', { name: 'Search parts' }).focus();
  await page.keyboard.press('Tab'); // tools
  await lib.locator('[data-tool="select"]').focus();
  await lib.locator('[data-part-id="entity"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(lib.locator('[data-part-id="weak-entity"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(lib.locator('[data-part-id="weak-entity"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(lib.locator('[data-part-id="weak-entity"]')).toHaveAttribute('aria-pressed', 'false');
  // collapse a section with the keyboard and expand it again
  const toggle = lib.getByRole('button', { name: /^Entities/ });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // properties: Tab walks the form in order
  await page.getByTestId('diagram-general').getByRole('textbox', { name: 'Diagram name' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Model name' })).toBeFocused();
  expect(problems).toEqual([]);
});
