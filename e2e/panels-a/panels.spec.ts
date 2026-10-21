import { expect, test } from '@playwright/test';
import { SHOTS, boot, edgePoint, gotoRelationalSheet, noHScroll, openProject, pharmacy, props, selectTable, seriousViolations, trackConsole } from './helpers';

test.use({ screenshot: 'off', trace: 'off', video: 'off' });

const library = (page: import('@playwright/test').Page) => page.getByTestId('dock-library');

test.describe('library panel', () => {
  test('Chen parts show real notation previews; screenshots light, dark, zh', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    const lib = library(page);
    await expect(lib.getByRole('button', { name: /^Entities/ })).toBeVisible();
    for (const id of ['entity', 'weak-entity', 'relationship', 'identifying-relationship', 'key-attribute', 'partial-key', 'multivalued', 'derived', 'composite']) {
      await expect(lib.locator(`[data-part-id="${id}"] svg`)).toBeVisible();
    }
    await expect(lib.getByTestId('library-hint')).toContainText('Drag onto the sheet');
    await page.screenshot({ path: `${SHOTS}/library-light.png` });
    await lib.screenshot({ path: `${SHOTS}/library-light-dock.png` });
    expect(await noHScroll(page)).toEqual({ doc: 0, body: 0 });
    expect(problems).toEqual([]);
  });

  test('dark theme and zh locale', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page, { theme: 'dark', locale: 'zh' });
    await expect(library(page).getByRole('button', { name: /^实体\s*\d/ })).toBeVisible();
    await expect(library(page).locator('[data-part-id="weak-entity"]')).toContainText('弱实体');
    await library(page).screenshot({ path: `${SHOTS}/library-dark-zh-dock.png` });
    await page.screenshot({ path: `${SHOTS}/library-dark-zh.png` });
    expect(problems).toEqual([]);
  });
});

test.describe('Chen authoring through the panels', () => {
  test('drag an entity onto the sheet, rename it, add attributes and a key, relate two entities through the participants table', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    const sheet = page.locator('.sc-canvas').first();
    const box = (await sheet.boundingBox())!;
    const nodes = sheet.locator('[data-node-id]');

    // drag from the library onto the sheet (real HTML5 drag and drop)
    await library(page).locator('[data-part-id="entity"]').dragTo(sheet, { targetPosition: { x: 180, y: 180 } });
    await expect(nodes).toHaveCount(1);
    await page.keyboard.press('Enter'); // accept the default name of the inline rename
    await expect(props(page).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(/^Entity/);

    // rename in the properties panel (commits on Enter, one undo step)
    const name = props(page).getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Student');
    await name.press('Enter');
    await expect(nodes.locator('text', { hasText: /^Student$/ })).toHaveCount(1);

    // attributes: a key attribute, then a plain one with a data type
    await props(page).getByTestId('add-attribute').click();
    await page.getByRole('menuitem', { name: 'Key attribute' }).click();
    const list = props(page).getByTestId('attribute-list');
    await expect(list.locator('li')).toHaveCount(1);
    const keyName = list.getByRole('textbox', { name: 'Attribute name' }).first();
    await expect(keyName).toBeFocused();
    await keyName.fill('SID');
    await keyName.press('Enter');
    await expect(nodes.locator('text', { hasText: /^SID$/ })).toHaveCount(1);
    await props(page).getByTestId('add-attribute').click();
    await page.getByRole('menuitem', { name: 'Attribute', exact: true }).click();
    await expect(list.locator('li')).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/chen-entity-attributes.png` });
    await expect(nodes).toHaveCount(3);

    // click-to-arm: a second entity
    await library(page).locator('[data-part-id="entity"]').click();
    await expect(library(page).getByTestId('library-hint')).toContainText('Click the sheet to place Entity');
    await page.mouse.click(box.x + 560, box.y + 130);
    await page.keyboard.press('Enter');
    await expect(nodes).toHaveCount(4);
    const name2 = props(page).getByRole('textbox', { name: 'Name', exact: true });
    await name2.fill('Course');
    await name2.press('Enter');

    // a relationship, wired up through the participants table
    await library(page).locator('[data-part-id="relationship"]').click();
    await page.mouse.click(box.x + 400, box.y + 330);
    await page.keyboard.press('Enter');
    const rname = props(page).getByRole('textbox', { name: 'Name', exact: true });
    await rname.fill('Enrolls');
    await rname.press('Enter');
    const edges = sheet.locator('[data-edge-id]');
    const edgesBefore = await edges.count();
    await props(page).getByTestId('add-participant').click();
    await props(page).getByTestId('add-participant').click();
    const p1 = props(page).getByRole('combobox', { name: 'Entity, participant 1' });
    const p2 = props(page).getByRole('combobox', { name: 'Entity, participant 2' });
    await p1.selectOption({ label: 'Student' });
    await p2.selectOption({ label: 'Course' });
    await expect(edges).toHaveCount(edgesBefore + 2);
    await props(page).getByRole('combobox', { name: 'Participation, participant 1' }).selectOption('total');
    await expect(props(page).getByTestId('effect-lines')).toContainText('Each Course is related through Enrolls to any number of Students.');
    await expect(props(page).getByTestId('effect-lines')).toContainText('Each Student is related through Enrolls to any number of Courses.');
    await expect(props(page).getByTestId('effect-lines')).toContainText('Every Student must take part in the relationship Enrolls.');
    await page.screenshot({ path: `${SHOTS}/chen-relationship.png` });

    // undo / redo of panel edits (keyboard, focus outside any text field)
    await props(page).getByRole('combobox', { name: 'Participation, participant 1' }).selectOption('partial');
    await props(page).getByRole('heading', { name: 'Participants' }).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(props(page).getByRole('combobox', { name: 'Participation, participant 1' })).toHaveValue('total');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(props(page).getByRole('combobox', { name: 'Participation, participant 1' })).toHaveValue('partial');
    expect(problems).toEqual([]);
  });
});

test.describe('library attributes', () => {
  test('dropping a key attribute onto an entity adds it to that entity and the panel lists it', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    const sheet = page.locator('.sc-canvas').first();
    const nodes = sheet.locator('[data-node-id]');
    await library(page).locator('[data-part-id="entity"]').dragTo(sheet, { targetPosition: { x: 260, y: 220 } });
    await page.keyboard.press('Enter');
    await expect(nodes).toHaveCount(1);
    const entityBox = (await nodes.first().boundingBox())!;
    const target = { x: entityBox.x + entityBox.width / 2 - (await sheet.boundingBox())!.x, y: entityBox.y + entityBox.height / 2 - (await sheet.boundingBox())!.y };
    await library(page).locator('[data-part-id="key-attribute"]').dragTo(sheet, { targetPosition: target });
    await page.keyboard.press('Enter');
    await expect(nodes).toHaveCount(2);
    // select the entity again: its attribute list shows the key attribute
    await nodes.first().click({ position: { x: 6, y: 6 } });
    await expect(props(page).getByTestId('attribute-list').locator('li')).toHaveCount(1);
    expect(problems).toEqual([]);
  });
});

test.describe('relational schema through the panels', () => {
  test('table panel: live mini table, PK toggles, undo and redo', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy');
    await gotoRelationalSheet(page);
    await selectTable(page, 'Doctor');
    const mini = props(page).getByTestId('mini-table');
    await expect(mini.locator('[data-role]')).toHaveCount(4);
    await expect(mini.locator('[data-role="pk"]')).toHaveCount(1);
    await page.screenshot({ path: `${SHOTS}/table-panel.png` });

    const row = props(page).locator('[data-column-id]', { has: page.getByRole('textbox', { name: 'Column name' }) }).filter({ has: page.locator('input[value="Specialty"]') });
    await row.getByRole('button', { name: 'PK, Primary key' }).click();
    await expect(mini.locator('[data-role="pk"]')).toHaveCount(2);
    await expect(props(page).getByTestId('pk-section').getByTestId('pk-item')).toHaveText([/SSN/, /Specialty/]);
    // NOT NULL follows the key
    await expect(row.getByRole('button', { name: 'NN, Not null' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(mini.locator('[data-role="pk"]')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(mini.locator('[data-role="pk"]')).toHaveCount(2);
    // reorder the composite key
    await props(page).getByRole('button', { name: 'Move SSN later in the key' }).click();
    await expect(props(page).getByTestId('pk-section').getByTestId('pk-item')).toHaveText([/Specialty/, /SSN/]);
    expect(problems).toEqual([]);
  });

  test('foreign keys: a composite FK is one card with ordered pairs; edit actions; jump to the connector and its route', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy');
    await gotoRelationalSheet(page);
    await selectTable(page, 'Prescription');
    const section = props(page).getByTestId('fk-section');
    const cards = section.locator('[data-fk-id]');
    await expect(cards).toHaveCount(3);
    const composite = cards.filter({ hasText: 'Drug.(CompanyName, TradeName)' });
    await expect(composite).toHaveCount(1);
    await expect(composite).toContainText('Composite, 2 columns');
    await composite.getByRole('button', { name: /Prescription\.\(CompanyName, DrugTradeName\)/ }).first().click();
    const editor = composite.getByTestId('fk-editor');
    await expect(editor.locator('[data-pair-index]')).toHaveCount(2);
    await expect(editor.getByRole('combobox', { name: 'Column 2 in this table' })).toHaveValue(/col_/);
    await editor.getByRole('combobox', { name: 'On delete' }).selectOption('CASCADE');
    await expect(editor.getByRole('combobox', { name: 'On delete' })).toHaveValue('CASCADE');
    await page.screenshot({ path: `${SHOTS}/fk-card.png` });
    await props(page).screenshot({ path: `${SHOTS}/fk-card-dock.png` });

    // jump to the connector
    await composite.getByRole('button', { name: /^Select Prescription/ }).click();
    await expect(props(page).getByTestId('fk-panel')).toBeVisible();
    const route = props(page).getByTestId('route-section');
    await expect(route).toBeVisible();
    await route.getByRole('radio', { name: 'Manual' }).click();
    await expect(route.getByRole('radio', { name: 'Manual' })).toHaveAttribute('aria-checked', 'true');
    await expect(route.getByText(/\d+ bends/)).toBeVisible();
    await route.getByRole('combobox', { name: 'Side' }).first().selectOption('top');
    await expect(route.getByTestId('anchor-source').getByRole('combobox', { name: 'Side' })).toHaveValue('top');
    await page.screenshot({ path: `${SHOTS}/fk-panel.png` });
    await route.getByRole('button', { name: 'Reset route' }).click();
    await expect(route.getByRole('radio', { name: 'Automatic' })).toHaveAttribute('aria-checked', 'true');
    expect(problems).toEqual([]);
  });

  test('clicking a connector or a column cell on the sheet selects the matching editor', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy');
    await gotoRelationalSheet(page);
    const edge = page.locator('.sc-canvas [data-edge-id]').first();
    const p = await edgePoint(page, edge);
    await page.mouse.click(p.x, p.y);
    await expect(props(page).getByTestId('fk-panel')).toBeVisible();
    // a cell: the first cell of the Doctor table
    const doctor = page.locator('.sc-canvas [data-node-kind="h-table"]', { has: page.locator('text', { hasText: /^Doctor$/ }) }).first();
    const b = (await doctor.boundingBox())!;
    await page.mouse.click(b.x + 8, b.y + b.height * 0.78); // inside the first cell of the single row
    await expect(props(page).getByTestId('column-focus')).toBeVisible();
    await expect(props(page).getByTestId('column-focus').getByRole('textbox', { name: 'Column name' })).toHaveValue('SSN');
    await page.screenshot({ path: `${SHOTS}/column-panel.png` });
    await props(page).getByRole('button', { name: 'Edit table Doctor' }).click();
    await expect(props(page).getByTestId('columns-section')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('multi-selection arranges through commands and styles every node once', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await openProject(page, pharmacy(), 'pharmacy');
    await gotoRelationalSheet(page);
    await selectTable(page, 'Doctor');
    const patient = page.locator('.sc-canvas [data-node-kind="h-table"] text', { hasText: /^Patient$/ }).first();
    const pb = (await patient.boundingBox())!;
    await page.keyboard.down('Shift');
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await page.keyboard.up('Shift');
    await expect(props(page).getByTestId('multi-title')).toHaveText('2 items selected');
    await page.screenshot({ path: `${SHOTS}/multi-panel.png` });
    const left = async (name: string) => (await page.locator('.sc-canvas [data-node-kind="h-table"]', { has: page.locator('text', { hasText: new RegExp(`^${name}$`) }) }).first().boundingBox())!.x;
    await props(page).getByRole('button', { name: 'Align left' }).click();
    await expect.poll(async () => Math.abs((await left('Doctor')) - (await left('Patient')))).toBeLessThan(1.5);
    expect(problems).toEqual([]);
  });

  test('author a schema from the library: table, columns, composite PK, FK with created columns', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    await page.getByRole('button', { name: 'New diagram' }).click();
    await page.locator('[data-item-id="new-relational-schema"]').click();
    await expect(page.getByRole('tab', { name: 'Relational Schema' })).toHaveAttribute('aria-selected', 'true');
    const sheet = page.locator('.sc-canvas').first();
    await expect(library(page).locator('[data-part-id="table"] svg')).toBeVisible();
    await library(page).locator('[data-part-id="table"]').dragTo(sheet, { targetPosition: { x: 200, y: 160 } });
    await page.keyboard.press('Enter');
    const name = props(page).getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('Student');
    await name.press('Enter');
    // columns: rename the first two, make a composite key
    const rows = props(page).getByTestId('column-list').locator('li');
    await expect(rows).toHaveCount(3);
    const c1 = rows.nth(0).getByRole('textbox', { name: 'Column name' });
    await c1.fill('SID');
    await c1.press('Enter');
    const c2 = rows.nth(1).getByRole('textbox', { name: 'Column name' });
    await c2.fill('Term');
    await c2.press('Enter');
    await rows.nth(1).getByRole('button', { name: 'PK, Primary key' }).click();
    await expect(props(page).getByTestId('mini-table').locator('[data-role="pk"]')).toHaveCount(2);
    await rows.nth(0).getByRole('combobox', { name: 'Data type' }).fill('INTEGER');
    await rows.nth(0).getByRole('combobox', { name: 'Data type' }).press('Enter');

    // a second table, then an FK with created columns from it to Student
    await library(page).locator('[data-part-id="table"]').click();
    await page.mouse.click((await sheet.boundingBox())!.x + 480, (await sheet.boundingBox())!.y + 320);
    await page.keyboard.press('Enter');
    const name2 = props(page).getByRole('textbox', { name: 'Name', exact: true });
    await name2.fill('Enrollment');
    await name2.press('Enter');
    const edges = sheet.locator('[data-edge-id]');
    await expect(edges).toHaveCount(0);
    await props(page).getByTestId('add-fk').click();
    await props(page).getByRole('button', { name: 'Create columns and key' }).click();
    await expect(edges).toHaveCount(1);
    const card = props(page).locator('[data-fk-id]').first();
    await expect(card).toContainText('Enrollment.(SID, Term) → Student.(SID, Term)');
    await expect(card).toContainText('Composite, 2 columns');
    await page.screenshot({ path: `${SHOTS}/authored-schema.png` });
    expect(problems).toEqual([]);
  });

  test('templates from the library land on the sheet', async ({ page }) => {
    const problems = trackConsole(page);
    await boot(page);
    const sheet = page.locator('.sc-canvas').first();
    const tpl = library(page).locator('[data-part-id="template-many-to-many"]');
    await expect(tpl.locator('svg')).toBeVisible();
    await tpl.dragTo(sheet, { targetPosition: { x: 320, y: 240 } });
    await expect(sheet.locator('[data-node-id]')).toHaveCount(6); // Student, Course, Enrolls, two keys and Grade
    await page.screenshot({ path: `${SHOTS}/template-inserted.png` });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(sheet.locator('[data-node-id]')).toHaveCount(0); // one undo step
    expect(problems).toEqual([]);
  });
});
