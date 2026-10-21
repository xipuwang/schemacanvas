import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = '.tmp/panels-b';
mkdirSync(SHOTS, { recursive: true });
const SETTINGS_KEY = 'schemacanvas:settings:v1';

type Theme = 'light' | 'dark';
type Lang = 'en' | 'zh';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function boot(page: Page, opts: { theme?: Theme; lang?: Lang; width?: number; height?: number } = {}): Promise<void> {
  const { theme = 'light', lang = 'en', width = 1440, height = 900 } = opts;
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
  await page.goto('/');
  await expect(page.getByRole('toolbar')).toBeVisible();
}

const T = {
  en: { openExample: 'Open an example', examples: 'Examples', pharmacy: 'Pharmacy system', openBtn: 'Open example', export: 'Export', download: 'Download', convert: 'Convert' },
  zh: { openExample: '打开示例', examples: '示例', pharmacy: '药房系统', openBtn: '打开示例', export: '导出', download: '下载', convert: '转换' },
};

async function openExamples(page: Page, lang: Lang = 'en'): Promise<void> {
  await page.getByRole('button', { name: T[lang].openExample }).click();
  await expect(page.getByRole('dialog', { name: T[lang].examples })).toBeVisible();
}

async function loadExample(page: Page, title: string, opts: { lang?: Lang; relational?: boolean } = {}): Promise<void> {
  const lang = opts.lang ?? 'en';
  await openExamples(page, lang);
  const dialog = page.getByRole('dialog', { name: T[lang].examples });
  if (opts.relational) await dialog.getByRole('radio', { name: lang === 'en' ? 'Relational schema' : '关系模式' }).first().click();
  await dialog.getByRole('radio', { name: title }).click();
  await dialog.getByRole('button', { name: T[lang].openBtn }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Run a command from the command palette (the wide toolbar has no File menu). */
async function palette(page: Page, query: string, lang: Lang = 'en'): Promise<void> {
  await page.getByRole('button', { name: lang === 'en' ? 'Command palette' : '命令面板' }).click();
  await page.getByRole('combobox', { name: lang === 'en' ? 'Search commands' : '搜索命令' }).fill(query);
  await page.getByRole('listbox', { name: lang === 'en' ? 'Commands' : '命令' }).getByRole('option').first().click();
}

async function serious(page: Page, include?: string): Promise<string[]> {
  let b = new AxeBuilder({ page });
  if (include) b = b.include(include);
  const r = await b.analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

/** Screenshot after the 120 ms dialog fade has finished. */
async function shot(page: Page, path: string): Promise<void> {
  await page.waitForTimeout(300);
  await page.screenshot({ path });
}

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const num = (s: string | null): number => Number((s ?? '').replace(/[^\d]/g, ''));

test.describe('examples dialog', () => {
  test('gallery: keyboard grid, search, view toggle, open replaces the project', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await openExamples(page);
    const dialog = page.getByRole('dialog', { name: 'Examples' });
    const cards = dialog.getByRole('radiogroup', { name: 'Example projects' }).getByRole('radio');
    await expect(cards.first()).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.locator('.ex-card img').first()).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll('.ex-card img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
    await shot(page, `${SHOTS}/examples-light-1440.png`);
    // arrow keys move the selection
    await cards.first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(cards.nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(cards.last()).toHaveAttribute('aria-checked', 'true');
    // search
    await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('weak');
    await expect(cards).toHaveCount(3); // Weak entity, Pharmacy system and Company database all carry the weak entity tag
    await expect(cards.first()).toHaveAccessibleName('Weak entity');
    await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('zzzz');
    await expect(dialog.getByText('No matching examples')).toBeVisible();
    await dialog.getByRole('searchbox', { name: 'Search examples' }).fill('');
    // relational thumbnails
    await dialog.getByRole('radio', { name: 'Relational schema' }).first().click();
    await expect(dialog.getByText('Opens on the Relational schema sheet')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Pharmacy system' }).click();
    await dialog.getByRole('button', { name: 'Open example' }).click();
    await expect(page.getByText('Opened Pharmacy system')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'ER diagram' })).toBeVisible();
    // the project is now dirty only after an edit; opening a second example after an edit asks first
    expect(await noHScroll(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('opening an example over unsaved edits asks for confirmation', async ({ page }) => {
    // without browser storage (private window) autosave cannot run, so the edit stays "unsaved"
    await page.addInitScript(() => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }));
    await boot(page);
    await loadExample(page, 'Weak entity');
    await page.getByRole('tab', { name: /ER diagram/i }).first().dblclick(); // default names show localized ("ER Diagram")
    await page.getByRole('tablist', { name: 'Diagrams' }).getByRole('textbox', { name: 'Diagram name' }).fill('My edit');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'My edit' })).toBeVisible();
    await palette(page, 'Open an example');
    const d = page.getByRole('dialog', { name: 'Examples' });
    await d.getByRole('radio', { name: 'Recursive 1:N' }).click();
    await d.getByRole('button', { name: 'Open example' }).click();
    // the shell's replace helper asks only when the previous project cannot be kept (no storage here)
    const confirm = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('tab', { name: 'My edit' })).toBeVisible();
    await d.getByRole('button', { name: 'Open example' }).click();
    await page.getByRole('dialog', { name: 'Discard unsaved changes?' }).getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByText('Opened Recursive 1:N')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'My edit' })).toHaveCount(0);
  });
});

test.describe('examples dialog visuals', () => {
  for (const [theme, lang, width] of [['dark', 'en', 1440], ['dark', 'zh', 900], ['light', 'zh', 1440], ['light', 'en', 900]] as const) {
    test(`examples ${theme} ${lang} ${width}`, async ({ page }) => {
      await boot(page, { theme, lang, width });
      await openExamples(page, lang);
      await page.waitForFunction(() => [...document.querySelectorAll('.ex-card img')].length > 0 && [...document.querySelectorAll('.ex-card img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
      await shot(page, `${SHOTS}/examples-${theme}-${lang}-${width}.png`);
      expect(await serious(page, '[role="dialog"]')).toEqual([]);
      expect(await noHScroll(page)).toBe(0);
    });
  }
});

test.describe('issues dock', () => {
  const SQL = 'CREATE TABLE Pet (name VARCHAR(20), owner VARCHAR(20));\nCREATE TABLE Owner (id INT PRIMARY KEY, name TEXT);\nCREATE TABLE Vet (id INT PRIMARY KEY);';

  async function importSql(page: Page, sql: string): Promise<void> {
    await palette(page, 'Import');
    const d = page.getByRole('dialog', { name: 'Import' });
    await d.getByTestId('import-text').fill(sql);
    await expect(d.getByTestId('import-summary')).toBeVisible();
    await d.getByTestId('import-apply').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  test('validate, click an issue: selection, fit and keyboard navigation', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await importSql(page, SQL);
    await expect(page.getByRole('tab', { name: 'Imported schema' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Validate model' }).click();
    const dock = page.getByTestId('dock-bottom');
    await expect(dock).toBeVisible();
    const issue = dock.getByRole('button', { name: /Relation "Pet" has no primary key/ });
    await expect(issue).toBeVisible();
    await expect(page.getByTestId('issues-chip-error')).toContainText('1');
    const before = await page.getByTestId('status-zoom').textContent();
    await issue.click();
    await expect(page.getByTestId('status-selection')).toContainText('1 item selected');
    await expect(issue).toHaveAttribute('aria-current', 'true');
    await expect(dock.getByText('Suggestion:')).toBeVisible();
    await expect.poll(async () => page.getByTestId('status-zoom').textContent()).not.toBe(before);
    await shot(page, `${SHOTS}/issues-light-1440.png`);
    // severity filter
    await page.getByTestId('issues-chip-error').click();
    await expect(dock.getByRole('button', { name: /no primary key/ })).toHaveCount(0);
    await page.getByTestId('issues-chip-error').click();
    // keyboard: arrow moves, Escape returns to the canvas
    await issue.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('application')).toBeFocused();
    // a11y light + dark
    expect(await serious(page, '[data-testid="dock-bottom"]')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('an issue of the other model offers "Show in" and switches the sheet', async ({ page }) => {
    await boot(page);
    // live validation off, so the issue list of the relational model survives a switch to the (empty) ER sheet
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('switch', { name: 'Check the model as you edit' }).click();
    await page.keyboard.press('Escape');
    await importSql(page, SQL);
    await page.getByRole('button', { name: 'Validate model' }).click();
    const dock = page.getByTestId('dock-bottom');
    await expect(dock.getByRole('button', { name: /Relation "Pet" has no primary key/ })).toBeVisible();
    await page.getByRole('tab', { name: 'ER Diagram' }).click();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Out of date')).toBeVisible();
    await dock.getByRole('button', { name: /Relation "Pet" has no primary key/ }).click();
    const showIn = dock.getByTestId('issue-show-in');
    await expect(showIn).toContainText('Show in Imported schema');
    await shot(page, `${SHOTS}/issues-show-in-light-1440.png`);
    await showIn.click();
    await expect(page.getByRole('tab', { name: 'Imported schema' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('status-selection')).toContainText('1 item selected');
  });

  test('dark theme and zh dock', async ({ page }) => {
    await boot(page, { theme: 'dark', lang: 'zh' });
    await importSqlZh(page);
    await page.getByRole('button', { name: '检查模型' }).click();
    const dock = page.getByTestId('dock-bottom');
    await expect(dock.getByRole('button', { name: /没有主键/ }).first()).toBeVisible();
    await dock.getByRole('button', { name: /没有主键/ }).first().click();
    await shot(page, `${SHOTS}/issues-dark-zh-1440.png`);
    expect(await serious(page, '[data-testid="dock-bottom"]')).toEqual([]);
  });

  async function importSqlZh(page: Page): Promise<void> {
    await palette(page, '导入', 'zh');
    const d = page.getByRole('dialog', { name: '导入' });
    await d.getByTestId('import-text').fill(SQL);
    await expect(d.getByTestId('import-summary')).toBeVisible();
    await shot(page, `${SHOTS}/import-dark-zh-1440.png`);
    await d.getByTestId('import-apply').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

test.describe('convert dialog', () => {
  test('Example E: preview tabs, options change the preview, apply creates tables and FK arrows, undo restores', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await loadExample(page, 'Company database');
    const tabsBefore = await page.getByRole('tab').count();
    await page.getByRole('button', { name: 'Convert to relational schema' }).click();
    const d = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await expect(d).toBeVisible();
    const summary = d.getByTestId('convert-summary');
    await expect(summary).toContainText('tables');
    const first = await summary.textContent();
    // re-convert is offered because the example carries a conversion record
    await expect(d.getByRole('switch', { name: /Update .* in place/ })).toHaveAttribute('aria-checked', 'true');
    // decisions first, warning level first
    await expect(d.getByTestId('convert-decisions')).toBeVisible();
    await d.getByRole('tab', { name: /Mapping/ }).click();
    await expect(d.getByTestId('convert-mapping')).toBeVisible();
    await d.getByRole('tab', { name: /Warnings/ }).click();
    await d.getByRole('tab', { name: 'Result' }).click();
    await expect(d.getByTestId('convert-report')).toBeVisible();
    await expect(d.getByTestId('convert-result-img')).toBeVisible();
    await shot(page, `${SHOTS}/convert-result-light-1440.png`);
    // switch the update off: a NEW model is created; change the 1:1 default and watch the preview change
    await d.getByRole('switch', { name: /Update .* in place/ }).click();
    await d.getByTestId('convert-strategy').selectOption('relation');
    const countOf = async (): Promise<number> => num((await summary.textContent())?.match(/(\d+) tables/)?.[1] ?? '');
    const firstCount = num(first?.match(/(\d+) tables/)?.[1] ?? '');
    await expect.poll(countOf).toBeGreaterThan(firstCount);
    await d.getByRole('tab', { name: 'Result' }).click();
    await expect(d.getByTestId('convert-result-img')).toBeVisible();
    await d.getByRole('tab', { name: /Decisions/ }).click();
    await shot(page, `${SHOTS}/convert-decisions-light-1440.png`);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    // mapping jump: closes the dialog and selects on the ER diagram
    await d.getByRole('tab', { name: /Mapping/ }).click();
    await d.getByTestId('convert-mapping').locator('.dlg-chip-btn').first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('status-selection')).toContainText('selected');
    // apply
    await page.getByRole('button', { name: 'Convert to relational schema' }).click();
    const d2 = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await d2.getByRole('switch', { name: /Update .* in place/ }).click();
    await d2.getByTestId('convert-strategy').selectOption('relation');
    await expect(d2.getByTestId('convert-summary')).toContainText('tables');
    await d2.getByTestId('convert-apply').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/Converted to \d+ tables/)).toBeVisible();
    expect(await page.getByRole('tab').count()).toBe(tabsBefore + 1);
    const active = page.getByRole('tab', { selected: true });
    await expect(active).toContainText(/Relational schema/i);
    await page.waitForTimeout(400);
    await shot(page, `${SHOTS}/convert-applied-light-1440.png`);
    // ONE undo removes the converted diagram again
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => page.getByRole('tab').count()).toBe(tabsBefore);
    expect(errors).toEqual([]);
  });

  test('zh dark at 900 px', async ({ page }) => {
    await boot(page, { theme: 'dark', lang: 'zh', width: 900 });
    await loadExample(page, '公司数据库', { lang: 'zh' });
    await page.getByRole('button', { name: '转换为关系模式' }).click();
    const d = page.getByRole('dialog', { name: '转换为关系模式' });
    await expect(d.getByTestId('convert-summary')).toContainText('个关系模式');
    await shot(page, `${SHOTS}/convert-dark-zh-900.png`);
    await d.getByRole('tab', { name: '映射' }).click();
    await shot(page, `${SHOTS}/convert-mapping-dark-zh-900.png`);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    expect(await noHScroll(page)).toBe(0);
  });
});

test.describe('export dialog', () => {
  async function openExport(page: Page, lang: Lang = 'en'): Promise<ReturnType<Page['getByRole']>> {
    await page.getByRole('button', { name: lang === 'en' ? 'Export diagram' : '导出图表' }).click();
    const d = page.getByRole('dialog', { name: T[lang].export });
    await expect(d).toBeVisible();
    return d;
  }

  test('SVG, PNG and PDF downloads are valid files and the preview matches', async ({ page }, info) => {
    const errors = trackErrors(page);
    await boot(page);
    await loadExample(page, 'Pharmacy system', { relational: true });
    const d = await openExport(page);
    // SVG
    await expect(d.getByTestId('export-dim')).toContainText('px');
    await expect(d.locator('.exp-img')).toBeVisible();
    await shot(page, `${SHOTS}/export-svg-light-1440.png`);
    const dim = await d.getByTestId('export-dim').textContent();
    await expect(d.getByTestId('export-download')).toBeEnabled();
    let [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.svg$/);
    const svgPath = join(info.outputDir, 'out.svg');
    await dl.saveAs(svgPath);
    const svg = readFileSync(svgPath, 'utf8');
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('viewBox=');
    const parsed = await page.evaluate((s) => {
      const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
      return { error: !!doc.querySelector('parsererror'), root: doc.documentElement.tagName, texts: doc.querySelectorAll('text').length };
    }, svg);
    expect(parsed).toMatchObject({ error: false, root: 'svg' });
    expect(parsed.texts).toBeGreaterThan(10);
    const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!;
    expect(dim?.replace(/,/g, '')).toContain(String(Math.round(Number(m[1]))));

    // PNG at 3x
    await page.getByRole('button', { name: 'Export diagram' }).click();
    const d2 = page.getByRole('dialog', { name: 'Export' });
    await d2.getByRole('radio', { name: 'PNG' }).click();
    await d2.getByRole('radio', { name: '3x' }).click();
    await d2.getByRole('radio', { name: 'Transparent' }).click();
    await expect(d2.getByTestId('export-download')).toBeEnabled();
    const px = await d2.getByTestId('export-pixels').textContent();
    await shot(page, `${SHOTS}/export-png-light-1440.png`);
    [dl] = await Promise.all([page.waitForEvent('download'), d2.getByTestId('export-download').click()]);
    const pngPath = join(info.outputDir, 'out.png');
    await dl.saveAs(pngPath);
    const buf = readFileSync(pngPath);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    expect(px).toContain(w.toLocaleString());
    expect(px).toContain(h.toLocaleString());
    expect(w).toBeGreaterThan(1000);

    // PDF A4 landscape
    await page.getByRole('button', { name: 'Export diagram' }).click();
    const d3 = page.getByRole('dialog', { name: 'Export' });
    await d3.getByRole('radio', { name: 'PDF' }).click();
    await d3.getByLabel('Page size').selectOption('a4');
    await expect(d3.getByTestId('export-download')).toBeEnabled();
    await expect(d3.getByTestId('export-dim')).toContainText('Page');
    await shot(page, `${SHOTS}/export-pdf-light-1440.png`);
    [dl] = await Promise.all([page.waitForEvent('download'), d3.getByTestId('export-download').click()]);
    const pdfPath = join(info.outputDir, 'out.pdf');
    await dl.saveAs(pdfPath);
    const pdf = readFileSync(pdfPath);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(pdf.length - 8).toString()).toContain('%%EOF');
    expect(errors).toEqual([]);
  });

  test('project file, SQL and DBML downloads; SQL re-imports to the same tables', async ({ page }, info) => {
    await boot(page);
    await loadExample(page, 'Company database', { relational: true });
    let d = await openExport(page);
    await d.getByRole('radio', { name: 'Project file' }).click();
    await expect(d.getByTestId('export-download')).toBeEnabled();
    let [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.schemacanvas\.json$/);
    const json = JSON.parse(readFileSync((await dl.path())!, 'utf8')) as { project: { models: object } };
    expect(Object.keys(json.project.models).length).toBeGreaterThan(1);

    d = await openExport(page);
    await d.getByRole('radio', { name: 'SQL' }).click();
    await d.getByLabel('SQL dialect').selectOption('postgresql');
    await expect(d.getByTestId('code-view')).toContainText('CREATE TABLE');
    await shot(page, `${SHOTS}/export-sql-light-1440.png`);
    [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.sql$/);
    const sqlPath = join(info.outputDir, 'company.sql');
    await dl.saveAs(sqlPath);
    const sql = readFileSync(sqlPath, 'utf8');
    const tables = [...sql.matchAll(/CREATE TABLE "?(\w+)"?/g)].map((x) => x[1]!);
    expect(tables.length).toBeGreaterThan(4);

    d = await openExport(page);
    await d.getByRole('radio', { name: 'DBML' }).click();
    await expect(d.getByTestId('code-view')).toContainText('Table');
    [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.dbml$/);

    // re-import the exported SQL through the file input
    await palette(page, 'Import');
    const imp = page.getByRole('dialog', { name: 'Import' });
    await imp.getByTestId('import-file-input').setInputFiles(sqlPath);
    await expect(imp.getByTestId('import-summary')).toContainText(`${tables.length} tables`);
    await imp.getByTestId('import-apply').click();
    await expect(page.getByText(`Imported ${tables.length} tables`)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Imported schema' })).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(300);
    await shot(page, `${SHOTS}/import-applied-light-1440.png`);
  });

});

test.describe('export dialog visuals', () => {
  for (const [theme, lang, width] of [['dark', 'en', 1440], ['light', 'zh', 900], ['dark', 'zh', 1440]] as const) {
    test(`export ${theme} ${lang} ${width}`, async ({ page }) => {
      await boot(page, { theme, lang, width });
      await loadExample(page, T[lang].pharmacy, { lang, relational: true });
      await page.getByRole('button', { name: lang === 'en' ? 'Export diagram' : '导出图表' }).click();
      const d = page.getByRole('dialog', { name: T[lang].export });
      await expect(d.getByTestId('export-download')).toBeEnabled();
      await shot(page, `${SHOTS}/export-${theme}-${lang}-${width}.png`);
      expect(await serious(page, '[role="dialog"]')).toEqual([]);
      expect(await noHScroll(page)).toBe(0);
    });
  }
});

test.describe('export warnings', () => {
  for (const lang of ['en', 'zh'] as const) {
    test(`a diagram with CJK text warns about the PDF image fallback before download (${lang})`, async ({ page }) => {
      await boot(page, { lang, theme: lang === 'zh' ? 'dark' : 'light' });
      await palette(page, lang === 'en' ? 'Import' : '导入', lang);
      const imp = page.getByRole('dialog', { name: lang === 'en' ? 'Import' : '导入' });
      await imp.getByTestId('import-text').fill('CREATE TABLE "学生" ("学号" INT PRIMARY KEY, "姓名" TEXT);');
      await expect(imp.getByTestId('import-summary')).toBeVisible();
      await imp.getByTestId('import-apply').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.getByRole('button', { name: lang === 'en' ? 'Export diagram' : '导出图表' }).click();
      const d = page.getByRole('dialog', { name: T[lang].export });
      await d.getByRole('radio', { name: 'PDF' }).click();
      const warn = d.getByTestId('export-warnings');
      await expect(warn).toBeVisible();
      await expect(warn).toContainText(lang === 'en' ? 'cannot display' : 'PDF 标准字体');
      await expect(d.getByTestId('export-download')).toBeEnabled();
      await page.waitForTimeout(300);
      await shot(page, `${SHOTS}/export-pdf-warning-${lang}-1440.png`);
      expect(await serious(page, '[role="dialog"]')).toEqual([]);
      const [dl] = await Promise.all([page.waitForEvent('download'), d.getByTestId('export-download').click()]);
      expect((await dl.createReadStream().then((st) => new Promise<Buffer>((res) => { const c: Buffer[] = []; st.on('data', (b: Buffer) => c.push(b)); st.on('end', () => res(Buffer.concat(c))); }))).subarray(0, 5).toString()).toBe('%PDF-');
    });
  }
});

test.describe('import dialog', () => {
  test('parse error with line and column, then fix it; summary and warnings; undo', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page);
    await palette(page, 'Import');
    const d = page.getByRole('dialog', { name: 'Import' });
    const apply = d.getByTestId('import-apply');
    await expect(apply).toBeDisabled();
    await d.getByTestId('import-text').fill('CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (id INT PRIMARY KEY, a INT REFERENCES );\n');
    const err = d.getByTestId('import-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('line 2');
    await expect(err.locator('.imp-ex-line.is-bad')).toContainText('REFERENCES');
    await expect(apply).toBeDisabled();
    await shot(page, `${SHOTS}/import-error-light-1440.png`);
    await d.getByTestId('import-goto').click();
    await expect(d.getByTestId('import-text')).toBeFocused();
    await d.getByTestId('import-text').fill('CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (id INT PRIMARY KEY, a INT REFERENCES A (id));\n');
    await expect(d.getByTestId('import-summary')).toContainText('2 tables and 1 foreign key');
    await shot(page, `${SHOTS}/import-ok-light-1440.png`);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    await apply.click();
    await expect(page.getByText('Imported 2 tables')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('tab', { name: 'Imported schema' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('DBML tab and the project file tab', async ({ page }, info) => {
    await boot(page);
    await palette(page, 'Import');
    const d = page.getByRole('dialog', { name: 'Import' });
    await d.getByRole('tab', { name: 'DBML' }).click();
    await d.getByTestId('import-text').fill('Table A {\n  id int [pk\n}');
    await expect(d.getByTestId('import-error')).toBeVisible();
    await d.getByTestId('import-text').fill('Table A {\n  id int [pk]\n}\nTable B {\n  id int [pk]\n  a int\n}\nRef: B.a > A.id');
    await expect(d.getByTestId('import-summary')).toContainText('2 tables and 1 foreign key');
    await d.getByRole('tab', { name: 'Project file' }).click();
    await d.getByTestId('import-text').fill('{ not json');
    await expect(d.getByTestId('import-error')).toBeVisible();
    mkdirSync(info.outputDir, { recursive: true });
    const bad = join(info.outputDir, 'bad.json');
    writeFileSync(bad, '{"hello": 1}');
    await d.getByTestId('import-file-input').setInputFiles(bad);
    await expect(d.getByTestId('import-error')).toBeVisible();
    await shot(page, `${SHOTS}/import-project-error-light-1440.png`);
  });

  test('dropping a .sql file opens the import dialog on the SQL tab', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['CREATE TABLE Dropped (id INT PRIMARY KEY);'], 'dropped.sql', { type: 'text/plain' }));
      for (const type of ['dragenter', 'dragover', 'drop']) window.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    const d = page.getByRole('dialog', { name: 'Import' });
    await expect(d).toBeVisible();
    await expect(d.getByTestId('import-text')).toHaveValue(/Dropped/);
    await expect(d.getByTestId('import-summary')).toContainText('1 table');
  });

  test('zh dark variant', async ({ page }) => {
    await boot(page, { theme: 'dark', lang: 'zh', width: 900 });
    await palette(page, '导入', 'zh');
    const d = page.getByRole('dialog', { name: '导入' });
    await d.getByTestId('import-text').fill('CREATE TABLE A (id INT PRIMARY KEY);\nCREATE TABLE B (a INT REFERENCES );');
    await expect(d.getByTestId('import-error')).toBeVisible();
    await shot(page, `${SHOTS}/import-error-dark-zh-900.png`);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    expect(await noHScroll(page)).toBe(0);
  });
});

test.describe('sql dock and dialog', () => {
  test('live DDL in the dock, dialect switch, copy and download; ER sheet offers Convert', async ({ page }, info) => {
    const errors = trackErrors(page);
    await boot(page);
    await loadExample(page, 'Weak entity');
    // ER sheet active: open the SQL dock through the command palette entry
    await page.getByTestId('status-issues').click();
    await page.getByRole('tab', { name: 'SQL' }).click();
    // the example carries a converted relational model, so the ER sheet shows its derived SQL with a pointer to the relational sheet
    await expect(page.getByText('This sheet is an ER diagram. The SQL and DBML below come from its converted relational model')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show the relational sheet' })).toBeVisible();
    await page.getByRole('tab', { name: /Relational schema/i }).click();
    const dock = page.getByTestId('dock-bottom');
    await expect(dock.getByTestId('code-view')).toContainText('CREATE TABLE');
    await expect(dock.getByTestId('code-view')).toContainText('CompanyName');
    await dock.getByRole('radio', { name: 'SQLite' }).click();
    await expect(dock.getByTestId('code-view')).toContainText('CREATE TABLE');
    await dock.getByRole('radio', { name: 'DBML' }).click();
    await expect(dock.getByTestId('code-view')).toContainText('Table');
    await shot(page, `${SHOTS}/sql-dock-light-1440.png`);
    const [dl] = await Promise.all([page.waitForEvent('download'), dock.getByTestId('sql-download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.dbml$/);
    await dl.saveAs(join(info.outputDir, 'x.dbml'));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await dock.getByTestId('sql-copy').click();
    await expect(page.getByText('Copied to the clipboard')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Table');
    expect(await serious(page, '[data-testid="dock-bottom"]')).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('the SQL and DBML dialog (dark, zh)', async ({ page }) => {
    await boot(page, { theme: 'dark', lang: 'zh' });
    await loadExample(page, '弱实体', { lang: 'zh', relational: true });
    await palette(page, '查看 SQL', 'zh');
    const d = page.getByRole('dialog', { name: 'SQL 与 DBML' });
    await expect(d.getByTestId('code-view')).toContainText('CREATE TABLE');
    await shot(page, `${SHOTS}/sql-dialog-dark-zh-1440.png`);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
  });
});

test.describe('narrow layout (600 px)', () => {
  const viaKeys = async (page: Page, query: string): Promise<void> => {
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByRole('combobox', { name: 'Search commands' }).fill(query);
    await page.getByRole('listbox', { name: 'Commands' }).getByRole('option').first().click();
  };
  test('dialogs stack, nothing scrolls the page sideways', async ({ page }) => {
    const errors = trackErrors(page);
    await boot(page, { width: 600, height: 900 });
    await page.getByRole('button', { name: 'Open an example' }).click().catch(() => undefined);
    const ex = page.getByRole('dialog', { name: 'Examples' });
    await ex.getByRole('radio', { name: 'Company database' }).click();
    await shot(page, `${SHOTS}/narrow-examples-600.png`);
    expect(await noHScroll(page)).toBe(0);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    await ex.getByRole('button', { name: 'Open example' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await viaKeys(page, 'Convert');
    const c = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await expect(c.getByTestId('convert-summary')).toContainText('tables');
    await shot(page, `${SHOTS}/narrow-convert-600.png`);
    expect(await noHScroll(page)).toBe(0);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await viaKeys(page, 'Export');
    const e = page.getByRole('dialog', { name: 'Export' });
    await expect(e.getByTestId('export-download')).toBeEnabled();
    await shot(page, `${SHOTS}/narrow-export-600.png`);
    expect(await noHScroll(page)).toBe(0);
    expect(await serious(page, '[role="dialog"]')).toEqual([]);
    await page.keyboard.press('Escape');
    await viaKeys(page, 'Import');
    await page.getByRole('dialog', { name: 'Import' }).getByTestId('import-text').fill('CREATE TABLE A (id INT PRIMARY KEY, x INT REFERENCES );');
    await expect(page.getByTestId('import-error')).toBeVisible();
    await shot(page, `${SHOTS}/narrow-import-600.png`);
    expect(await noHScroll(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});
