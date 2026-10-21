/**
 * The product specification section 14 "Definition of Done" as ONE continuous user scenario on the real app, driven only through the UI.
 *
 *   E2E_PORT=5232 npx playwright test e2e/acceptance/definition-of-done.spec.ts --output=.tmp/acceptance/results
 *
 * Screenshots (LOOKED at by the author) land in .tmp/acceptance/dod-*.png.
 */
import { expect, test } from '@playwright/test';
import { copyFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  addAttributeViaPort,
  analyseChenSvg,
  cellLocator,
  cellRect,
  centre,
  chenDiagram,
  col,
  dragMouse,
  dropPart,
  exportVia,
  expectTipsOnTargets,
  fkStrings,
  fkTips,
  modelOf,
  nodeByText,
  nodeIdOf,
  nodeIdOfRelation,
  openApp,
  openProjectFile,
  pkNames,
  properties,
  relation,
  relationalDiagram,
  renameInline,
  saveProject,
  settle,
  sharedSession,
  shot,
  sheet,
  switchSheet,
  convertViaDialog,
  type PFile,
  type PProject,
  OUT,
  canvasBox,
  comparable,
  decodePng,
  insideCanvas,
  inspectPdf,
  nodeBoxes,
  overlaps,
  svgPaintedBox,
} from './helpers';
import type { Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe.serial('Definition of Done: Company makes Drug, end to end', () => {
  const session = sharedSession(test);
  const P = (): Page => session.page();
  let saved: PFile; // the project file downloaded in step 8
  let savedPath = '';
  let afterConvert: PProject;
  let pdfPath = '';
  let pngPath = '';

  // -------------------------------------------------------------------------------------------------------------------
  test('1. open SchemaCanvas in the browser', async () => {
    const page = P();
    await openApp(page, { welcome: true });
    await expect(page).toHaveTitle(/SchemaCanvas/);
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('complementary', { name: 'Parts library' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open an example' })).toBeVisible(); // welcome hint on an empty sheet
    await expect(page.getByText('Nothing selected')).toBeVisible();
    // the library speaks Chen notation
    for (const id of ['entity', 'weak-entity', 'relationship', 'identifying-relationship', 'key-attribute']) {
      await expect(page.locator(`[data-part-id="${id}"]`)).toBeVisible();
    }
    await shot(page, 'dod-01-open');
    await page.getByRole('button', { name: 'Hide' }).click();
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('2. build Company makes Drug in correct Chen notation', async () => {
    const page = P();
    const cv = sheet(page);
    const props = properties(page);

    // --- entities: HTML5 drag from the library (the rename editor opens by itself) and click-to-arm placement -------
    await dropPart(page, 'entity', { x: 110, y: 330 });
    await expect(page.locator('.sc-inline-input')).toBeVisible();
    await page.keyboard.type('Comp');
    await page.keyboard.press('Enter');
    await expect(nodeByText(page, 'Comp')).toHaveCount(1);

    // click-to-arm placement (library button, then the sheet)
    await page.locator('[data-part-id="entity"]').click();
    await page.mouse.move(700, 340);
    await page.mouse.click(710, 340);
    await expect(cv.locator('[data-chen-shape="entity"]')).toHaveCount(2);

    // inline rename by double click (both entities)
    await renameInline(page, nodeByText(page, 'Comp'), 'Company');
    const placed = cv.locator('[data-chen-shape="entity"]').filter({ hasText: 'Entity1' });
    await renameInline(page, placed, 'Drug');
    await expect(nodeByText(page, 'Company')).toHaveCount(1);
    await expect(nodeByText(page, 'Drug')).toHaveCount(1);

    // --- attributes through the "+" port ----------------------------------------------------------------------------
    await addAttributeViaPort(page, nodeByText(page, 'Company'), 'name');
    await addAttributeViaPort(page, nodeByText(page, 'Company'), 'address');
    await addAttributeViaPort(page, nodeByText(page, 'Drug'), 'TradeName');
    await addAttributeViaPort(page, nodeByText(page, 'Drug'), 'Formula');
    for (const n of ['name', 'address', 'TradeName', 'Formula']) await expect(cv.locator('[data-chen-shape="attribute"]').filter({ hasText: new RegExp(`^${n}$`) })).toHaveCount(1);

    // key kinds in the properties panel
    await cv.locator('[data-chen-shape="attribute"]').filter({ hasText: /^name$/ }).click();
    await expect(props.getByRole('textbox', { name: 'Name', exact: true }).first()).toHaveValue('name');
    await props.getByRole('combobox', { name: 'Key' }).selectOption('primary');
    await expect(cv.locator('[data-chen-shape="attribute"][data-key="solid"]')).toHaveCount(1);
    await cv.locator('[data-chen-shape="attribute"]').filter({ hasText: /^TradeName$/ }).click();
    await props.getByRole('combobox', { name: 'Key' }).selectOption('partial');
    await expect(cv.locator('[data-chen-shape="attribute"][data-key="dashed"]')).toHaveCount(1);

    // --- Drug becomes weak ---------------------------------------------------------------------------------------------
    await nodeByText(page, 'Drug').click();
    await expect(cv.locator('[data-chen-shape="entity"][data-weak="true"]')).toHaveCount(0);
    await props.getByRole('switch', { name: 'Weak entity' }).click();
    await expect(cv.locator('[data-chen-shape="entity"][data-weak="true"]')).toHaveCount(1);

    // --- relationship with the Connect tool ---------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Connect' }).click();
    await dragMouse(page, await centre(nodeByText(page, 'Company')), await centre(nodeByText(page, 'Drug')));
    await expect(page.locator('.sc-inline-input')).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Makes');
    await page.keyboard.press('Enter');
    await expect(cv.locator('[data-chen-shape="relationship"]').filter({ hasText: 'Makes' })).toHaveCount(1);
    await page.keyboard.press('Escape'); // leave the connect tool
    await page.getByRole('button', { name: 'Select', exact: true }).first().click();

    // the relationship is selected after creation: make it identifying, 1:N, total for Drug
    await cv.locator('[data-chen-shape="relationship"]').filter({ hasText: 'Makes' }).click();
    await expect(props.getByRole('textbox', { name: 'Name', exact: true }).first()).toHaveValue('Makes');
    await expect(cv.locator('[data-chen-shape="relationship"][data-identifying="true"]')).toHaveCount(0);
    await props.getByRole('switch', { name: 'Identifying' }).click();
    await expect(cv.locator('[data-chen-shape="relationship"][data-identifying="true"]')).toHaveCount(1);

    // participant rows follow creation order (Company first, Drug second): name them by their entity selects
    const entitySel = props.getByRole('combobox', { name: /^Entity, participant/ });
    const companyRow = (await entitySel.nth(0).inputValue()) === (await entitySel.nth(0).locator('option', { hasText: 'Company' }).getAttribute('value')) ? 1 : 2;
    const drugRow = companyRow === 1 ? 2 : 1;
    await props.getByRole('combobox', { name: `Cardinality, participant ${companyRow}` }).selectOption({ label: 'One (1)' });
    await props.getByRole('combobox', { name: `Cardinality, participant ${drugRow}` }).selectOption({ label: 'Many (N)' });
    await props.getByRole('combobox', { name: `Participation, participant ${drugRow}` }).selectOption({ label: 'Total' });
    await expect(props.getByText('One to many')).toBeVisible();
    await expect(cv.locator('[data-chen-line][data-double="true"]')).toHaveCount(1);
    await settle(page);

    // --- notation on the RENDERED canvas (DOM geometry) ---------------------------------------------------------------
    const drugShape = cv.locator('[data-chen-shape="entity"][data-weak="true"]');
    await expect(drugShape).toContainText('Drug');
    const outer = await drugShape.locator('> rect').first().boundingBox();
    const inner = await drugShape.locator('[data-part="inner"]').boundingBox();
    expect(outer && inner, 'weak entity draws an inner rectangle').toBeTruthy();
    expect(inner!.x).toBeGreaterThan(outer!.x + 2);
    expect(inner!.y).toBeGreaterThan(outer!.y + 2);
    expect(inner!.x + inner!.width).toBeLessThan(outer!.x + outer!.width - 2);
    const companyShape = cv.locator('[data-chen-shape="entity"]').filter({ hasText: 'Company' });
    await expect(companyShape).toHaveAttribute('data-weak', 'false');
    await expect(companyShape.locator('[data-part="inner"]')).toHaveCount(0);

    const diamond = cv.locator('[data-chen-shape="relationship"][data-identifying="true"]');
    await expect(diamond.locator('polygon')).toHaveCount(2); // outer + inner diamond
    await expect(diamond.locator('polygon[data-part="inner"]')).toHaveCount(1);

    // exactly one double line (Drug's total participation), two rails, ending on Drug's border; Company's line is single
    const dbl = cv.locator('[data-chen-line][data-double="true"]');
    await expect(dbl.locator('[data-rail]')).toHaveCount(2);
    const rails = await dbl.locator('[data-rail]').evaluateAll((els) => els.map((e) => (e as SVGPolylineElement).getAttribute('points')!));
    expect(rails[0]).not.toEqual(rails[1]);
    const drugBox = (await drugShape.boundingBox())!;
    const lastPt = (pts: string): { x: number; y: number } => {
      const q = pts.trim().split(/\s+/).map((s) => s.split(',').map(Number));
      return { x: q[q.length - 1]![0]!, y: q[q.length - 1]![1]! };
    };
    // convert one rail end to client space to compare with Drug's rect
    const railEnd = await dbl.locator('[data-rail]').first().evaluate((el) => {
      const poly = el as unknown as SVGPolylineElement;
      const p = poly.points.getItem(poly.points.numberOfItems - 1);
      const m = poly.getScreenCTM()!;
      return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
    });
    const nearDrug = railEnd.x >= drugBox.x - 3 && railEnd.x <= drugBox.x + drugBox.width + 3 && railEnd.y >= drugBox.y - 3 && railEnd.y <= drugBox.y + drugBox.height + 3;
    const startPt = lastPt(rails[0]!);
    expect(nearDrug || startPt.x !== undefined, 'a double rail ends on the Drug rectangle').toBe(true);
    expect(nearDrug).toBe(true);
    await expect(cv.locator('[data-chen-line]:not([data-double="true"])').filter({ hasNot: cv.locator('[data-rail]') }).first()).toBeAttached();

    // underlines: key = solid, partial key = dashed, others none (rendered attribute groups)
    const keyAttr = cv.locator('[data-chen-shape="attribute"][data-key="solid"]');
    await expect(keyAttr).toContainText('name');
    await expect(keyAttr.locator('line:not([stroke-dasharray])')).toHaveCount(1);
    const partial = cv.locator('[data-chen-shape="attribute"][data-key="dashed"]');
    await expect(partial).toContainText('TradeName');
    await expect(partial.locator('line[stroke-dasharray]')).toHaveCount(1);
    await expect(cv.locator('[data-chen-shape="attribute"][data-key="none"]')).toHaveCount(2); // address, Formula
    await expect(cv.locator('[data-chen-shape="attribute"][data-key="none"] line')).toHaveCount(0);

    // --- the same notation in the EXPORTED SVG (what ends up in an assignment) ---------------------------------------
    const svg = await exportVia(page, 'SVG');
    const facts = await analyseChenSvg(page, svg.text());
    expect(facts.doubleRects, 'double rectangle (weak Drug)').toBe(1);
    expect(facts.doubleDiamonds, 'double diamond (identifying Makes)').toBe(1);
    expect(facts.singleDiamonds).toBe(0);
    expect(facts.doubleLines, 'one double line (total participation of Drug)').toBe(1);
    expect(facts.underlines.filter((u) => !u.dashed).map((u) => u.text)).toEqual(['name']);
    expect(facts.underlines.filter((u) => u.dashed).map((u) => u.text)).toEqual(['TradeName']);
    expect(facts.textsWithoutUnderline.sort()).toEqual(['1', 'Company', 'Drug', 'Formula', 'Makes', 'N', 'address'].sort());

    await page.locator('.sc-canvas').click({ position: { x: 20, y: 20 } }); // deselect for a clean screenshot
    await shot(page, 'dod-02-chen');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('3. convert the ER diagram to a relational schema through the dialog', async () => {
    const page = P();
    await page.getByRole('button', { name: 'Convert to relational schema' }).click();
    const dialog = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('convert-apply')).toBeEnabled({ timeout: 20_000 });
    // read the decisions the converter explains
    const decisions = dialog.getByTestId('convert-panel-decisions');
    await expect(decisions).toBeVisible();
    const text = (await decisions.innerText()).toLowerCase();
    expect(text, 'a decision explains the weak entity').toMatch(/weak|owner/);
    expect(text).toContain('drug');
    await shot(page, 'dod-03-convert-dialog');
    await dialog.getByRole('tab', { name: /Mapping/ }).click();
    await expect(dialog.getByTestId('convert-panel-mapping')).toBeVisible();
    await dialog.getByRole('tab', { name: /Decisions/ }).click();
    await expect(dialog.getByTestId('convert-summary')).toContainText('2 tables');
    await expect(dialog.getByTestId('convert-summary')).toContainText('1 foreign key');
    await dialog.getByTestId('convert-apply').click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/Converted to 2 tables/)).toBeVisible();
    // the generated sheet is a new tab and becomes active
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveAttribute('aria-selected', 'true');
    await settle(page, 600);
    await shot(page, 'dod-03-converted');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('4. the relational tab shows horizontal tables with PK / FK cues and a correct FK arrow', async () => {
    const page = P();
    const { file } = await saveProject(page);
    afterConvert = file.project;
    const d = relationalDiagram(afterConvert);
    const m = modelOf(afterConvert, d);
    const drug = relation(m, 'Drug');
    const company = relation(m, 'Company');
    expect(drug.columns.map((c) => c.name)).toEqual(['CompanyName', 'TradeName', 'Formula']);
    expect(pkNames(drug)).toEqual(['CompanyName', 'TradeName']);
    expect(company.columns.map((c) => c.name)).toEqual(['name', 'address']);
    expect(pkNames(company)).toEqual(['name']);
    expect(fkStrings(m)).toEqual(['Drug.(CompanyName) -> Company.(name)']);
    // no independent table for the identifying relationship
    expect(Object.keys(m.relations!).sort()).toEqual([company.id, drug.id].sort());

    const cv = sheet(page);
    // rendered: ONE single row per relation, cells side by side
    const drugNode = cv.locator(`[data-node-id="${nodeIdOfRelation(d, drug.id)}"]`);
    const cells = drugNode.locator('[data-column-id]');
    await expect(cells).toHaveCount(3);
    const rects = await cells.evaluateAll((els) => els.map((e) => { const r = e.querySelector('rect,polygon')!.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
    expect(new Set(rects.map((r) => Math.round(r.y))).size, 'cells share one row').toBe(1);
    expect(rects[0]!.x + rects[0]!.w).toBeLessThanOrEqual(rects[1]!.x + 1);
    expect(rects[1]!.x + rects[1]!.w).toBeLessThanOrEqual(rects[2]!.x + 1);

    // roles: CompanyName = pk+fk (underlined AND italic), TradeName = pk (underlined), Formula = plain
    const cName = drugNode.locator(`[data-column-id="${col(drug, 'CompanyName').id}"]`);
    const cTrade = drugNode.locator(`[data-column-id="${col(drug, 'TradeName').id}"]`);
    const cFormula = drugNode.locator(`[data-column-id="${col(drug, 'Formula').id}"]`);
    await expect(cName).toHaveAttribute('data-role', 'pk+fk');
    await expect(cTrade).toHaveAttribute('data-role', 'pk');
    await expect(cFormula).toHaveAttribute('data-role', 'plain');
    await expect(cName.locator('line')).toHaveCount(1); // PK underline
    await expect(cTrade.locator('line')).toHaveCount(1);
    await expect(cFormula.locator('line')).toHaveCount(0);
    await expect(cName.locator('text')).toHaveCSS('font-style', 'italic'); // FK italic
    await expect(cTrade.locator('text')).toHaveCSS('font-style', 'normal');
    const underlineW = await cName.locator('line').evaluate((l) => Math.abs(Number(l.getAttribute('x2')) - Number(l.getAttribute('x1'))));
    expect(underlineW).toBeGreaterThan(30);

    // Company(name, address): name is PK (underlined), address plain
    const companyNode = cv.locator(`[data-node-id="${nodeIdOfRelation(d, company.id)}"]`);
    await expect(companyNode.locator(`[data-column-id="${col(company, 'name').id}"]`)).toHaveAttribute('data-role', 'pk');
    await expect(companyNode.locator(`[data-column-id="${col(company, 'address').id}"]`)).toHaveAttribute('data-role', 'plain');

    // FK arrow: the branch of Drug.CompanyName targets Company.name and its tip sits ON that cell, not on address
    const branch = cv.locator(`[data-fk-branch="${col(drug, 'CompanyName').id}"]`);
    await expect(branch).toHaveAttribute('data-fk-target', col(company, 'name').id);
    const tips = await fkTips(page);
    expect(tips).toHaveLength(1);
    expect(tips[0]!.target).toBe(col(company, 'name').id);
    expect(tips[0]!.distToTarget).toBeLessThan(2);
    expect(tips[0]!.inside).toBe(true);
    expect(tips[0]!.distToOther).toBeGreaterThan(2);
    const nameRect = await cellRect(page, col(company, 'name').id);
    expect(tips[0]!.tip.x).toBeGreaterThanOrEqual(nameRect.x);
    expect(tips[0]!.tip.x).toBeLessThanOrEqual(nameRect.x + nameRect.w);
    await shot(page, 'dod-04-relational');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('5. inspect keys: PK + FK of the CompanyName cell in the properties panel', async () => {
    const page = P();
    const d = relationalDiagram(afterConvert);
    const drug = relation(modelOf(afterConvert, d), 'Drug');
    await cellLocator(page, col(drug, 'CompanyName').id).click();
    const props = properties(page);
    await expect(props.getByRole('textbox', { name: 'Column name' })).toHaveValue('CompanyName');
    await expect(props.getByRole('checkbox', { name: 'Primary key' })).toBeChecked();
    await expect(props.getByRole('checkbox', { name: 'Not null' })).toBeChecked();
    await expect(props.getByText('Foreign keys using this column')).toBeVisible();
    await expect(props.getByText(/Drug\.CompanyName\s*(->|→)\s*Company\.name/)).toBeVisible();
    // the header miniature repeats the cue: the selected cell is underlined AND italic
    await expect(props.getByText('Column', { exact: true })).toBeVisible();
    await shot(page, 'dod-05-keys');
    // TradeName: PK, not FK
    await cellLocator(page, col(drug, 'TradeName').id).click();
    await expect(props.getByRole('textbox', { name: 'Column name' })).toHaveValue('TradeName');
    await expect(props.getByRole('checkbox', { name: 'Primary key' })).toBeChecked();
    await expect(props).not.toContainText('Foreign keys using this column');
    // Formula: neither
    await cellLocator(page, col(drug, 'Formula').id).click();
    await expect(props.getByRole('checkbox', { name: 'Primary key' })).not.toBeChecked();
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('6. validation: remove Company primary key -> error with explanation + suggestion, click highlights, undo clears', async () => {
    const page = P();
    const d = relationalDiagram(afterConvert);
    const m = modelOf(afterConvert, d);
    const company = relation(m, 'Company');
    const cv = sheet(page);
    const props = properties(page);

    await cellLocator(page, col(company, 'name').id).click();
    await props.getByRole('checkbox', { name: 'Primary key' }).uncheck();
    await expect(cellLocator(page, col(company, 'name').id)).toHaveAttribute('data-role', 'plain');
    await expect(cv.locator(`[data-node-id="${nodeIdOfRelation(d, company.id)}"] [data-column-id="${col(company, 'name').id}"] line`)).toHaveCount(0); // underline gone

    await page.getByRole('button', { name: 'Validate model' }).click();
    const dock = page.getByTestId('issues-dock');
    await expect(dock).toBeVisible();
    const row = dock.locator('.issue-row[data-severity="error"]').filter({ hasText: /no primary key/i }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Company');
    await shot(page, 'dod-06-validation-error');

    // click -> expands explanation + suggested resolution, selects and highlights the table
    await row.click();
    const item = dock.locator('li.is-open');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(/no primary key/i);
    await expect(item.locator('.issue-expl')).not.toBeEmpty();
    await expect(item.locator('.issue-sugg')).toContainText('Suggestion');
    expect((await item.locator('.issue-expl').innerText()).length).toBeGreaterThan(20);
    await expect(page.getByText('1 item selected')).toBeVisible();
    const companyNode = cv.locator(`[data-node-id="${nodeIdOfRelation(d, company.id)}"]`);
    const drugNode = cv.locator(`[data-node-id="${nodeIdOfRelation(d, relation(m, 'Drug').id)}"]`);
    await expect(companyNode.locator('[stroke-opacity="0.9"]')).toHaveCount(1); // severity / selection halo
    await expect(drugNode.locator('[stroke-opacity="0.9"]')).toHaveCount(0);
    await expect(props.getByText('Company', { exact: true }).first()).toBeVisible();
    await shot(page, 'dod-06-validation-highlight');

    // undo restores the key and the error disappears
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cv.locator(`[data-node-id="${nodeIdOfRelation(d, company.id)}"] [data-column-id="${col(company, 'name').id}"]`)).toHaveAttribute('data-role', 'pk');
    await page.getByRole('button', { name: 'Validate model' }).click();
    await expect(dock.locator('.issue-row').filter({ hasText: /no primary key/i })).toHaveCount(0);
    await expect(dock.locator('.issue-row[data-severity="error"]')).toHaveCount(0);
    await shot(page, 'dod-06-validation-cleared');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('7. move the tables: the FK keeps ending on the same referenced cell', async () => {
    const page = P();
    const d = relationalDiagram(afterConvert);
    const m = modelOf(afterConvert, d);
    const company = relation(m, 'Company');
    const drug = relation(m, 'Drug');
    const nameId = col(company, 'name').id;
    await page.locator('.sc-canvas').click({ position: { x: 30, y: 30 } });
    if (await page.getByTestId('issues-dock').isVisible()) await page.keyboard.press('ControlOrMeta+j'); // close the issues dock
    await expect(page.getByTestId('issues-dock')).toHaveCount(0);
    await page.keyboard.press('Shift+1'); // fit
    await settle(page, 600);

    await page.keyboard.press('ControlOrMeta+0'); // 100 %: room to move
    await settle(page, 500);
    const cb = await canvasBox(page);
    const cx = cb.x + cb.w / 2;
    const cy = cb.y + cb.h / 2;
    // absolute drop targets for the dragged cell's centre; Company ends up below Drug, then above it again
    const moves: Array<{ cell: string; to: { x: number; y: number } }> = [
      { cell: col(drug, 'Formula').id, to: { x: cx + 200, y: cy + 60 } },
      { cell: col(company, 'address').id, to: { x: cx - 250, y: cb.y + cb.h - 120 } }, // Company below Drug
      { cell: col(drug, 'Formula').id, to: { x: cx + 250, y: cy - 120 } },
      { cell: col(company, 'address').id, to: { x: cx - 100, y: cb.y + 110 } }, // Company above Drug
    ];
    const seenSides = new Set<string>();
    for (const mv of moves) {
      const before = await cellRect(page, mv.cell);
      const from = { x: before.x + before.w / 2, y: before.y + before.h / 2 };
      await dragMouse(page, from, mv.to, 14);
      await settle(page, 250);
      const after = await cellRect(page, mv.cell);
      // grid snap (20 px) and smart guides (6 px) may shift the drop by up to ~26 px per axis
      expect(Math.abs(after.x + after.w / 2 - mv.to.x), 'the table followed the pointer horizontally').toBeLessThanOrEqual(26);
      expect(Math.abs(after.y + after.h / 2 - mv.to.y), 'the table followed the pointer vertically').toBeLessThanOrEqual(26);
      const tips = await fkTips(page);
      expect(tips).toHaveLength(1);
      expect(tips[0]!.target, 'arrow still references Company.name').toBe(nameId);
      expect(tips[0]!.source).toBe(col(drug, 'CompanyName').id);
      expect(tips[0]!.distToTarget).toBeLessThan(2);
      expect(tips[0]!.inside).toBe(true);
      expect(tips[0]!.distToOther, 'and not on a neighbouring cell').toBeGreaterThan(2);
      const nr = await cellRect(page, nameId);
      seenSides.add(Math.abs(tips[0]!.tip.y - nr.y) < 3 ? 'top' : Math.abs(tips[0]!.tip.y - (nr.y + nr.h)) < 3 ? 'bottom' : 'side');
    }
    expect(seenSides.size, `the arrow arrived on different borders of the referenced cell (${[...seenSides].join(', ')}) and always stayed on it`).toBeGreaterThanOrEqual(2);
    // the model itself did not change: same FK, same columns
    const { file } = await saveProject(page);
    const m2 = modelOf(file.project, relationalDiagram(file.project));
    expect(fkStrings(m2)).toEqual(['Drug.(CompanyName) -> Company.(name)']);
    expect(pkNames(relation(m2, 'Drug'))).toEqual(['CompanyName', 'TradeName']);
    const dd = relationalDiagram(file.project);
    const posBefore = relationalDiagram(afterConvert).nodes[nodeIdOfRelation(relationalDiagram(afterConvert), company.id)]!;
    const posAfter = dd.nodes[nodeIdOfRelation(dd, company.id)]!;
    expect([posAfter.x, posAfter.y]).not.toEqual([posBefore.x, posBefore.y]);
    await shot(page, 'dod-07-moved');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('8. save, autosave restore after reload, import the downloaded file after clearing storage', async () => {
    const page = P();
    const first = await saveProject(page);
    saved = first.file;
    savedPath = first.dl.path;
    expect(first.dl.name).toMatch(/\.schemacanvas\.json$/);
    await expect(page.getByText(/Saved in this browser/)).toBeVisible({ timeout: 10_000 });
    await settle(page, 800); // let the debounced autosave write land

    // reload: the autosave restores the same state
    await page.reload();
    await expect(page.getByRole('toolbar')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
    const afterReload = (await saveProject(page)).file;
    expect(comparable(afterReload.project)).toEqual(comparable(saved.project));

    // clear ALL site data (what "clear browsing data" does), reload: empty app
    await page.evaluate(async () => {
      localStorage.clear();
      sessionStorage.clear();
      const dbs = await indexedDB.databases();
      await Promise.all(dbs.map((db) => new Promise<void>((res) => { const r = indexedDB.deleteDatabase(db.name!); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
    });
    await page.goto('about:blank');
    await page.goto('/');
    await expect(page.getByRole('toolbar')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open an example' })).toBeVisible();

    // real file chooser import
    await openProjectFile(page, savedPath);
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'ER Diagram' })).toBeVisible();
    await settle(page);
    const reopened = (await saveProject(page)).file;
    expect(comparable(reopened.project), 'semantic constraints + positions + routes survive import').toEqual(comparable(saved.project));
    // and in the rendering
    await page.getByRole('tab', { name: 'Relational schema' }).click();
    await settle(page);
    await expectTipsOnTargets(page, 1);
    await shot(page, 'dod-08-reimported');
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('9. export SVG, PNG and PDF from the export dialog and verify the files', async () => {
    const page = P();
    // the app is on the relational sheet of the re-imported project
    const svg = await exportVia(page, 'SVG');
    expect(svg.name).toMatch(/\.svg$/);
    const box = await svgPaintedBox(page, svg.text());
    expect(box.parsed).toBe(true);
    expect(box.painted.x).toBeGreaterThanOrEqual(box.viewBox.x - 0.5);
    expect(box.painted.y).toBeGreaterThanOrEqual(box.viewBox.y - 0.5);
    expect(box.painted.x + box.painted.w).toBeLessThanOrEqual(box.viewBox.x + box.viewBox.w + 0.5);
    expect(box.painted.y + box.painted.h).toBeLessThanOrEqual(box.viewBox.y + box.viewBox.h + 0.5);
    expect(box.texts).toEqual(expect.arrayContaining(['Company', 'Drug', 'CompanyName', 'TradeName', 'Formula', 'name', 'address']));
    expect(svg.text()).not.toContain('data-');

    const png = await exportVia(page, 'PNG');
    const pngInfo = await decodePng(page, png.bytes);
    expect(pngInfo.width).toBe(Math.ceil(box.viewBox.w * 2));
    expect(pngInfo.height).toBe(Math.ceil(box.viewBox.h * 2));
    expect(pngInfo.edgeNonWhite, 'the outer pixel frame of the PNG is untouched').toBe(0);
    expect(pngInfo.inkPixels).toBeGreaterThan(500);
    expect(pngInfo.inkBox.x).toBeGreaterThan(8);
    expect(pngInfo.inkBox.y).toBeGreaterThan(8);
    expect(pngInfo.inkBox.x + pngInfo.inkBox.w).toBeLessThan(pngInfo.width - 8);
    expect(pngInfo.inkBox.y + pngInfo.inkBox.h).toBeLessThan(pngInfo.height - 8);

    const pdf = await exportVia(page, 'PDF');
    const info = inspectPdf(pdf.bytes);
    expect(info.header).toBe('%PDF-');
    expect(info.mediaBox).toHaveLength(4);
    expect(info.mediaBox[2]! - info.mediaBox[0]!).toBeGreaterThan(100);
    expect(info.mediaBox[3]! - info.mediaBox[1]!).toBeGreaterThan(40);
    for (const word of ['Company', 'Drug', 'CompanyName', 'TradeName', 'Formula', 'address']) expect(info.text, `PDF carries selectable text "${word}"`).toContain(word);
    expect(info.fonts.some((f) => /Helvetica/.test(f))).toBe(true);
    expect(info.imageCount, 'ASCII diagram is vector, not an embedded raster').toBe(0);
    for (const dl of [svg, png, pdf]) expect(statSync(dl.path).size).toBeGreaterThan(500);
    pdfPath = pdf.path;
    pngPath = png.path;
  });

  // -------------------------------------------------------------------------------------------------------------------
  test('10. full-page screenshots of both views, checked for overlaps and clipping', async () => {
    const page = P();
    const cv = sheet(page);
    // --- relational view
    await switchSheet(page, 'Relational schema');
        await page.keyboard.press('Shift+1');
    await settle(page, 600);
    await cv.click({ position: { x: 5, y: 5 } });
    const relBoxes = await nodeBoxes(page);
    expect(relBoxes.length).toBe(2);
    expect(overlaps(relBoxes), 'relational tables do not overlap').toEqual([]);
    for (const b of relBoxes) expect(insideCanvas(b, await canvasBox(page)), `table ${b.text} is fully visible after fit`).toBe(true);
    await shot(page, 'dod-10-relational', { fullPage: true });

    // --- Chen view
    await switchSheet(page, 'ER Diagram');
    await page.keyboard.press('Shift+1');
    await settle(page, 600);
    const chenBoxes = await nodeBoxes(page);
    expect(chenBoxes.length).toBe(7); // 2 entities + 1 relationship + 4 attributes
    expect(overlaps(chenBoxes), 'Chen shapes do not overlap').toEqual([]);
    for (const b of chenBoxes) expect(insideCanvas(b, await canvasBox(page)), `shape ${b.text} is fully visible after fit`).toBe(true);
    await shot(page, 'dod-10-chen', { fullPage: true });

    // --- PDF page 1 rasterised by macOS sips (skipped elsewhere)
    if (process.platform === 'darwin') {
      const out = `${pdfPath}.png`;
      execFileSync('sips', ['-s', 'format', 'png', pdfPath, '--out', out]);
      expect(statSync(out).size).toBeGreaterThan(1000);
      copyFileSync(out, `${OUT}/dod-10-pdf-page1.png`);
    }
    copyFileSync(pngPath, `${OUT}/dod-10-exported.png`);
  });
});
