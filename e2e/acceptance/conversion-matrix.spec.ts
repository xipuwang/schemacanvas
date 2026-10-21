/**
 * The product specification section 11 "Model Conversion", through the user interface only:
 * Examples dialog -> open -> Convert dialog (read the explanations) -> Convert -> read the generated model from the
 * DOWNLOADED project file (and the SQL export for the DDL view). Examples A to E plus a ternary built from a library template.
 *
 *   E2E_PORT=5232 npx playwright test e2e/acceptance/conversion-matrix.spec.ts --output=.tmp/acceptance/results
 */
import { expect, test } from './helpers';
import {
  col,
  colNames,
  convertViaDialog,
  endDragSession,
  dropPart,
  exportVia,
  expectTipsOnTargets,
  fkStrings,
  fkTips,
  library,
  modelOf,
  nodeByText,
  openApp,
  openExample,
  pkNames,
  properties,
  relModels,
  relation,
  relationalDiagram,
  saveProject,
  settle,
  shot,
  sheet,
  switchSheet,
  type PFile,
  type PModel,
  type PProject,
} from './helpers';

test.use({ viewport: { width: 1440, height: 900 } });

/** The relational model produced by the LATEST conversion record of a saved project (there may be an older one from the example). */
function latestConversion(p: PProject): { relational: PModel; decisions: Array<{ ruleId: string; title: string; explanation: string }>; er: PModel; record: PProject['conversions'][string] } {
  const records = Object.values(p.conversions);
  expect(records.length, 'the Convert dialog recorded a conversion').toBeGreaterThanOrEqual(1);
  const rec = records.sort((a, b) => ((a as any).createdAt < (b as any).createdAt ? 1 : -1))[0]!;
  return { relational: p.models[rec.relationalModelId]!, er: p.models[rec.erModelId]!, decisions: rec.decisions, record: rec };
}

/** Open example `title` on its ER sheet, remember the ER model, convert through the dialog and return everything the user can inspect. */
async function convertExample(page: import('@playwright/test').Page, title: string, opts: { materialize?: string[] } = {}) {
  await openExample(page, title);
  const before = (await saveProject(page)).file;
  const dialog = await convertViaDialog(page, opts);
  await shot(page, `conv-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`);
  const file: PFile = (await saveProject(page)).file;
  const conv = latestConversion(file.project);
  // the ER model is preserved byte for byte
  expect(conv.er, 'the source ER model is untouched by conversion').toEqual(before.project.models[conv.er.id]);
  return { dialog, file, ...conv };
}

test.describe('conversion matrix: examples A to E through the UI', () => {
  test('A composite + multivalued + derived: flatten, separate relations, derived omitted WITH an explanation', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Composite and multivalued attributes');
    // read the decisions BEFORE applying
    await page.getByRole('button', { name: 'Convert to relational schema' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await expect(dlg.getByTestId('convert-apply')).toBeEnabled({ timeout: 20_000 });
    const panel = dlg.getByTestId('convert-panel-decisions');
    await expect(panel).toContainText('Derived attribute Age is not stored');
    await expect(panel).toContainText(/Age can be computed from DOB/);
    await expect(panel).toContainText('Composite attribute Name is flattened');
    await expect(panel).toContainText('Student.First');
    await expect(panel).toContainText('Multivalued attribute ProgrammingLanguages becomes relation Student_ProgrammingLanguages');
    await expect(dlg.getByRole('group', { name: 'Derived attributes' })).toContainText('Student.Age'); // the option to store it anyway
    await expect(dlg.getByTestId('convert-summary')).toContainText('3 tables');
    await expect(dlg.getByTestId('convert-summary')).toContainText('2 foreign keys');
    await shot(page, 'conv-A-dialog');
    await dlg.getByTestId('convert-apply').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await settle(page);

    const { file } = await saveProject(page);
    const { relational: m, decisions } = latestConversion(file.project);
    const student = relation(m, 'Student');
    // composite flattened: sub-attributes are columns, the composites and the derived attribute are not
    expect(colNames(student)).toEqual(['SID', 'First', 'Middle', 'Last', 'Street', 'City', 'ZipCode', 'DOB']);
    for (const absent of ['Name', 'Address', 'Age', 'ProgrammingLanguages', 'Preference']) expect(colNames(student)).not.toContain(absent);
    expect(pkNames(student)).toEqual(['SID']);
    // multivalued -> separate relations with owner key as FK and composite PK
    for (const mv of ['ProgrammingLanguages', 'Preference']) {
      const r = relation(m, `Student_${mv}`);
      expect(colNames(r)).toEqual(['SID', mv]);
      expect(pkNames(r)).toEqual(['SID', mv]);
    }
    expect(fkStrings(m)).toEqual(['Student_Preference.(SID) -> Student.(SID)', 'Student_ProgrammingLanguages.(SID) -> Student.(SID)']);
    expect(Object.keys(m.relations!)).toHaveLength(3);
    expect(decisions.map((d) => d.ruleId)).toEqual(expect.arrayContaining(['derived-omitted', 'composite-flatten', 'multivalued-relation']));

    // the generated horizontal diagram is on screen: 3 single-row tables, 2 connectors, tips on the referenced SID cell
    await expect(page.getByRole('tab', { name: 'Relational schema' })).toHaveAttribute('aria-selected', 'true');
    await expect(sheet(page).locator('[data-node-id]')).toHaveCount(3);
    await expectTipsOnTargets(page, 2);
    const tips = await fkTips(page);
    expect(new Set(tips.map((t) => t.target)).size).toBe(1);
    expect(tips[0]!.target).toBe(col(student, 'SID').id);
  });

  test('A + materialise: ticking the derived attribute stores Age as an ordinary column', async ({ app: page }) => {
    await openApp(page);
    const r = await convertExample(page, 'Composite and multivalued attributes', { materialize: ['Student.Age'] });
    const student = relation(r.relational, 'Student');
    expect(colNames(student)).toContain('Age');
    expect(student.columns.find((c) => c.name === 'Age')!.nullable, 'a derived value is nullable until computed').toBeDefined();
    expect(r.decisions.map((d) => d.ruleId)).not.toContain('derived-omitted');
    expect(r.record.options.materializeDerived).toHaveLength(1);
  });

  test('B weak entity: PK = owner key + partial key, FK to owner, the identifying relationship makes no table', async ({ app: page }) => {
    await openApp(page);
    const r = await convertExample(page, 'Weak entity');
    const m = r.relational;
    expect(Object.values(m.relations!).map((x) => x.name).sort()).toEqual(['Company', 'Drug']);
    const drug = relation(m, 'Drug');
    expect(colNames(drug)).toEqual(['CompanyName', 'TradeName', 'Formula']);
    expect(pkNames(drug)).toEqual(['CompanyName', 'TradeName']);
    expect(pkNames(relation(m, 'Company'))).toEqual(['name']);
    expect(fkStrings(m)).toEqual(['Drug.(CompanyName) -> Company.(name)']);
    expect(drug.columns.find((c) => c.name === 'CompanyName')!.nullable).toBe(false);
    expect(r.decisions.map((d) => d.title).join('\n')).toMatch(/Weak entity Drug: key = owner key \+ partial key/);
    expect(r.decisions.map((d) => d.title).join('\n')).toMatch(/Identifying relationship Makes creates no table/);
    // in the diagram: the FK arrow ends on Company.name
    const tips = await fkTips(page);
    expect(tips).toHaveLength(1);
    expect(tips[0]!.target).toBe(col(relation(m, 'Company'), 'name').id);
    await expectTipsOnTargets(page, 1);
  });

  test('C recursive 1:N: self-referencing nullable FK on the N side', async ({ app: page }) => {
    await openApp(page);
    const r = await convertExample(page, 'Recursive 1:N');
    const m = r.relational;
    expect(Object.keys(m.relations!)).toHaveLength(1);
    const emp = relation(m, 'Employee');
    expect(colNames(emp)).toEqual(['Eid', 'Name', 'ManagerEid']);
    expect(pkNames(emp)).toEqual(['Eid']);
    expect(emp.columns.find((c) => c.name === 'ManagerEid')!.nullable, 'the top manager has no manager').toBe(true);
    expect(fkStrings(m)).toEqual(['Employee.(ManagerEid) -> Employee.(Eid)']);
    expect(r.decisions.map((d) => d.ruleId)).toContain('recursive-one-to-many-fk');
    // the connector of a self reference starts and ends on the SAME table, tip on Eid
    const tips = await fkTips(page);
    expect(tips).toHaveLength(1);
    expect(tips[0]!.target).toBe(col(emp, 'Eid').id);
    expect(tips[0]!.source).toBe(col(emp, 'ManagerEid').id);
    await expectTipsOnTargets(page, 1);
  });

  test('D recursive M:N: PreReq(Cid, Req_Cid) with two FKs to Course', async ({ app: page }) => {
    await openApp(page);
    const r = await convertExample(page, 'Recursive M:N');
    const m = r.relational;
    expect(Object.values(m.relations!).map((x) => x.name).sort()).toEqual(['Course', 'PreReq']);
    const pre = relation(m, 'PreReq');
    expect(colNames(pre)).toEqual(['Cid', 'Req_Cid']);
    expect(pkNames(pre)).toEqual(['Cid', 'Req_Cid']);
    expect(pkNames(relation(m, 'Course'))).toEqual(['Cid']);
    expect(fkStrings(m)).toEqual(['PreReq.(Cid) -> Course.(Cid)', 'PreReq.(Req_Cid) -> Course.(Cid)']);
    expect(r.decisions.map((d) => d.ruleId)).toContain('recursive-many-to-many-relation');
    const tips = await fkTips(page);
    expect(tips).toHaveLength(2);
    for (const t of tips) expect(t.target).toBe(col(relation(m, 'Course'), 'Cid').id);
    await expectTipsOnTargets(page, 2);
  });

  test('E pharmacy: 1:N on the N side, M:N relations, weak Drug, ternary, relationship attributes, composite FKs', async ({ app: page }) => {
    await openApp(page);
    const r = await convertExample(page, 'Pharmacy system');
    const m = r.relational;
    const names = Object.values(m.relations!).map((x) => x.name).sort();
    expect(names).toEqual(['Company', 'Contact', 'Doctor', 'Drug', 'Patient', 'Pharmacy', 'Prescription', 'Sell']);

    // 1:N (Doctor 1 - N Patient): the FK is in the N side (Patient); Doctor gets nothing
    expect(colNames(relation(m, 'Patient'))).toContain('DoctorSSN');
    expect(colNames(relation(m, 'Doctor'))).toEqual(['SSN', 'Name', 'Specialty', 'YearsOfExperience']);
    expect(fkStrings(m)).toContain('Patient.(DoctorSSN) -> Doctor.(SSN)');
    expect(fkStrings(m)).not.toContain('Doctor.(PatientSSN) -> Patient.(SSN)');

    // weak entity
    expect(pkNames(relation(m, 'Drug'))).toEqual(['CompanyName', 'TradeName']);
    expect(fkStrings(m)).toContain('Drug.(CompanyName) -> Company.(name)');
    expect(names).not.toContain('Makes'); // identifying relationship: no table

    // M:N become independent relations with composite keys of the participants' keys
    expect(pkNames(relation(m, 'Contact'))).toEqual(['CompanyName', 'PharmacyName']);
    expect(fkStrings(m)).toEqual(expect.arrayContaining(['Contact.(CompanyName) -> Company.(name)', 'Contact.(PharmacyName) -> Pharmacy.(Name)']));
    expect(pkNames(relation(m, 'Sell'))).toEqual(['CompanyName', 'DrugTradeName', 'PharmacyName']);
    expect(fkStrings(m)).toEqual(
      expect.arrayContaining(['Sell.(CompanyName,DrugTradeName) -> Drug.(CompanyName,TradeName)', 'Sell.(PharmacyName) -> Pharmacy.(Name)']),
    );

    // relationship attributes are not discarded
    expect(colNames(relation(m, 'Contact'))).toEqual(expect.arrayContaining(['StartDate', 'EndDate', 'Supervisor']));
    expect(relation(m, 'Contact').columns.find((c) => c.name === 'EndDate')!.nullable, 'optional attribute stays nullable').toBe(true);
    expect(colNames(relation(m, 'Sell'))).toContain('Price');
    expect(colNames(relation(m, 'Prescription'))).toEqual(expect.arrayContaining(['Date', 'Quantity']));

    // ternary: three participants kept (composite FK to the weak Drug stays ONE constraint) + key attribute Date in the PK
    const presc = relation(m, 'Prescription');
    expect(fkStrings(m)).toEqual(
      expect.arrayContaining([
        'Prescription.(DoctorSSN) -> Doctor.(SSN)',
        'Prescription.(PatientSSN) -> Patient.(SSN)',
        'Prescription.(CompanyName,DrugTradeName) -> Drug.(CompanyName,TradeName)',
      ]),
    );
    expect(Object.values(m.foreignKeys!).filter((fk) => fk.sourceRelationId === presc.id && fk.columns.length === 2)).toHaveLength(1);
    expect(pkNames(presc)).toEqual(['DoctorSSN', 'PatientSSN', 'CompanyName', 'DrugTradeName', 'Date']);

    // all 9 FKs, no dangling ones
    expect(fkStrings(m)).toHaveLength(9);
    expect(r.decisions.map((d) => d.ruleId)).toEqual(
      expect.arrayContaining(['weak-entity', 'weak-entity-owner-key', 'many-to-many-relation', 'n-ary-relation', 'one-to-many-fk', 'relationship-attribute']),
    );
    // the diagram draws every FK on the exact referenced cells
    const tips = await fkTips(page);
    expect(tips.length).toBe(9); // one grouped connector per logical constraint (this example draws composite FKs as brackets)
    expect(new Set(tips.map((t) => t.edge)).size, 'one connector per FK, composite FKs are ONE constraint').toBe(9);
    await expectTipsOnTargets(page, 9);
    await expect(sheet(page).locator('[data-node-id]')).toHaveCount(8);

    // the SQL view of the same model keeps the keys (what ends up in a database)
    const sql = await exportVia(page, 'SQL', async (dlg) => {
      await dlg.getByRole('combobox', { name: 'SQL dialect' }).selectOption({ label: 'PostgreSQL' });
    });
    const ddl = sql.text();
    expect(ddl).toMatch(/CREATE TABLE "?Drug"?/);
    expect(ddl).toMatch(/PRIMARY KEY \("?CompanyName"?, "?TradeName"?\)/);
    expect(ddl).toMatch(/FOREIGN KEY \("?CompanyName"?, "?DrugTradeName"?\)\s+REFERENCES "?Drug"? \("?CompanyName"?, "?TradeName"?\)/);
    expect(ddl).toMatch(/FOREIGN KEY \("?DoctorSSN"?\)\s+REFERENCES "?Doctor"? \("?SSN"?\)/);
  });

  test('derived and warnings in the dialog: a clean example reports no warnings, mapping lists every ER element', async ({ app: page }) => {
    await openApp(page);
    await openExample(page, 'Weak entity');
    await page.getByRole('button', { name: 'Convert to relational schema' }).click();
    const dlg = page.getByRole('dialog', { name: 'Convert to relational schema' });
    await expect(dlg.getByTestId('convert-apply')).toBeEnabled({ timeout: 20_000 });
    await dlg.getByRole('tab', { name: /Warnings/ }).click();
    await expect(dlg.getByTestId('convert-panel-warnings')).toContainText('No warnings');
    await dlg.getByRole('tab', { name: /Mapping/ }).click();
    const mapping = dlg.getByTestId('convert-panel-mapping');
    await expect(mapping).toContainText('Drug');
    await expect(mapping).toContainText('Drug.CompanyName');
    await dlg.getByRole('tab', { name: /Result/ }).click();
    await expect(dlg.getByRole('group', { name: 'Generated horizontal schema' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('conversion matrix: ternary relationships and roles (library template)', () => {
  test('ternary: key participants decide the PK; roles and relationship attributes survive', async ({ app: page }) => {
    await openApp(page);
    // drop the ternary template from the library onto the sheet (real HTML5 drag)
    await library(page).locator('[data-part-id="template-ternary"]').dragTo(sheet(page), { targetPosition: { x: 420, y: 330 } });
    await endDragSession(page);
    await expect(sheet(page).locator('[data-chen-shape="relationship"]').filter({ hasText: 'Supplies' })).toHaveCount(1);
    await settle(page);
    // select the relationship; set Project's cardinality to One: a project is supplied by one (Supplier, Part) pair -> key {Supplier, Part}
    await sheet(page).locator('[data-chen-shape="relationship"]').filter({ hasText: 'Supplies' }).click();
    const props = properties(page);
    const entityOf = async (n: number): Promise<string> => (await props.getByRole('combobox', { name: `Entity, participant ${n}` }).evaluate((s: HTMLSelectElement) => s.selectedOptions[0]!.textContent ?? '')) as string;
    const rows = [await entityOf(1), await entityOf(2), await entityOf(3)];
    expect(rows.sort()).toEqual(['Part', 'Project', 'Supplier']);
    const projectRow = [await entityOf(1), await entityOf(2), await entityOf(3)].indexOf('Project') + 1;
    await props.getByRole('combobox', { name: `Cardinality, participant ${projectRow}` }).selectOption({ label: 'One (1)' });
    await props.getByRole('textbox', { name: `Role, participant ${projectRow}` }).fill('site').catch(async () => props.getByPlaceholder(/manager/).nth(projectRow - 1).fill('site'));
    await page.keyboard.press('Tab');
    await expect(props.getByText('Candidate keys:')).toContainText(/Supplier/);
    await shot(page, 'conv-ternary-er');

    await convertViaDialog(page);
    const { file } = await saveProject(page);
    const { relational: m, decisions } = latestConversion(file.project);
    const sup = relation(m, 'Supplies');
    // the three entity keys are FKs; Quantity (relationship attribute) is kept
    expect(fkStrings(m).filter((s) => s.startsWith('Supplies.'))).toHaveLength(3);
    expect(colNames(sup)).toContain('Quantity');
    // PK follows the candidate key {Supplier, Part}; Project's key is NOT part of it
    const pk = pkNames(sup);
    expect(pk).toHaveLength(2);
    expect(pk.some((n) => /Supplier/i.test(n))).toBe(true);
    expect(pk.some((n) => /Part/i.test(n))).toBe(true);
    expect(pk.some((n) => /Project|site/i.test(n))).toBe(false);
    // the role name shows up where the Project key is stored
    expect(colNames(sup).some((n) => /site/i.test(n)), `a column carries the role name (${colNames(sup).join(', ')})`).toBe(true);
    expect(decisions.map((d) => d.ruleId)).toContain('n-ary-relation');
    await expectTipsOnTargets(page, 3);
  });
});
