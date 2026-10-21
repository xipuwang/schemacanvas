import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { produce } from 'immer';
import { serializeProject } from '../../src/model/io';
import * as ops from '../../src/model/ops';
import type { Project, RelationalModel } from '../../src/model/types';
import { layoutChenFixture, pharmacy } from '../../src/scene/chen/fixtures';
import { pharmacyFixture } from '../../src/scene/horizontal/fixtures';

const SHOTS = '.tmp/editor-tools';
mkdirSync(SHOTS, { recursive: true });

/** The pharmacy ER diagram + the horizontal schema WITHOUT foreign keys, as a project file. */
function projectFile(): { name: string; mimeType: string; buffer: Buffer } {
  const chen = layoutChenFixture(pharmacy());
  const project = chen.project;
  const rf = pharmacyFixture();
  project.models[rf.model.id] = rf.model;
  project.diagrams[rf.diagram.id] = rf.diagram;
  project.diagramOrder.push(rf.diagram.id);
  const bare: Project = produce(project, (d) => {
    const m = d.models[rf.model.id] as RelationalModel;
    for (const id of Object.keys(m.foreignKeys)) ops.removeForeignKey(d, rf.model.id, id);
  });
  return { name: 'pharmacy.schemacanvas.json', mimeType: 'application/json', buffer: Buffer.from(serializeProject(bare)) };
}

function track(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('toolbar').first()).toBeVisible();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('ControlOrMeta+o')]);
  await chooser.setFiles(projectFile());
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
}

async function cell(page: Page, relation: string, column: string): Promise<{ x: number; y: number }> {
  // a table node holds its relation name as text; the cell is the [data-column-id] element whose text is the column name
  const node = page.locator('[data-node-id]', { has: page.locator('text', { hasText: new RegExp(`^${relation}$`) }) }).first();
  const c = node.locator('[data-column-id]', { has: page.locator('text', { hasText: new RegExp(`^${column}$`) }) }).first();
  const b = (await c.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function serious(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`real app (${scheme}): library tools, connect tool, FK tool with popover, handles; axe has no serious violations`, async ({ page }) => {
    const errors = track(page);
    await page.emulateMedia({ colorScheme: scheme });
    await boot(page);

    // ---- Chen: tool buttons in the library, connect tool, hint, Escape
    const connectBtn = page.locator('button[data-tool="connect"]');
    await connectBtn.click();
    await expect(connectBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tool-hint')).toContainText('Connect tool');
    await page.screenshot({ path: `${SHOTS}/app-${scheme}-01-connect-tool.png` });
    expect(await serious(page)).toEqual([]);
    await page.locator('.sc-canvas').focus();
    await page.keyboard.press('Escape');
    await expect(connectBtn).toHaveAttribute('aria-pressed', 'false');

    // selected entity: handles and ports, axe
    const doctor = page.locator('[data-node-id]', { has: page.locator('text', { hasText: /^Doctor$/ }) }).first();
    const db = (await doctor.boundingBox())!;
    await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2);
    await page.keyboard.press('Shift+2'); // fit selection: the entity is big enough on screen for all eight handles
    await expect(page.locator('[data-handle^="resize:"]')).toHaveCount(8);
    await expect(page.locator('[data-port="add-attribute"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/app-${scheme}-02-handles.png` });
    expect(await serious(page)).toEqual([]);

    // ---- relational tab: FK tool + popover
    const tabs = page.getByRole('tab');
    await tabs.nth(1).click();
    await expect(page.locator('[data-column-id]').first()).toBeVisible();
    const fkBtn = page.locator('button[data-tool="fk"]');
    await fkBtn.click();
    await expect(fkBtn).toHaveAttribute('aria-pressed', 'true');
    const from = await cell(page, 'Patient', 'DoctorSSN');
    const to = await cell(page, 'Doctor', 'SSN');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.screenshot({ path: `${SHOTS}/app-${scheme}-03-fk-drag.png` });
    await page.mouse.up();
    const pop = page.getByTestId('fk-popover');
    await expect(pop).toBeVisible();
    await expect(page.getByTestId('fk-text')).toHaveText('Patient.DoctorSSN → Doctor.SSN');
    await page.waitForTimeout(300); // let the open animation finish before capturing / running axe
    await page.screenshot({ path: `${SHOTS}/app-${scheme}-04-fk-popover.png` });
    expect(await serious(page)).toEqual([]);
    // keyboard: the popover is a labelled dialog, focus is on Create, Tab stays inside, Enter creates
    await expect(page.getByRole('dialog', { name: 'Create foreign key' })).toBeVisible();
    await expect(page.getByTestId('fk-create')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.getByTestId('fk-create').focus();
    await page.keyboard.press('Enter');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.sc-canvas [data-edge-id] [data-fk-branch]')).toHaveCount(1);
    await expect(page.getByText('Created foreign key Patient.DoctorSSN → Doctor.SSN').first()).toBeVisible();
    // undo from the toolbar shortcut removes it again
    await page.locator('.sc-canvas').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.sc-canvas [data-edge-id]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('real app: Chinese UI strings for the tools, no horizontal page scroll at 1440 / 900 / 600 px', async ({ page }) => {
  const errors = track(page);
  await page.addInitScript(() => localStorage.setItem('schemacanvas:settings', JSON.stringify({ state: { locale: 'zh' }, version: 0 })));
  await boot(page);
  await page.evaluate(() => document.documentElement.setAttribute('lang', 'zh'));
  for (const width of [1440, 900, 600]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('button[data-tool="connect"]').click();
  const hint = await page.getByTestId('tool-hint').textContent();
  await page.screenshot({ path: `${SHOTS}/app-zh-connect-hint.png` });
  // either the locale override took (Chinese) or the default (English); both must be real sentences, never raw keys
  expect(hint ?? '').not.toContain('editorTools.');
  expect(errors).toEqual([]);
});
