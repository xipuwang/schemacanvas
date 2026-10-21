import { test, expect, type Tools } from './helpers';

const attrs = (t: Tools, owner: string) =>
  t.page.evaluate((name) => {
    const st = (window as any).__sc.store.getState();
    const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
    const o = [...Object.values<any>(m.entities), ...Object.values<any>(m.relationships)].find((x) => x.name === name);
    return Object.values<any>(m.attributes)
      .filter((a) => a.owner.id === o.id)
      .map((a) => ({ name: a.name, key: a.key, mv: a.multivalued, derived: a.derived }));
  }, owner);

test.describe('add attribute', () => {
  test('the + port click adds an attribute, selects it and starts the inline rename; type a name, Enter commits (one undo step each)', async ({ t }) => {
    await t.open('chen');
    await t.select('Pharmacy');
    const before = (await attrs(t, 'Pharmacy')).length;
    const depth = await t.undoDepth();
    const port = await t.port('add-attribute', 'Pharmacy');
    await t.page.mouse.move(port.x, port.y);
    expect(await t.page.locator('.sc-canvas__svg').evaluate((e) => (e as HTMLElement).style.cursor)).toBe('pointer');
    await t.shot('attr-01-port-hover');
    await t.page.mouse.click(port.x, port.y);
    expect((await attrs(t, 'Pharmacy')).length).toBe(before + 1);
    expect(await t.undoDepth()).toBe(depth + 1);
    const input = t.page.locator('.sc-inline-input');
    await expect(input).toBeVisible();
    await expect(t.page.getByTestId('tools-live')).toContainText('Added attribute');
    await t.shot('attr-02-inline-rename');
    await t.page.keyboard.type('OpeningHours');
    await t.page.keyboard.press('Enter');
    expect((await attrs(t, 'Pharmacy')).map((a) => a.name)).toContain('OpeningHours');
    // the new attribute is selected and sits clear of every other node
    const clear = await t.page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll<SVGGElement>('[data-node-id]')).map((e) => e.getBoundingClientRect());
      const st = (window as any).__sc.store.getState();
      const sel = st.selection.ids[0];
      const mine = document.querySelector(`[data-node-id="${sel}"]`)!.getBoundingClientRect();
      return boxes.filter((b) => b !== undefined && !(b.left === mine.left && b.top === mine.top)).every((b) => mine.right <= b.left || mine.left >= b.right || mine.bottom <= b.top || mine.top >= b.bottom);
    });
    expect(clear).toBe(true);
    // undo removes the rename and then the attribute
    await t.page.keyboard.press('ControlOrMeta+z');
    await t.page.keyboard.press('ControlOrMeta+z');
    expect((await attrs(t, 'Pharmacy')).length).toBe(before);
  });

  test('press-and-hold on the + port opens the flavour menu; menu items add key / multivalued / derived / composite attributes', async ({ t }) => {
    await t.open('chen');
    await t.select('Company');
    const port = await t.port('add-attribute', 'Company');
    await t.page.mouse.move(port.x, port.y);
    await t.page.mouse.down();
    await t.page.waitForTimeout(600);
    const menu = t.page.getByRole('menu', { name: 'Add attribute' });
    await expect(menu).toBeVisible();
    await t.page.mouse.up();
    await expect(menu).toBeVisible();
    await t.shot('attr-03-flavour-menu');
    await menu.getByRole('menuitem', { name: 'Add multivalued attribute' }).click();
    await expect(menu).toHaveCount(0);
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.press('Enter'); // accept the default name
    expect((await attrs(t, 'Company')).some((a) => a.mv)).toBe(true);

    // composite creates two sub-attributes
    await t.select('Company');
    const p2 = await t.port('add-attribute', 'Company');
    await t.page.mouse.move(p2.x, p2.y);
    await t.page.mouse.down();
    await t.page.waitForTimeout(600);
    await t.page.mouse.up();
    await t.page.getByRole('menuitem', { name: 'Add composite attribute' }).click();
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.press('Enter');
    const nodes = await t.page.locator('[data-node-id]').count();
    expect(nodes).toBeGreaterThan(0);
    const subCount = await t.page.evaluate(() => {
      const st = (window as any).__sc.store.getState();
      const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
      return Object.values<any>(m.attributes).filter((a) => a.owner.kind === 'attribute' && !!m.attributes[a.owner.id] && m.attributes[a.owner.id].owner.kind === 'entity').length;
    });
    expect(subCount).toBeGreaterThanOrEqual(2);
    await t.shot('attr-04-composite');
  });

  test('keyboard: A adds an attribute to the selected owner; context menu offers every flavour; key flavours are disabled on relationships', async ({ t }) => {
    await t.open('chen');
    await t.select('Patient');
    await t.page.keyboard.press('a');
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.type('Email');
    await t.page.keyboard.press('Enter');
    expect((await attrs(t, 'Patient')).map((a) => a.name)).toContain('Email');

    // context menu on the entity
    const c = await t.nodeCentre('Patient');
    await t.page.mouse.click(c.x, c.y, { button: 'right' });
    const menu = t.page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Add key attribute' })).toBeEnabled();
    await expect(menu.getByRole('menuitem', { name: 'Add partial key attribute' })).toBeEnabled();
    await t.shot('attr-05-context-menu');
    await menu.getByRole('menuitem', { name: 'Add key attribute' }).click();
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.press('Enter');
    expect((await attrs(t, 'Patient')).filter((a) => a.key === 'primary').length).toBe(2);

    // relationship: key flavours disabled
    const r = await t.nodeCentre('Sell');
    await t.page.mouse.click(r.x, r.y, { button: 'right' });
    const rm = t.page.getByRole('menu');
    await expect(rm.getByRole('menuitem', { name: 'Add key attribute' })).toBeDisabled();
    await expect(rm.getByRole('menuitem', { name: 'Add derived attribute' })).toBeEnabled();
    await t.page.keyboard.press('Escape');

    // sub-attribute on a composite attribute node (context menu)
    const a = await t.nodeCentre('Speciality');
    await t.page.mouse.click(a.x, a.y, { button: 'right' });
    await t.page.getByRole('menuitem', { name: 'Add sub-attribute' }).click();
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.press('Enter');
    const n = await t.page.evaluate(() => {
      const st = (window as any).__sc.store.getState();
      const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
      return Object.values<any>(m.attributes).filter((x) => x.owner.kind === 'attribute').length;
    });
    expect(n).toBe(1);
  });
});
