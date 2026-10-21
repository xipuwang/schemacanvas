/**
 * INTERACTION fixes on the REAL app (no harness): keyboard context menu, focus vs selection, F6 landmarks, symbol hints
 * (tooltips), the diagram outline, click-to-place rename, cascade delete toast, cardinality label double click.
 *
 *   E2E_PORT=5241 npx playwright test e2e/editor2/interaction.spec.ts --reporter=line --output=.tmp/interaction/results
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, library, openApp, openExample, properties, sheet, test } from '../acceptance/helpers';

test.use({ viewport: { width: 1440, height: 900 } });

const liveKb = (page: Page) => page.getByTestId('canvas-live-kb');

async function newEntity(page: Page, name: string): Promise<void> {
  await sheet(page).focus();
  await page.keyboard.press('e');
  const input = page.locator('.sc-inline-input');
  await expect(input).toBeVisible();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await expect(input).toHaveCount(0);
}

test.describe('A11Y-01: context menu by keyboard', () => {
  test('Shift+F10, arrows, Enter adds a key attribute; the menu owns the keys and the entity keeps its name', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Student');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Context menu' });
    await expect(menu).toBeVisible();
    const item = menu.getByRole('menuitem', { name: /Add key attribute/ });
    await expect(item).toBeVisible();
    for (let i = 0; i < 20 && !(await item.evaluate((n) => n === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    // the item ran: a new attribute is being named (NOT the entity behind the menu)
    const input = page.locator('.sc-inline-input');
    await expect(input).toBeVisible();
    await page.keyboard.type('SID');
    await page.keyboard.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(sheet(page).getByText('SID', { exact: true })).toBeVisible();
    await expect(sheet(page).getByText('Student', { exact: true })).toBeVisible();
    await expect(sheet(page).locator('[data-chen-shape="entity"]')).toHaveCount(1);
  });

  test('Space runs an item (Duplicate) and Escape closes the menu returning focus to the canvas', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Student');
    await page.keyboard.press('Shift+F10');
    const menu = page.getByRole('menu', { name: 'Context menu' });
    await menu.getByRole('menuitem', { name: /Duplicate/ }).focus();
    await page.keyboard.press('Space');
    await expect(menu).toHaveCount(0);
    await expect(sheet(page).locator('[data-chen-shape="entity"]')).toHaveCount(2);
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(sheet(page)).toBeFocused();
  });
});

test.describe('A11Y-02: focus is not selection, F6 and focus.properties', () => {
  test('Tab walks the shapes without changing the selection (Properties keep describing it); Space selects', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Student');
    await newEntity(page, 'Course');
    await page.keyboard.press('Escape');
    await sheet(page).click({ position: { x: 5, y: 5 } });
    await sheet(page).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-overlay="focus"]')).toHaveCount(1);
    // nothing is selected: the panel still shows the empty state, and the live region says how to select
    await expect(liveKb(page)).toContainText('Press Space or Enter to select it');
    await expect(properties(page).getByRole('heading', { name: /Entity/i })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.getByTestId('canvas-live')).toContainText('selected');
    await expect(properties(page)).toContainText(/Student|Course/);
  });

  test('F6 cycles canvas -> properties -> library -> canvas without touching the selection; Mod+Alt+P jumps to Properties', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Student');
    const selectedText = async () => (await properties(page).innerText()).trim();
    const before = await selectedText();
    await sheet(page).focus();
    await page.keyboard.press('F6');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="dock-properties"]'))).toBe(true);
    expect(await selectedText()).toBe(before);
    await page.keyboard.press('F6');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="dock-library"]'))).toBe(true);
    await page.keyboard.press('F6');
    await expect(sheet(page)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Alt+p');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="dock-properties"]'))).toBe(true);
    expect(await selectedText()).toBe(before);
  });
});

test.describe('SA-09 / UX-7: symbol hints', () => {
  test('hovering the double participation line, a cardinality label and a weak entity explains them; Escape and moving away dismiss', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'er');
    const cv = sheet(page);
    const tip = page.getByRole('tooltip');
    const double = cv.locator('[data-chen-line][data-double="true"]').first();
    // a point ON the line (a straight line's bounding box centre can be far from a diagonal)
    const pt = await double.evaluate((g) => {
      const geo = g.querySelector('path, polyline, line') as SVGGeometryElement;
      const p = geo.getPointAtLength(geo.getTotalLength() / 2);
      const m = geo.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    });
    await page.mouse.move(pt.x + 1, pt.y);
    await page.mouse.move(pt.x, pt.y);
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Total participation (double line)');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
    const weak = cv.locator('[data-node-id]', { hasText: /^Drug$/ }).first();
    const wb = (await weak.boundingBox())!;
    await page.mouse.move(wb.x + 4, wb.y + 4);
    await page.mouse.move(wb.x + 6, wb.y + wb.height / 2);
    await expect(tip).toContainText('Weak entity (double rectangle)');
    await page.mouse.move(2, 2);
    await expect(tip).toHaveCount(0);
  });

  test('the + port explains itself, and "Show symbol hints" switches the tooltips off', async ({ app: page }) => {
    await openApp(page);
    await page.locator('[data-part-id="entity"]').click();
    await page.mouse.click(600, 300);
    await page.keyboard.type('Student');
    await page.keyboard.press('Enter');
    const entity = sheet(page).locator('[data-chen-shape="entity"]').first();
    await entity.click();
    const port = sheet(page).locator('[data-port="add-attribute"]').first();
    await expect(port).toBeVisible();
    const pb = (await port.boundingBox())!;
    await page.mouse.move(pb.x + pb.width / 2 - 2, pb.y + pb.height / 2);
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await expect(page.getByRole('tooltip')).toContainText('Add attribute (A)');
    // toggle off through the command palette
    await page.mouse.move(2, 2);
    await page.getByRole('button', { name: 'Command palette' }).click();
    await page.getByRole('combobox', { name: 'Search commands' }).fill('symbol hints');
    await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first().click();
    await entity.click();
    await page.mouse.move(pb.x + pb.width / 2 - 2, pb.y + pb.height / 2);
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.waitForTimeout(900);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('horizontal schema: a foreign-key cell explains the mark and names the referenced column', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'relational');
    const cell = sheet(page).locator('[data-node-id]', { hasText: 'Patient' }).locator('[data-column-id]', { hasText: 'DoctorSSN' }).first();
    const b = (await cell.boundingBox())!;
    await page.mouse.move(b.x + 5, b.y + b.height / 2);
    await page.mouse.move(b.x + 8, b.y + b.height / 2);
    await expect(page.getByRole('tooltip')).toContainText('Foreign key (italic, blue): Patient.DoctorSSN references Doctor.SSN.');
  });
});

test.describe('A11Y-05: the diagram outline', () => {
  test('the SVG is an image with a summary; the skip link opens the outline; activating an item selects and focuses it', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'er');
    await expect(page.locator('svg.sc-canvas__svg')).toHaveAttribute('role', 'img');
    await expect(page.locator('svg.sc-canvas__svg')).toHaveAttribute('aria-label', /Chen ER diagram with \d+ entities/);
    const skip = page.getByRole('button', { name: 'Skip to diagram outline' });
    await skip.focus();
    await expect(skip).toBeVisible();
    await skip.press('Enter');
    const outline = page.getByRole('navigation', { name: 'Diagram outline' });
    await expect(outline).toBeVisible();
    await expect(outline.getByRole('heading', { name: 'Relationships' })).toBeVisible();
    await outline.getByRole('link', { name: 'Weak entity Drug' }).click();
    await expect(sheet(page)).toBeFocused();
    await expect(page.getByTestId('canvas-live')).toContainText('Weak entity Drug selected');
    await expect(properties(page)).toContainText('Drug');
    // clipped to a 1px box again once focus left it
    await expect.poll(async () => (await outline.boundingBox())?.width ?? 0).toBeLessThan(5);
  });

  test('axe finds nothing on the canvas region with the outline and the new labels', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'er');
    await sheet(page).focus();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(700);
    const res = await new AxeBuilder({ page }).include('#sheet-main').analyze();
    expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  });
});

test.describe('UX-1 / SA-11: placing then typing names the new shape', () => {
  test('click-to-place for entity, relationship and attribute; typing names it instead of firing shortcuts', async ({ app: page }) => {
    await openApp(page);
    await page.locator('[data-part-id="entity"]').click();
    await page.mouse.click(520, 260);
    await expect(page.locator('.sc-inline-input')).toBeFocused();
    await page.keyboard.type('Medicine');
    await page.keyboard.press('Enter');
    await page.locator('[data-part-id="relationship"]').click();
    await page.mouse.click(820, 260);
    await expect(page.locator('.sc-inline-input')).toBeFocused();
    await page.keyboard.type('Doctor');
    await page.keyboard.press('Enter');
    const cv = sheet(page);
    await expect(cv.locator('[data-chen-shape="entity"]')).toHaveCount(1);
    await expect(cv.locator('[data-chen-shape="relationship"]')).toHaveCount(1);
    await expect(cv.locator('[data-chen-shape="attribute"]')).toHaveCount(0);
    await expect(cv.getByText('Medicine', { exact: true })).toBeVisible();
    await expect(cv.getByText('Doctor', { exact: true })).toBeVisible();
    await expect(cv).toHaveAttribute('data-tool', 'select');
  });

  test('the Welcome "Add an entity" action opens the rename and typing names it', async ({ app: page }) => {
    await openApp(page, { welcome: true });
    await page.getByRole('button', { name: /Add an entity|entity/i }).first().click();
    await expect(page.locator('.sc-inline-input')).toBeFocused();
    await page.keyboard.type('Patient');
    await page.keyboard.press('Enter');
    await expect(sheet(page).locator('[data-chen-shape="entity"]')).toHaveCount(1);
    await expect(sheet(page).locator('[data-chen-shape="attribute"]')).toHaveCount(0);
    await expect(sheet(page).getByText('Patient', { exact: true })).toBeVisible();
  });

  test('the + port creates an attribute whose name can be typed straight away', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Patient');
    const entity = sheet(page).locator('[data-chen-shape="entity"]').first();
    await entity.click();
    const port = sheet(page).locator('[data-port="add-attribute"]').first();
    const pb = (await port.boundingBox())!;
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await expect(page.locator('.sc-inline-input')).toBeFocused();
    await page.keyboard.type('SSN');
    await page.keyboard.press('Enter');
    await expect(sheet(page).getByText('SSN', { exact: true })).toBeVisible();
    await expect(sheet(page).locator('[data-chen-shape="entity"]')).toHaveCount(1);
  });
});

test.describe('UX-11 / UX-10 / A11Y-12', () => {
  test('deleting the weak entity Drug toasts what else went with an Undo action that restores it', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'er');
    const cv = sheet(page);
    const drug = cv.locator('[data-node-id]', { hasText: /^Drug$/ }).first();
    await drug.click();
    const nodes = await cv.locator('[data-node-id]').count();
    await page.keyboard.press('Delete');
    const toast = page.locator('.sc-toast-text', { hasText: /Deleted entity Drug, and with it/ });
    await expect(toast).toBeVisible();
    expect(await cv.locator('[data-node-id]').count()).toBeLessThan(nodes);
    await page.getByRole('button', { name: 'Undo' }).filter({ hasText: 'Undo' }).last().click();
    await expect.poll(() => cv.locator('[data-node-id]').count()).toBe(nodes);
  });

  test('double clicking a cardinality label does not open an empty role box; it selects the line and moves to Properties', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Pharmacy system', 'er');
    const cv = sheet(page);
    const label = cv.locator('text', { hasText: /^N$/ }).first();
    const b = (await label.boundingBox())!;
    await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
    await expect(page.locator('.sc-inline-input')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-testid="dock-properties"]'))).toBe(true);
  });

  test('after the rename commits the creation hint is gone from the live region and the rename is announced', async ({ app: page }) => {
    await openApp(page);
    await newEntity(page, 'Student');
    await expect(liveKb(page)).not.toContainText('Type its name');
    await expect(page.getByTestId('tools-live')).not.toContainText('Type a name');
    await expect(liveKb(page)).toContainText('Renamed to Student.');
  });
});
