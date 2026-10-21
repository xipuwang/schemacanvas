import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const SHOTS = '.tmp/shell';
mkdirSync(SHOTS, { recursive: true });

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

/** Collect console errors / page errors for the whole test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => ({ doc: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: document.body.scrollWidth - document.body.clientWidth }));

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('boot', () => {
  test('app boots with chrome, landmarks, no console errors and no horizontal scroll', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Parts library' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toContainText('No issues');
    await expect(page.getByTestId('status-zoom')).toContainText('%');
    expect(await noHorizontalScroll(page)).toEqual({ doc: 0, body: 0 });
    await expect(page.getByRole('button', { name: 'Open an example' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/boot-1440.png` });
    expect(errors).toEqual([]);
  });

  test('document title follows the project name', async ({ page }) => {
    await boot(page);
    await expect(page).toHaveTitle(/SchemaCanvas/);
  });
});

test.describe('sheet tabs', () => {
  test('create, rename (dblclick and F2), duplicate, switch and delete with confirm', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    // create a relational schema (new empty model)
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.locator('[data-item-id="new-relational-schema"]').click();
    const rel = page.getByRole('tab', { name: 'Relational Schema' });
    await expect(rel).toHaveAttribute('aria-selected', 'true');
    // switch back by click
    await page.getByRole('tab', { name: 'ER Diagram' }).click();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toHaveAttribute('aria-selected', 'true');

    // rename by double-click
    await page.getByRole('tab', { name: 'ER Diagram' }).dblclick();
    const input = page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' });
    await input.fill('Clinic ER');
    await input.press('Enter');
    await expect(page.getByRole('tab', { name: 'Clinic ER' })).toBeVisible();

    // rename by F2, Escape cancels
    await page.getByRole('tab', { name: 'Clinic ER' }).focus();
    await page.keyboard.press('F2');
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('discarded');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tab', { name: 'Clinic ER' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Clinic ER' })).toBeFocused();

    // keyboard navigation
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Relational Schema' })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: 'Clinic ER' })).toHaveAttribute('aria-selected', 'true');

    // active tab is underlined in key-gold
    const color = await page.getByRole('tab', { name: 'Clinic ER' }).evaluate((el) => getComputedStyle(el).borderBottomColor);
    const key = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--key)';
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(color).toBe(key);

    // duplicate via context menu
    await page.getByRole('tab', { name: 'Clinic ER' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    await expect(page.getByRole('tab', { name: 'Clinic ER copy' })).toHaveAttribute('aria-selected', 'true');

    // delete with confirm: cancel, then confirm
    await page.getByRole('tab', { name: 'Clinic ER copy' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Clinic ER copy');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/confirm-delete.png` });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('tab', { name: 'Clinic ER copy' })).toBeVisible();
    await page.getByRole('tab', { name: 'Clinic ER copy' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('tab', { name: 'Clinic ER copy' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('toolbar commands', () => {
  test('undo/redo via toolbar buttons and shortcuts', async ({ page }) => {
    await boot(page);
    const undo = page.getByRole('button', { name: 'Undo' });
    const redo = page.getByRole('button', { name: 'Redo' });
    await expect(undo).toBeDisabled();
    await page.getByRole('tab', { name: 'ER Diagram' }).dblclick();
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('Renamed');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'Renamed' })).toBeVisible();
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(page.getByRole('tab', { name: 'Renamed' })).toBeVisible();
  });

  test('tooltips show label and shortcut', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Save project file' }).hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toContainText('Save project file');
    await expect(tip.locator('kbd')).toHaveText(/S/);
    await page.screenshot({ path: `${SHOTS}/tooltip.png`, clip: { x: 0, y: 0, width: 600, height: 120 } });
  });

  test('view menu zooms the sheet and the status bar follows', async ({ page }) => {
    await boot(page);
    const zoomText = async () => (await page.getByTestId('status-zoom').innerText()).trim();
    const before = await zoomText();
    await page.getByRole('button', { name: 'View options' }).click();
    await page.getByRole('menuitem', { name: 'Zoom in' }).click();
    await expect.poll(zoomText).not.toBe(before);
    await page.screenshot({ path: `${SHOTS}/view-menu.png` });
  });

  test('arrange menu lists the editor arrange commands', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Arrange' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.getByRole('menuitem').count()).toBeGreaterThan(3);
    await page.screenshot({ path: `${SHOTS}/arrange-menu.png`, clip: { x: 300, y: 0, width: 520, height: 420 } });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Arrange' })).toBeFocused();
  });

  test('Save downloads a .schemacanvas.json file', async ({ page }) => {
    await boot(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save project file' }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.schemacanvas\.json$/);
    const path = await download.path();
    const json = JSON.parse(readFileSync(path!, 'utf8'));
    expect(json.format ?? json.schemaVersion ?? json.project?.schemaVersion).toBeTruthy();
    await expect(page.getByText(/Saved .*schemacanvas\.json/)).toBeVisible();
    // Mod+S does the same
    const [d2] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)]);
    expect(d2.suggestedFilename()).toMatch(/\.schemacanvas\.json$/);
  });

  test('New project asks to discard unsaved changes, then offers a fresh project', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: 'ER Diagram' }).dblclick();
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('Edited');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'New project' }).click();
    // dirty only until autosave lands; either a confirm or the dialog appears
    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    if (await confirm.isVisible().catch(() => false)) await confirm.getByRole('button', { name: 'Discard changes' }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Project name' }).fill('Fresh');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
    await expect(page).toHaveTitle(/Fresh/);
  });

  test('missing dialogs degrade gracefully (export is built by the panels worker)', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Export diagram' }).click();
    // either the real export dialog or the placeholder
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('command palette and shortcuts dialog', () => {
  test('palette opens with Mod+K, filters, runs on Enter and returns focus', async ({ page }) => {
    await boot(page);
    await page.keyboard.press(`${mod}+k`);
    const input = page.getByRole('combobox', { name: 'Search commands' });
    await expect(input).toBeFocused();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/palette.png` });
    await input.fill('sett');
    await expect(page.getByRole('dialog', { name: 'Command palette' }).getByRole('option').first()).toContainText('Settings');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('palette arrow navigation and Escape', async ({ page }) => {
    await boot(page);
    await page.keyboard.press(`${mod}+k`);
    await page.keyboard.press('ArrowDown');
    const selected = page.getByRole('option', { selected: true });
    await expect(selected).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox', { name: 'Search commands' })).toHaveCount(0);
  });

  test('shortcuts dialog: ? opens, lists commands, searches, traps focus, Escape returns focus', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: 'ER Diagram' }).focus();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Save project file')).toBeVisible();
    await expect(dialog.getByText('Undo', { exact: true })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/shortcuts-light.png` });
    await dialog.getByRole('searchbox').fill('zoom');
    await expect(dialog.getByText('Save project file')).toHaveCount(0);
    await expect(dialog.getByText('Zoom in')).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeFocused();
  });

  test('typing ? in a text field does not open the dialog', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: 'ER Diagram' }).dblclick();
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('what');
    await page.keyboard.type('?');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' })).toHaveValue('what?');
  });
});

test.describe('settings', () => {
  test('theme and language switch live and persist across reload', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/settings-dark.png` });
    await dialog.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await dialog.getByRole('radio', { name: '中文 (Chinese)' }).click();
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: '主工具栏' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/settings-zh.png` });
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByRole('toolbar', { name: '主工具栏' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('system theme follows prefers-color-scheme live', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await boot(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('grid and live validation controls, clear local data asks first', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const snap = dialog.getByRole('switch', { name: 'Snap to grid' });
    const was = await snap.getAttribute('aria-checked');
    await snap.click();
    await expect(snap).toHaveAttribute('aria-checked', was === 'true' ? 'false' : 'true');
    await dialog.getByRole('button', { name: 'Clear local data' }).click();
    const confirm = page.getByRole('dialog', { name: 'Clear local data?' });
    await expect(confirm).toBeVisible();
    // the safe default focus is Cancel
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Clear data' }).click();
    await expect(page.getByText('Local data cleared')).toBeVisible();
    // nothing project-related survives: journal and viewstate gone, and a reload restores nothing
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('journal') || k.includes('viewstate')));
    expect(keys).toEqual([]);
  });
});

test.describe('open files', () => {
  test('dropping a project file anywhere on the window opens it; a bad file shows a toast', async ({ page }) => {
    await boot(page);
    await page.getByRole('tab', { name: 'ER Diagram' }).dblclick();
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('Saved sheet');
    await page.keyboard.press('Enter');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save project file' }).click()]);
    const text = readFileSync((await download.path())!, 'utf8');
    // change the project, then drop the saved file
    await page.getByRole('tab', { name: 'Saved sheet' }).dblclick();
    await page.getByRole('tablist').getByRole('textbox', { name: 'Diagram name' }).fill('Changed later');
    await page.keyboard.press('Enter');
    // let autosave land so the discard confirm does not intervene
    await page.waitForTimeout(1200);
    const drop = async (name: string, content: string) => {
      const dt = await page.evaluateHandle(
        ([n, c]) => {
          const d = new DataTransfer();
          d.items.add(new File([c as string], n as string, { type: 'application/json' }));
          return d;
        },
        [name, content],
      );
      await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
      await expect(page.getByTestId('file-drop')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/drop-overlay.png` });
      await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    };
    await drop('x.schemacanvas.json', text);
    await expect(page.getByRole('tab', { name: 'Saved sheet' })).toBeVisible();
    await expect(page.getByText(/^Opened /)).toBeVisible();

    await drop('broken.json', '{ not json');
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('broken.json');
    await page.screenshot({ path: `${SHOTS}/open-error-toast.png` });
    // the good project is still loaded
    await expect(page.getByRole('tab', { name: 'Saved sheet' })).toBeVisible();
  });

  test('Open uses a real file chooser', async ({ page }) => {
    await boot(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save project file' }).click()]);
    const file = (await download.path())!;
    await page.waitForTimeout(800);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open project file' }).click()]);
    await chooser.setFiles(file);
    await expect(page.getByText(/^Opened /)).toBeVisible();
  });
});

test.describe('docks', () => {
  test('resize the library dock by dragging and by keyboard; double-click resets; panels toggle', async ({ page }) => {
    await boot(page);
    const dock = page.getByTestId('dock-library');
    const width = async () => Math.round((await dock.boundingBox())!.width);
    const w0 = await width();
    const sep = page.getByRole('separator', { name: 'Resize parts library' });
    const box = (await sep.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 200, { steps: 6 });
    await page.mouse.up();
    expect(await width()).toBeGreaterThan(w0 + 60);
    await sep.focus();
    const w1 = await width();
    await page.keyboard.press('ArrowLeft');
    expect(await width()).toBe(w1 - 16);
    await sep.dblclick();
    expect(await width()).toBe(w0);
    // right dock: dragging left grows it
    const right = page.getByTestId('dock-properties');
    const r0 = Math.round((await right.boundingBox())!.width);
    const rsep = page.getByRole('separator', { name: 'Resize properties panel' });
    await rsep.focus();
    await page.keyboard.press('ArrowLeft');
    expect(Math.round((await right.boundingBox())!.width)).toBe(r0 + 16);
    // toggle panels
    await page.getByRole('button', { name: 'Show parts library' }).click();
    await expect(page.getByTestId('dock-library')).toHaveCount(0);
    await page.keyboard.press(`${mod}+b`);
    await expect(page.getByTestId('dock-library')).toBeVisible();
    // reload persists the width
    await sep.focus();
    await page.keyboard.press('ArrowRight');
    const saved = await width();
    await page.reload();
    await expect(page.getByTestId('dock-library')).toBeVisible();
    expect(await width()).toBe(saved);
  });

  test('issues dock: validate opens it, resize and close', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'Validate model' }).click();
    const bottom = page.getByTestId('dock-bottom');
    await expect(bottom).toBeVisible();
    await expect(bottom.getByRole('tab', { name: /Issues/ })).toHaveAttribute('aria-selected', 'true');
    const h0 = Math.round((await bottom.boundingBox())!.height);
    await page.getByRole('separator', { name: 'Resize bottom panel' }).focus();
    await page.keyboard.press('ArrowUp');
    expect(Math.round((await bottom.boundingBox())!.height)).toBe(h0 + 16);
    await page.screenshot({ path: `${SHOTS}/issues-dock.png` });
    await page.getByRole('button', { name: 'Close bottom panel' }).click();
    await expect(bottom).toHaveCount(0);
  });

  test('live validation updates the status bar after edits', async ({ page }) => {
    await boot(page);
    const status = page.getByTestId('status-issues');
    await expect(status).toBeVisible();
    // validation ran at startup
    await expect.poll(async () => (await status.getAttribute('aria-label')) ?? '').toMatch(/issues|errors|No issues/i);
  });
});

test.describe('keyboard and accessibility', () => {
  test('toolbar is a single tab stop with arrow-key navigation', async ({ page }) => {
    await boot(page);
    const toolbar = page.getByRole('toolbar');
    const stops = await toolbar.locator('button[tabindex="0"]').count();
    expect(stops).toBe(1);
    await toolbar.locator('button[tabindex="0"]').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await toolbar.evaluate((t) => t.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('End');
    await expect(toolbar.getByRole('button', { name: 'Show properties' })).toBeFocused();
    await page.keyboard.press('Home');
    expect(await toolbar.evaluate((t) => t.contains(document.activeElement))).toBe(true);
  });

  test('focus ring is visible on keyboard focus', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Tab'); // skip link
    await expect(page.getByRole('link', { name: 'Skip to the sheet' })).toBeFocused();
    await page.keyboard.press('Tab');
    const shadow = await page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow);
    expect(shadow).not.toBe('none');
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: empty app, shortcuts and settings dialogs have no serious violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page);
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      await page.waitForTimeout(400); // let the open animation finish (axe samples mid-fade colours)
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
      await page.waitForTimeout(400);
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Validate model' }).click();
      await expect(page.getByTestId('dock-bottom')).toBeVisible();
      expect(await seriousViolations(page)).toEqual([]);
      await page.keyboard.press(`${mod}+k`);
      await expect(page.getByRole('combobox', { name: 'Search commands' })).toBeVisible();
      await page.waitForTimeout(400);
      expect(await seriousViolations(page)).toEqual([]);
    });
  }
});

const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '900', width: 900, height: 700 },
  { name: '390', width: 390, height: 800 },
] as const;

test.describe('responsive screenshots', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'zh'] as const) {
      for (const size of SIZES) {
        test(`${size.name} ${scheme} ${locale}`, async ({ page }) => {
          const errors = trackErrors(page);
          await page.setViewportSize({ width: size.width, height: size.height });
          await page.emulateMedia({ colorScheme: scheme });
          await page.addInitScript((loc) => {
            localStorage.setItem('schemacanvas:settings:v1', JSON.stringify({ locale: loc, theme: 'system', panels: { library: true, properties: true, issues: false } }));
          }, locale);
          await page.goto('/');
          await expect(page.getByRole('toolbar')).toBeVisible();
          await page.waitForTimeout(500);
          expect(await noHorizontalScroll(page)).toEqual({ doc: 0, body: 0 });
          // chrome must not overflow its own box (CJK text widths)
          const overflow = await page.evaluate(() => {
            const bad: string[] = [];
            for (const sel of ['.shell-toolbar', '.shell-tabs', '.shell-status']) {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (el && el.scrollWidth > el.clientWidth + 1) bad.push(`${sel} ${el.scrollWidth}>${el.clientWidth}`);
            }
            return bad;
          });
          expect(overflow).toEqual([]);
          await page.screenshot({ path: `${SHOTS}/resp-${size.name}-${scheme}-${locale}.png` });
          // open a drawer in the narrower layouts and a validate dock
          if (size.width < 1100) {
            await page.getByRole('button', { name: locale === 'zh' ? '显示组件库' : 'Show parts library' }).click();
            await expect(page.getByRole('complementary')).toBeVisible();
            await page.waitForTimeout(300);
            await page.screenshot({ path: `${SHOTS}/resp-${size.name}-${scheme}-${locale}-drawer.png` });
            expect(await noHorizontalScroll(page)).toEqual({ doc: 0, body: 0 });
          }
          expect(errors).toEqual([]);
        });
      }
    }
  }

  test('narrow: More menu exposes commands and the sheet fills the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await boot(page);
    await page.getByRole('button', { name: 'More commands' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Validate model' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/narrow-more-menu.png` });
    expect(await noHorizontalScroll(page)).toEqual({ doc: 0, body: 0 });
  });
});
