import { test, expect } from './helpers';

test.describe('connect tool (Chen)', () => {
  test('create two entities and a relationship by dragging; connect participants; tool states announce', async ({ t }) => {
    await t.open('empty');
    // two entities via the same code path the library uses (click-to-place would need the library panel)
    await t.state((sc) => {
      const st = sc.store.getState();
      const d = st.project.diagrams[st.activeDiagramId];
      st.commit('seed', (draft: any) => {
        sc.ops.addEntity(draft, d.modelId, { name: 'Student' }, { diagramId: d.id, x: 120, y: 200 });
        sc.ops.addEntity(draft, d.modelId, { name: 'Course' }, { diagramId: d.id, x: 560, y: 200 });
      });
      st.clearHistory();
    });
    await t.page.waitForSelector('[data-node-id]');
    await t.state((sc) => sc.handle.current.fitToContent());
    await t.page.keyboard.press('Escape');
    await t.canvas.focus();
    await t.page.keyboard.press('c');
    await expect(t.page.getByTestId('tool')).toHaveText('connect');
    await expect(t.page.getByTestId('tool-hint')).toContainText('Connect tool');
    await expect(t.page.getByTestId('tools-live')).toContainText('Connect tool');
    await t.shot('connect-01-tool-hint');

    const a = await t.nodeCentre('Student');
    const b = await t.nodeCentre('Course');
    await t.drag(a, { x: (a.x + b.x) / 2, y: a.y - 10 }, { release: false });
    await t.shot('connect-02-mid-drag-ghost');
    await t.page.mouse.move(b.x, b.y, { steps: 4 });
    await expect(t.page.locator('[data-overlay="connect-ghost"] rect[data-tone="ok"]')).toBeVisible();
    await expect(t.page.getByTestId('tool-hint')).toContainText('Release to create a relationship between Student and Course');
    await t.shot('connect-03-over-target');
    await t.page.mouse.up();

    const rel = await t.state((sc) => {
      const st = sc.store.getState();
      const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
      return Object.values<any>(m.relationships).map((r) => ({ name: r.name, participants: r.participants.map((p: any) => ({ e: m.entities[p.entityId].name, max: p.max, part: p.participation })) }));
    });
    expect(rel).toHaveLength(1);
    expect(rel[0]!.participants).toEqual([
      { e: 'Student', max: 'many', part: 'partial' },
      { e: 'Course', max: 'many', part: 'partial' },
    ]);
    expect(await t.undoDepth()).toBe(1);
    // the new relationship is selected and being renamed inline
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.type('Enrols');
    await t.page.keyboard.press('Enter');
    await t.shot('connect-04-created');
    expect(await t.state((sc) => Object.values<any>(sc.store.getState().project.models[sc.store.getState().project.diagrams[sc.store.getState().activeDiagramId].modelId].relationships)[0].name)).toBe('Enrols');

    // relationship <-> relationship style rejection: relationship onto an attribute-less entity is fine; entity -> itself needs leaving first
    await t.page.keyboard.press('Escape');
    await expect(t.page.getByTestId('tool')).toHaveText('select');
  });

  test('entity -> relationship adds a participant; the second drag is a recursive participant with the role edit focused; undo/redo', async ({ t }) => {
    await t.open('chen');
    await t.canvas.focus();
    await t.page.keyboard.press('c');
    const company = await t.nodeCentre('Company');
    const sell = await t.nodeCentre('Sell');
    const count = () => t.state((sc) => {
      const st = sc.store.getState();
      const m = st.project.models[st.project.diagrams[st.activeDiagramId].modelId];
      return Object.values<any>(m.relationships).find((r) => r.name === 'Sell').participants.length as number;
    });
    expect(await count()).toBe(2);
    await t.drag(company, sell);
    expect(await count()).toBe(3);
    await t.page.keyboard.press('Escape'); // toast / selection housekeeping
    await t.canvas.focus();
    await t.page.keyboard.press('c');
    await t.drag(await t.nodeCentre('Company'), await t.nodeCentre('Sell'));
    expect(await count()).toBe(4);
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
    await t.page.keyboard.type('supplier');
    await t.page.keyboard.press('Enter');
    await t.shot('connect-05-recursive');
    // third attempt is refused with an explanation, nothing committed
    const depth = await t.undoDepth();
    await t.canvas.focus();
    await t.page.keyboard.press('c');
    await t.drag(await t.nodeCentre('Company'), await t.nodeCentre('Sell'));
    expect(await t.undoDepth()).toBe(depth);
    await expect(t.page.getByText(/already connected to Sell twice/)).toBeVisible();
    // undo the participant that carried the role, then redo
    await t.page.keyboard.press('Escape');
    await t.canvas.focus();
    await t.page.keyboard.press('ControlOrMeta+z');
    await t.page.keyboard.press('ControlOrMeta+z');
    expect(await count()).toBe(3);
    await t.page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await count()).toBe(4);
  });

  test('rejected targets show red feedback while dragging; Escape cancels the drag', async ({ t }) => {
    await t.open('chen');
    await t.canvas.focus();
    await t.page.keyboard.press('c');
    const contact = await t.nodeCentre('Contact');
    const sell = await t.nodeCentre('Sell');
    await t.drag(contact, sell, { release: false });
    await expect(t.page.locator('[data-overlay="connect-ghost"] rect[data-tone="bad"]')).toBeVisible();
    await expect(t.page.getByTestId('tool-hint')).toHaveAttribute('data-tone', 'bad');
    await t.shot('connect-06-rejected-feedback');
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    await expect(t.page.locator('[data-overlay="connect-ghost"]')).toHaveCount(0);
    expect(await t.undoDepth()).toBe(0);
    // still in the connect tool after cancelling the gesture? Escape cancels the gesture first
    await expect(t.page.getByTestId('tool')).toHaveText('connect');
  });

  test('drag from the connect PORT (select tool) and the connectSelected command', async ({ t }) => {
    await t.open('chen');
    await t.select('Doctor');
    const port = await t.port('connect', 'Doctor');
    await t.shot('connect-07-ports');
    await t.drag(port, await t.nodeCentre('Pharmacy'));
    const n = await t.state((sc) => {
      const st = sc.store.getState();
      return Object.keys(st.project.models[st.project.diagrams[st.activeDiagramId].modelId].relationships).length;
    });
    expect(n).toBe(6);
    // connectSelected: select two entities with shift, run the command
    await t.page.keyboard.press('Escape');
    await t.select('Patient');
    const c = await t.nodeCentre('Company');
    await t.page.keyboard.down('Shift');
    await t.page.mouse.click(c.x, c.y);
    await t.page.keyboard.up('Shift');
    await t.page.evaluate(() => (window as any).__sc.runCommand('chen.connectSelected'));
    const n2 = await t.state((sc) => {
      const st = sc.store.getState();
      return Object.keys(st.project.models[st.project.diagrams[st.activeDiagramId].modelId].relationships).length;
    });
    expect(n2).toBe(7);
    await expect(t.page.locator('.sc-inline-input')).toBeVisible();
  });
});

test('dark theme: ports, handles and the connect ghost are legible (screenshots)', async ({ t }) => {
  await t.open('chen', '?theme=dark');
  await t.select('Patient');
  await t.shot('connect-dark-01-selected');
  const port = await t.port('connect', 'Patient');
  await t.drag(port, await t.nodeCentre('Company'), { release: false });
  await t.shot('connect-dark-02-ghost');
  await t.page.keyboard.press('Escape');
  await t.page.mouse.up();
});
