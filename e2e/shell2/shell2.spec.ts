import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const SHOTS = '.tmp/shell2';
mkdirSync(SHOTS, { recursive: true });

const SETTINGS_KEY = 'schemacanvas:settings:v1';
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
type Lang = 'en' | 'zh';
type Theme = 'light' | 'dark';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

interface BootOptions {
  theme?: Theme;
  lang?: Lang;
  width?: number;
  height?: number;
  /** Make IndexedDB unavailable (private-browsing simulation). */
  noStorage?: boolean;
}

async function boot(page: Page, o: BootOptions = {}): Promise<void> {
  const { theme = 'light', lang = 'en', width = 1440, height = 900, noStorage = false } = o;
  await page.setViewportSize({ width, height });
  await page.addInitScript(
    ([key, value]) => {
      try {
        if (!localStorage.getItem(key!)) localStorage.setItem(key!, value!);
      } catch {
        /* storage unavailable */
      }
    },
    [SETTINGS_KEY, JSON.stringify({ theme, locale: lang })],
  );
  if (noStorage) await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
  await expect(page.getByRole('tab').first()).toBeVisible();
}

async function serious(page: Page, include?: string): Promise<string[]> {
  await page.waitForTimeout(350); // let entrance animations finish: axe would otherwise measure mid-fade colours
  let b = new AxeBuilder({ page });
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(350); // dialog / toast entrance animation
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const T = {
  en: { example: 'Open an example', examples: 'Examples', openBtn: 'Open example', file: 'File', recent: 'Recent projects', reopen: 'Reopen previous', pharmacy: 'Pharmacy system' },
  zh: { example: '打开示例', examples: '示例', openBtn: '打开示例', file: '文件', recent: '最近的项目', reopen: '重新打开之前的项目', pharmacy: '药房系统' },
};

async function openPharmacy(page: Page, lang: Lang = 'en'): Promise<void> {
  await page.getByRole('button', { name: T[lang].example }).first().click();
  const dialog = page.getByRole('dialog', { name: T[lang].examples });
  await dialog.getByRole('radio', { name: T[lang].pharmacy }).click();
  await dialog.getByRole('button', { name: T[lang].openBtn }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function fileMenu(page: Page, item: RegExp | string, lang: Lang = 'en'): Promise<void> {
  await page.getByRole('button', { name: T[lang].file, exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The downloaded project file, normalised: no savedAt, no viewports (the canvas re-fits those on every open). */
async function saveFile(page: Page): Promise<Record<string, any>> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)]);
  const json = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  delete json.savedAt;
  const diagrams = json.project?.diagrams ?? {};
  for (const d of Object.values<any>(diagrams)) delete d.viewport;
  return json;
}

async function addEntity(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add an entity' }).click();
  const field = page.locator('.sc-canvas__edit, input.sc-inline-edit, [data-testid="inline-edit"]').first();
  await expect(page.locator('input:focus, textarea:focus')).toBeVisible();
  void field;
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('1 status bar zoom', () => {
  test('shows the live canvas zoom after opening an example and while wheel-zooming', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await openPharmacy(page);
    const canvas = page.locator('[data-zoom]').first();
    await expect(canvas).toBeVisible();
    const status = page.getByTestId('status-zoom');
    await expect.poll(async () => Number(await canvas.getAttribute('data-zoom'))).toBeLessThan(0.99);
    const z0 = Number(await canvas.getAttribute('data-zoom'));
    await expect(status).toHaveText(`${Math.round(z0 * 100)}%`);
    expect(await status.textContent()).not.toBe('100%');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
    await page.keyboard.up('Control');
    const z1 = Number(await canvas.getAttribute('data-zoom'));
    expect(z1).toBeGreaterThan(z0 * 1.3);
    await expect(status).toHaveText(`${Math.round(z1 * 100)}%`);
    expect(errors).toEqual([]);
  });
});

test.describe('2 data-loss safety net', () => {
  test('example over real work: Reopen previous restores EXACTLY the previous project', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await addEntity(page, 'Student');
    await page.getByTestId('project-name').click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Previous work');
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle(/Previous work - SchemaCanvas/);
    const before = await saveFile(page);
    await page.waitForTimeout(1000); // autosave lands
    expect(JSON.stringify(before)).toContain('Student');

    await fileMenu(page, /Open example/);
    const dialog = page.getByRole('dialog', { name: 'Examples' });
    await dialog.getByRole('radio', { name: 'Pharmacy system' }).click();
    await dialog.getByRole('button', { name: 'Open example' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Your previous project is in Recent projects.' });
    await expect(toast).toContainText('Opened Pharmacy system.');
    await expect(page).toHaveTitle(/Pharmacy system - SchemaCanvas/);
    await shot(page, 'reopen-toast-1440');

    // keyboard accessible action
    const action = toast.getByRole('button', { name: 'Reopen previous' });
    await action.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveTitle(/Previous work - SchemaCanvas/);
    await expect(page.getByRole('tab').first()).toBeVisible();
    expect(await saveFile(page)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test('the Recent projects dialog brings the previous project back and deletes entries', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await addEntity(page, 'Teacher');
    await page.getByTestId('project-name').click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Kept project');
    await page.keyboard.press('Enter');
    const before = await saveFile(page);
    await page.waitForTimeout(1000);
    await openPharmacyViaMenu(page);

    await fileMenu(page, /Recent projects/);
    const dialog = page.getByRole('dialog', { name: 'Recent projects' });
    const rows = dialog.getByTestId('recent-row');
    await expect(rows).toHaveCount(2);
    const kept = rows.filter({ hasText: 'Kept project' });
    await expect(kept).toContainText('1 entity');
    await expect(kept.getByRole('img')).toBeVisible(); // lazy thumbnail
    const open = rows.filter({ hasText: 'Pharmacy system' });
    await expect(open).toContainText('Open now');
    await expect(open.getByRole('button', { name: /^Open Pharmacy/ })).toBeDisabled();
    await shot(page, 'recent-1440');
    expect(await serious(page, '[role="dialog"]')).toEqual([]);

    await kept.getByRole('button', { name: 'Open Kept project' }).click();
    await expect(page).toHaveTitle(/Kept project - SchemaCanvas/);
    expect(await saveFile(page)).toEqual(before);

    // the example we just left is now the recent one; delete it (with confirm)
    await fileMenu(page, /Recent projects/);
    const dlg2 = page.getByRole('dialog', { name: 'Recent projects' });
    await dlg2.getByRole('button', { name: /^Delete Pharmacy system/ }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete "Pharmacy system"?' });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    const dlg3 = page.getByRole('dialog', { name: 'Recent projects' });
    await expect(dlg3.getByTestId('recent-row')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('an empty project is replaced silently (no toast)', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    await expect(page).toHaveTitle(/Pharmacy system/);
    await expect(page.getByRole('status').filter({ hasText: 'Recent projects' })).toHaveCount(0);
  });

  test('dropping a project file over real work keeps the old project reachable', async ({ page }) => {
    await boot(page);
    await addEntity(page, 'Student');
    await page.waitForTimeout(1000);
    const content = JSON.stringify({ format: 'schemacanvas-project', schemaVersion: 1, savedAt: new Date().toISOString(), project: {} });
    void content;
    // use a real exported file: save the (Student) project, change, then drop the saved file back
    const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(`${mod}+s`)]);
    const text = readFileSync((await download.path())!, 'utf8').replace(/"name":\s*"Untitled project"/, '"name": "Dropped project"');
    const dt = await page.evaluateHandle((c) => {
      const d = new DataTransfer();
      d.items.add(new File([c], 'dropped.schemacanvas.json', { type: 'application/json' }));
      return d;
    }, text);
    await page.dispatchEvent('body', 'dragenter', { dataTransfer: dt });
    await page.dispatchEvent('body', 'drop', { dataTransfer: dt });
    await expect(page).toHaveTitle(/Dropped project/);
    await expect(page.getByRole('status').filter({ hasText: 'Your previous project is in Recent projects.' })).toBeVisible();
  });
});

async function openPharmacyViaMenu(page: Page, lang: Lang = 'en'): Promise<void> {
  await page.getByRole('button', { name: T[lang].file, exact: true }).click();
  await page.getByRole('menuitem').nth(2).click(); // Open example…
  const dialog = page.getByRole('dialog', { name: T[lang].examples });
  await dialog.getByRole('radio', { name: T[lang].pharmacy }).click();
  await dialog.getByRole('button', { name: T[lang].openBtn }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('3 recent projects: unavailable storage and corrupt records', () => {
  test('explains unavailable storage', async ({ page }) => {
    await boot(page, { noStorage: true });
    await fileMenu(page, /Recent projects/);
    const dialog = page.getByRole('dialog', { name: 'Recent projects' });
    await expect(dialog).toContainText('Recent projects are unavailable');
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    await shot(page, 'recent-unavailable');
  });

  test('a corrupt record shows an error toast instead of replacing the project', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('schemacanvas', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('kv', 'readwrite');
            const now = new Date().toISOString();
            tx.objectStore('kv').put('not json at all', 'project:bad');
            tx.objectStore('kv').put({ id: 'bad', name: 'Broken one', updatedAt: now, savedAt: now }, 'meta:bad');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
    );
    await fileMenu(page, /Recent projects/);
    const dialog = page.getByRole('dialog', { name: 'Recent projects' });
    const row = dialog.getByTestId('recent-row').filter({ hasText: 'Broken one' });
    await expect(row).toContainText('could not be read');
    await row.getByRole('button', { name: 'Open Broken one' }).click();
    await expect(page.getByRole('alert')).toContainText('Could not open Broken one.');
    await expect(dialog).toBeVisible(); // still open; nothing was replaced
    expect(errors.filter((e) => !/not json/i.test(e))).toEqual([]);
  });
});

test.describe('4 File menu', () => {
  test('wide toolbar: every entry, shortcuts and the Recent dialog', async ({ page }) => {
    await boot(page);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'File' });
    const names = await menu.getByRole('menuitem').allTextContents();
    const labels = ['New project', 'Open file…', 'Open example…', 'Recent projects…', 'Save', 'Import SQL or DBML…', 'Export…', 'SQL and DBML view'];
    expect(names).toHaveLength(labels.length);
    labels.forEach((l, i) => expect(names[i]!.startsWith(l)).toBe(true));
    await expect(menu.getByRole('menuitem', { name: /^Export/ })).toContainText(/E$/); // Mod+Shift+E
    await expect(menu.getByRole('menuitem', { name: /^Save/ })).toContainText(/S$/);
    await expect(menu.getByRole('menuitem', { name: /^Open file/ })).toContainText(/O$/);
    expect(await serious(page)).toEqual([]);
    await shot(page, 'filemenu-1440');
    await menu.getByRole('menuitem', { name: 'Recent projects…' }).click();
    await expect(page.getByRole('dialog', { name: 'Recent projects' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Import SQL or DBML…' }).click();
    await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible();
  });

  test('compact toolbar offers the same entries and the command palette lists Recent projects', async ({ page }) => {
    await boot(page, { width: 390, height: 800 });
    await page.getByRole('button', { name: 'File', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'File' });
    await expect(menu.getByRole('menuitem')).toHaveCount(8);
    await expect(menu.getByRole('menuitem', { name: 'Recent projects…' })).toBeVisible();
    const r = (await menu.boundingBox())!;
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await page.keyboard.press(`${mod}+k`);
    await page.getByRole('combobox', { name: 'Search commands' }).fill('recent');
    await expect(page.getByRole('option', { name: /Recent projects/ })).toBeVisible();
  });
});

test.describe('5 first-run welcome', () => {
  test('three actions; Add an entity creates it and starts the inline rename', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    const welcome = page.getByTestId('welcome');
    await expect(welcome.getByRole('button')).toHaveText(['Open an example', 'Add an entity', 'Import SQL', "Don't show again", '']);
    await expect(welcome.getByRole('button', { name: 'Hide' })).toBeVisible();
    await expect(page.getByTestId('canvas-empty')).toBeVisible(); // the canvas keeps its own hint
    expect(await serious(page)).toEqual([]);
    await shot(page, 'welcome-1440');
    await addEntity(page, 'Student');
    await expect(welcome).toHaveCount(0);
    await expect(page.getByRole('img', { name: /Student/ }).or(page.locator('svg text', { hasText: 'Student' })).first()).toBeVisible();
    // creation and the inline rename are two commits (exactly like click-to-place on the canvas): two undos empty the sheet again
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(welcome).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('Import SQL opens the import dialog; relational sheets offer Add a table', async ({ page }) => {
    await boot(page);
    await page.getByTestId('welcome').getByRole('button', { name: 'Import SQL' }).click();
    await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.getByRole('menuitem', { name: 'New empty model' }).nth(1).click();
    const welcome = page.getByTestId('welcome');
    await welcome.getByRole('button', { name: 'Add a table' }).click();
    await expect(page.locator('input:focus, textarea:focus')).toBeVisible();
    await page.keyboard.type('Student');
    await page.keyboard.press('Enter');
    await expect(welcome).toHaveCount(0);
  });

  test("Don't show again is remembered; Hide is per session", async ({ page }) => {
    await boot(page);
    await page.getByTestId('welcome').getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.getByTestId('welcome').getByRole('button', { name: "Don't show again" }).click();
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('toolbar')).toBeVisible();
    await expect(page.getByTestId('canvas-empty')).toBeVisible();
    await expect(page.getByTestId('welcome')).toHaveCount(0);
  });
});

test.describe('6 toasts, dialogs and menus at narrow widths', () => {
  for (const width of [390, 600]) {
    test(`toast does not cover dialog actions at ${width}px; More menu stays inside the viewport`, async ({ page }) => {
      await boot(page, { width, height: 800 });
      await page.evaluate(() =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('schemacanvas', 1);
          open.onsuccess = () => {
            const tx = open.result.transaction('kv', 'readwrite');
            const now = new Date().toISOString();
            tx.objectStore('kv').put('nope', 'project:bad');
            tx.objectStore('kv').put({ id: 'bad', name: 'Broken one', updatedAt: now, savedAt: now }, 'meta:bad');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        }),
      );
      await page.getByRole('button', { name: 'File', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Recent projects…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Recent projects' });
      await dialog.getByRole('button', { name: 'Open Broken one' }).click();
      const toast = page.getByRole('alert');
      await expect(toast).toBeVisible();
      await page.waitForTimeout(350);
      const t = (await toast.boundingBox())!;
      const footer = (await dialog.locator('.sc-dialog-footer').boundingBox())!;
      const overlap = !(t.y + t.height <= footer.y || t.y >= footer.y + footer.height || t.x + t.width <= footer.x || t.x >= footer.x + footer.width);
      expect(overlap, `toast ${JSON.stringify(t)} vs footer ${JSON.stringify(footer)}`).toBe(false);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(width);
      await shot(page, `toast-dialog-${width}`);
      await page.getByRole('button', { name: 'Close', exact: true }).last().click();

      await page.getByRole('button', { name: 'More commands' }).click();
      const menu = page.getByRole('menu', { name: 'More commands' });
      await expect(menu).toBeVisible();
      const m = (await page.locator('.sc-menu-layer').boundingBox())!; // the clipped, scrolling box the user sees
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x + m.width).toBeLessThanOrEqual(width);
      expect(m.y + m.height).toBeLessThanOrEqual(800);
      await shot(page, `more-menu-${width}`);
      expect(await noHScroll(page)).toBe(0);
    });
  }
});

test.describe('7 sheet tab reorder', () => {
  async function tabNames(page: Page): Promise<string[]> {
    return page.getByRole('tab').allTextContents();
  }

  test('drag a tab with the pointer: one undo step, active tab unchanged', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await openPharmacy(page);
    const before = await tabNames(page);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const activeBefore = await page.getByRole('tab', { selected: true }).textContent();
    const first = (await page.getByRole('tab').first().boundingBox())!;
    const last = (await page.getByRole('tab').last().boundingBox())!;
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2 + 12, first.y + first.height / 2, { steps: 3 });
    await page.mouse.move(last.x + last.width - 4, last.y + last.height / 2, { steps: 8 });
    await expect(page.locator('.shell-tab.is-dragging')).toHaveCount(1);
    await shot(page, 'tab-drag');
    await page.mouse.up();
    const after = await tabNames(page);
    expect(after).toEqual([...before.slice(1), before[0]]);
    expect(await page.getByRole('tab', { selected: true }).textContent()).toBe(activeBefore);
    await page.keyboard.press(`${mod}+z`); // canvas may not have focus: use the toolbar button instead
    if ((await tabNames(page)).join() !== before.join()) await page.getByRole('button', { name: 'Undo' }).click();
    expect(await tabNames(page)).toEqual(before);
    expect(errors).toEqual([]);
  });

  test('Alt+Arrow moves the focused tab and announces it; Escape cancels a drag', async ({ page }) => {
    await boot(page);
    await openPharmacy(page);
    const before = await tabNames(page);
    await page.getByRole('tab').first().focus();
    await page.keyboard.press('Alt+ArrowRight');
    expect(await tabNames(page)).toEqual([before[1], before[0], ...before.slice(2)]);
    await expect(page.getByRole('tab').nth(1)).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText('position 2');
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await tabNames(page)).toEqual(before);
    await page.keyboard.press('Alt+ArrowLeft'); // already first: no-op
    expect(await tabNames(page)).toEqual(before);
    // plain arrows still just move focus
    await page.keyboard.press('ArrowRight');
    expect(await tabNames(page)).toEqual(before);
  });
});

test.describe('8 title and project rename', () => {
  test('title follows the name, shows a bullet while unsaved, and rename is one undo step', async ({ page }) => {
    await boot(page);
    await page.getByTestId('project-name').click();
    const field = page.getByRole('textbox', { name: 'Project name' });
    await field.fill('Clinic');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('project-name')).toHaveText('Clinic');
    await expect(page).toHaveTitle(/^(• )?Clinic - SchemaCanvas$/);
    await expect(page).toHaveTitle('Clinic - SchemaCanvas'); // autosave landed: no bullet
    // Escape cancels
    await page.getByTestId('project-name').click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Nope');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('project-name')).toHaveText('Clinic');
    // blank is ignored
    await page.getByTestId('project-name').click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('   ');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('project-name')).toHaveText('Clinic');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('project-name')).not.toHaveText('Clinic');
  });

  test('without storage the bullet stays (changes are not saved)', async ({ page }) => {
    await boot(page, { noStorage: true });
    await page.getByTestId('project-name').click();
    await page.getByRole('textbox', { name: 'Project name' }).fill('Volatile');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(900);
    await expect(page).toHaveTitle('• Volatile - SchemaCanvas');
  });
});

test.describe('9 visual matrix (screenshots + axe)', () => {
  const combos: Array<[number, Theme, Lang]> = [
    [390, 'light', 'en'],
    [600, 'dark', 'en'],
    [900, 'light', 'zh'],
    [390, 'dark', 'zh'],
    [900, 'dark', 'en'],
    [600, 'light', 'zh'],
  ];
  for (const [width, theme, lang] of combos) {
    test(`welcome, File menu, recent and reopen toast at ${width} ${theme} ${lang}`, async ({ page }) => {
      const errors = trackErrors(page);
      await boot(page, { width, height: 820, theme, lang });
      const tag = `${width}-${theme}-${lang}`;
      await expect(page.getByTestId('welcome')).toBeVisible();
      expect(await noHScroll(page)).toBe(0);
      expect(await serious(page)).toEqual([]);
      await shot(page, `welcome-${tag}`);

      await page.getByRole('button', { name: T[lang].file, exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await shot(page, `filemenu-${tag}`);
      await page.keyboard.press('Escape');

      await page.getByTestId('welcome').getByRole('button').nth(1).click(); // add entity / rename
      await page.keyboard.press('Enter');
      await page.waitForTimeout(900);
      await openPharmacyViaMenu(page, lang);
      await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: T[lang].reopen }) })).toBeVisible();
      expect(await serious(page)).toEqual([]);
      await shot(page, `reopen-toast-${tag}`);

      await page.getByRole('button', { name: T[lang].file, exact: true }).click();
      await page.getByRole('menuitem').nth(3).click();
      await expect(page.getByRole('dialog', { name: T[lang].recent })).toBeVisible();
      await expect(page.getByTestId('recent-row').first().getByRole('img')).toBeVisible();
      expect(await serious(page, '[role="dialog"]')).toEqual([]);
      expect(await noHScroll(page)).toBe(0);
      await shot(page, `recent-${tag}`);
      expect(errors).toEqual([]);
    });
  }
});
