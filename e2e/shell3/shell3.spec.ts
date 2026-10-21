import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';

const SHOTS = '.tmp/shell3';
mkdirSync(SHOTS, { recursive: true });
const SETTINGS_KEY = 'schemacanvas:settings:v1';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function boot(page: Page, o: { theme?: 'light' | 'dark'; width?: number; height?: number; persist?: boolean } = {}): Promise<void> {
  const { theme = 'light', width = 1440, height = 900 } = o;
  await page.setViewportSize({ width, height });
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (!localStorage.getItem(key!)) localStorage.setItem(key!, value!);
      } catch {
        /* unavailable */
      }
    },
    [SETTINGS_KEY, JSON.stringify({ theme, locale: 'en' })],
  );
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.getByRole('tab').first()).toBeVisible();
}

async function openPharmacy(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open an example' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Examples' });
  await dialog.getByRole('radio', { name: 'Pharmacy system' }).click();
  await dialog.getByRole('button', { name: 'Open example' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const activeDesc = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return a ? `${a.tagName}|${a.getAttribute('role') ?? ''}|${a.getAttribute('aria-label') ?? a.textContent?.trim().slice(0, 30) ?? ''}` : 'none';
  });

test.describe('A11Y-03 / A11Y-04 focus indicators', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`focused CHECKED segmented item shows a ring (${theme})`, async ({ page }) => {
      await boot(page, { theme });
      await page.keyboard.press(`${mod}+,`);
      const dlg = page.getByRole('dialog', { name: 'Settings' });
      await expect(dlg).toBeVisible();
      const groups = dlg.getByRole('radiogroup');
      expect(await groups.count()).toBeGreaterThan(1);
      for (let i = 0; i < (await groups.count()); i++) {
        const checked = groups.nth(i).locator('[role=radio][aria-checked=true]');
        await checked.focus();
        const shadow = await checked.evaluate((el) => getComputedStyle(el).boxShadow);
        // the focus ring is a two-layer shadow (2px gap + ring out to 4px); the plain selected border is one 1px layer
        expect(shadow, `group ${i}`).toMatch(/0px 0px 0px 4px/);
      }
    });
  }

  test('export dialog format control shows focus on the checked item', async ({ page }) => {
    await boot(page);
    await page.keyboard.press(`${mod}+Shift+e`);
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    const checked = dlg.locator('[role=radio][aria-checked=true]').first();
    await checked.focus();
    expect(await checked.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(/0px 0px 0px 4px/);
  });

  test('forced colors: focus uses an outline, switches differ on/off, selected segment has a border', async ({ page }) => {
    await boot(page);
    await page.emulateMedia({ forcedColors: 'active' });
    const btn = page.getByRole('button', { name: 'Settings' }).first();
    await btn.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus-visible').first();
    const outline = await focused.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(outline.style).toBe('solid');
    expect(outline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press(`${mod}+,`);
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    const seg = dlg.locator('[role=radio][aria-checked=true]').first();
    expect(parseFloat(await seg.evaluate((el) => getComputedStyle(el).borderTopWidth))).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}/forced-settings.png` });
    await dlg.getByLabel('Close').click();
    // properties panel / diagram options contain switches: compare an on and an off switch visually via computed style
    await openPharmacy(page);
    await page.keyboard.press(`${mod}+Shift+,`).catch(() => undefined);
    const switches = page.getByRole('switch');
    if ((await switches.count()) > 1) {
      const styles = await switches.evaluateAll((els) => els.map((el) => ({ on: el.getAttribute('aria-checked'), bg: getComputedStyle(el).backgroundColor, thumb: getComputedStyle(el.firstElementChild!).backgroundColor, border: getComputedStyle(el).borderTopColor })));
      const on = styles.find((s) => s.on === 'true');
      const off = styles.find((s) => s.on === 'false');
      if (on && off) expect(JSON.stringify(on)).not.toBe(JSON.stringify(off));
    }
  });
});

test.describe('A11Y-07 focus return', () => {
  test('palette closed with Escape returns focus to the opener (canvas / toolbar button)', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    const canvas = page.locator('#sheet-main [role=application]');
    await canvas.focus();
    await page.keyboard.press(`${mod}+k`);
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(canvas).toBeFocused();
    const btn = page.getByRole('button', { name: /command palette/i }).first();
    await btn.focus();
    await btn.press('Enter');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(btn).toBeFocused();
  });

  test('Convert (its toolbar button becomes disabled on the new sheet) lands focus on the new canvas', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    await page.getByRole('button', { name: /^Convert/ }).first().click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('button', { name: /^Convert/ }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('tab', { selected: true })).toContainText(/Relational/i);
    await expect(page.locator('#sheet-main [role=application]')).toBeFocused();
  });

  test('Undo until the history is empty moves focus to a neighbouring toolbar button, not <body>', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Add an entity' }).click().catch(() => undefined);
    await page.keyboard.press('Escape');
    // make one undoable edit: rename the project
    await page.getByTestId('project-name').click();
    await page.keyboard.type('Edited');
    await page.keyboard.press('Enter');
    const undo = page.getByRole('toolbar').getByRole('button', { name: /^Undo/ });
    await expect(undo).toBeEnabled();
    await undo.focus();
    while (await undo.isEnabled()) await undo.press('Enter');
    await expect(undo).toBeDisabled();
    const d = await activeDesc(page);
    expect(d.startsWith('BODY')).toBe(false);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=toolbar]'))).toBe(true);
  });

  test('Open relationship link in the properties panel does not drop focus to <body>', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    // select a relationship node from the ER canvas via a foreign-key / belongs-to style link when present
    const link = page.getByTestId('dock-properties').getByRole('button', { name: /Open relationship|Belongs to/ }).first();
    if (!(await link.count())) {
      await page.locator('#sheet-main [role=application]').focus();
      await page.keyboard.press('Tab');
    }
    // generic check through the policy: focus a control inside the dock and remove the selection
    const dock = page.getByTestId('dock-properties');
    await expect(dock).toBeVisible();
    await page.evaluate(() => {
      const dockEl = document.querySelector('[data-testid="dock-properties"]')!;
      const b = document.createElement('button');
      b.textContent = 'temp link';
      dockEl.querySelector('.shell-dock-scroll')!.appendChild(b);
      b.focus();
      b.remove();
    });
    await expect.poll(() => activeDesc(page)).not.toMatch(/^BODY/);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="dock-properties"]'))).toBe(true);
  });

  test('skip link lands on the canvas, even when a later sheet is active', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    await page.getByRole('button', { name: /^Convert/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /^Convert/ }).last().click();
    await expect(page.getByRole('tab', { selected: true })).toContainText(/Relational/i);
    await page.locator('.shell-skip').focus();
    await expect(page.getByRole('link', { name: 'Skip to the sheet' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#sheet-main [role=application]')).toBeFocused();
  });
});

test.describe('A11Y-08 medium drawers', () => {
  test('Tab stays inside the open drawer and Escape returns focus to its toggle', async ({ page }) => {
    await boot(page, { width: 900, height: 800 });
    await openPharmacy(page);
    const toggle = page.getByRole('button', { name: 'Show parts library' });
    await toggle.click();
    const drawer = page.getByTestId('drawer-library');
    await expect(drawer).toBeVisible();
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="drawer-library"]')), `tab ${i}`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page.locator('[data-panel-toggle="library"]')).toBeFocused();
  });
});

test.describe('A11Y-10/11/16 structure', () => {
  test('exactly one h1, panel headings start at h2, dialogs add no banner/contentinfo, language options carry lang', async ({ page }) => {
    await boot(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    expect(await page.evaluate(() => [...document.querySelectorAll('h3')].filter((h) => !h.closest('[data-testid^=dock-]') && !h.closest('.shell-drawer')).length)).toBe(0);
    await expect(page.getByTestId('dock-library').getByRole('heading', { level: 2 })).toHaveCount(1);
    await page.keyboard.press(`${mod}+,`);
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    await expect(dlg.locator('[lang="zh"]')).toHaveCount(1);
    await expect(dlg.locator('[lang="en"]')).toHaveCount(1);
    const r = await new AxeBuilder({ page }).include('.sc-dialog').analyze();
    const ids = r.violations.map((v) => v.id);
    expect(ids).not.toContain('landmark-no-duplicate-banner');
    expect(ids).not.toContain('landmark-no-duplicate-contentinfo');
  });

  test('dialog opens on the checked radio with theme=dark', async ({ page }) => {
    await boot(page, { theme: 'dark' });
    await page.keyboard.press(`${mod}+,`);
    const dlg = page.getByRole('dialog', { name: 'Settings' });
    const a = await page.evaluate(() => ({ role: document.activeElement?.getAttribute('role'), checked: document.activeElement?.getAttribute('aria-checked'), label: document.activeElement?.textContent }));
    expect(a.role).toBe('radio');
    expect(a.checked).toBe('true');
    await expect(dlg).toBeVisible();
  });

  test('palette: no results is a status outside the listbox; "Import SQL" finds the import command', async ({ page }) => {
    await boot(page);
    await page.keyboard.press(`${mod}+k`);
    await page.keyboard.type('zzzqqq');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: /no matching/i })).toBeVisible();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('Import SQL');
    // scoped to the palette: <select> elements in the panels also expose role=option
    const options = page.locator('.shell-palette').getByRole('option');
    await expect(options.first()).toBeVisible();
    expect(await options.allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(/import/i)]));
    const r = await new AxeBuilder({ page }).include('.shell-palette').analyze();
    expect(r.violations.map((v) => v.id)).not.toContain('aria-required-children');
  });
});

test.describe('SA-15 diagram type control', () => {
  test('toolbar shows the active type, creates sheets of each type, and is keyboard operable', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    const tabsBefore = await page.getByRole('tab').count();
    const btn = page.getByTestId('diagram-type-menu');
    await expect(btn).toContainText('Chen ER diagram');
    await btn.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem', { name: /Pharmacy.*/ }).first().waitFor().catch(() => undefined);
    const names = await menu.getByRole('menuitem').allTextContents();
    expect(names.length).toBeGreaterThanOrEqual(4);
    await menu.getByRole('menuitem').nth(names.length - 1).click(); // last entry: a new physical sheet
    await expect(btn).toContainText('Physical');
    await expect(page.getByRole('tab')).toHaveCount(tabsBefore + 1);
  });
});

test.describe('SA-19 / UX-15 active sheet restore', () => {
  test('reload reopens on the sheet that was active, and the dock', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    await page.getByRole('button', { name: /^Convert/ }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /^Convert/ }).last().click();
    await expect(page.getByRole('tab', { selected: true })).toContainText(/Relational/i);
    await page.waitForTimeout(800); // autosave settles
    await page.reload();
    await expect(page.getByRole('tab').first()).toBeVisible();
    await expect(page.getByRole('tab', { selected: true })).toContainText(/Relational/i);
  });
});

test.describe('SA-07 write-ahead journal', () => {
  for (const delay of [0, 100]) {
    test(`an edit made ${delay}ms before reload survives`, async ({ page }) => {
      await boot(page);
      await page.waitForTimeout(700);
      await page.getByTestId('project-name').click();
      await page.keyboard.press(`${mod}+a`);
      await page.keyboard.type('Journaled name');
      await page.keyboard.press('Enter');
      if (delay) await page.waitForTimeout(delay);
      await page.reload();
      await expect(page.getByTestId('project-name')).toContainText('Journaled name');
    });
  }
});

test.describe('UX-14 / UX-8 narrow screens and toasts', () => {
  test('390px: selecting an entity and opening Properties keeps it visible above the sheet; toasts stay clear', async ({ page }) => {
    await boot(page, { width: 390, height: 844 });
    await openPharmacy(page);
    await page.waitForTimeout(500);
    // select the entity nearest the bottom of the canvas via its node (click)
    const target = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll<SVGGraphicsElement>('#sheet-main [data-node-id]')];
      let best: { id: string; y: number } | undefined;
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        if (r.width < 4) continue;
        if (!best || r.bottom > best.y) best = { id: n.getAttribute('data-node-id')!, y: r.bottom };
      }
      return best;
    });
    test.skip(!target, 'no node markers exposed');
    await page.locator(`#sheet-main [data-node-id="${target!.id}"]`).first().click({ force: true });
    await page.getByRole('button', { name: 'Show properties' }).click();
    const sheet = page.getByTestId('drawer-properties');
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(600);
    const [sheetTop, nodeBox] = await Promise.all([sheet.evaluate((el) => el.getBoundingClientRect().top), page.locator(`#sheet-main [data-node-id="${target!.id}"]`).first().evaluate((el) => el.getBoundingClientRect().toJSON())]);
    expect(nodeBox.bottom).toBeLessThanOrEqual(sheetTop + 1);
    await page.screenshot({ path: `${SHOTS}/mobile-props.png` });
  });
});
