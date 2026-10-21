// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { ErModel, Id, Project, RelationalModel, SemanticRef } from '@/model/types';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../../uiStore';
import { DiagramOptionsDialog } from './DiagramForm';
import { PropertiesPanel } from './PropertiesPanel';
import { clearEditError } from './edit';

const st = () => editorStore.getState();
const proj = (): Project => st().project;

function loadEr() {
  const b = erBuilder('Test');
  const dept = b.entity('Department').key('Id');
  const emp = b.entity('Employee').key('Eid').attr('Name');
  const weak = b.entity('Dependent', { weak: true }).partialKey('Nm');
  const rel = b.relate('WorksFor', dept, emp, '1:N');
  const model = b.build();
  const project = createBareProject('t');
  const diagram = withDiagram(project, model, 'chen');
  st().loadProject(project);
  st().setActiveDiagram(diagram.id);
  return { model, diagramId: diagram.id, dept: dept.id, emp: emp.id, weak: weak.id, rel: rel.relationship.id };
}

function loadRel() {
  const b = relationalBuilder('Rel');
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Prescription', ['Id', 'CompanyName', 'DrugTradeName', 'Note'], { pk: ['Id'] });
  const model = b.build();
  const project = createBareProject('t');
  const diagram = withDiagram(project, model, 'relational-schema');
  st().loadProject(project);
  st().setActiveDiagram(diagram.id);
  return { model, diagramId: diagram.id, drug, rx };
}

const nodeOf = (diagramId: Id, kind: string, id: Id): Id => Object.values(proj().diagrams[diagramId]!.nodes).find((n) => n.ref.kind === kind && n.ref.id === id)!.id;
const select = (ids: Id[], sub?: SemanticRef) => act(() => st().setSelection(ids, sub));
const er = (): ErModel => Object.values(proj().models).find((m): m is ErModel => m.kind === 'er')!;
const rel = (): RelationalModel => Object.values(proj().models).find((m): m is RelationalModel => m.kind === 'relational')!;
/** Menu items run on a 0ms timer after the menu closes (so dialogs capture the right focus target). */
const pickMenu = async (name: string) => {
  act(() => void fireEvent.click(screen.getByRole('menuitem', { name })));
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))));
};
const blur = (el: HTMLElement) => act(() => void fireEvent.blur(el));
const type = (el: HTMLElement, value: string) => act(() => void fireEvent.change(el, { target: { value } }));

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  uiStore.setState({ issues: [], dialog: null, toasts: [] });
  clearEditError();
});
afterEach(() => cleanup());

describe('entity panel', () => {
  it('renames on blur through updateEntity as ONE undo step, and refuses an empty name', () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'entity', f.emp)]);
    render(<PropertiesPanel />);
    const name = screen.getByRole('textbox', { name: 'Name' });
    const depth = st().undoStack.length;
    type(name, 'Staff');
    expect(er().entities[f.emp]!.name).toBe('Employee'); // nothing per keystroke
    blur(name);
    expect(er().entities[f.emp]!.name).toBe('Staff');
    expect(st().undoStack.length).toBe(depth + 1);
    type(name, '   ');
    blur(name);
    expect(er().entities[f.emp]!.name).toBe('Staff');
    expect(screen.getByText("Enter a name. It can't be empty.")).toBeTruthy();
    act(() => st().undo());
    expect(er().entities[f.emp]!.name).toBe('Employee');
  });

  it('toggles weak and explains the missing identifying relationship', () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'entity', f.dept)]);
    render(<PropertiesPanel />);
    expect(screen.queryByText(/No identifying relationship yet/)).toBeNull();
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Weak entity' })));
    expect(er().entities[f.dept]!.weak).toBe(true);
    expect(screen.getByText(/No identifying relationship yet/)).toBeTruthy();
  });

  it('adds a key attribute, renames and reorders attributes, sets the data type', async () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'entity', f.emp)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByTestId('add-attribute')));
    await pickMenu('Key attribute');
    const attrs = Object.values(er().attributes).filter((a) => a.owner.id === f.emp);
    expect(attrs).toHaveLength(3);
    const added = attrs.find((a) => a.name !== 'Eid' && a.name !== 'Name')!;
    expect(added.key).toBe('primary');
    // the new node was placed on the sheet next to its owner, one commit
    expect(Object.values(proj().diagrams[f.diagramId]!.nodes).some((n) => n.ref.kind === 'attribute' && n.ref.id === added.id)).toBe(true);
    // rename through the list input
    const row = document.querySelector(`[data-attr-id="${added.id}"]`) as HTMLElement;
    const input = within(row).getByRole('textbox', { name: 'Attribute name' });
    type(input, 'Badge');
    blur(input);
    expect(er().attributes[added.id]!.name).toBe('Badge');
    // reorder: move it up (it is last)
    act(() => void fireEvent.click(within(row).getByRole('button', { name: 'Move Badge up' })));
    const order = Object.values(er().attributes).filter((a) => a.owner.id === f.emp).sort((a, b) => a.order - b.order).map((a) => a.name);
    expect(order).toEqual(['Eid', 'Badge', 'Name']);
    // keyboard reorder on the name input
    act(() => void fireEvent.keyDown(within(row).getByRole('textbox', { name: 'Attribute name' }), { key: 'ArrowDown', altKey: true }));
    expect(Object.values(er().attributes).filter((a) => a.owner.id === f.emp).sort((a, b) => a.order - b.order).map((a) => a.name)).toEqual(['Eid', 'Name', 'Badge']);
    // data type through the details area
    act(() => void fireEvent.click(within(row).getByRole('button', { name: 'Details of Badge' })));
    const type$ = within(row).getByRole('combobox', { name: 'Data type' });
    type(type$, 'VARCHAR(10)');
    blur(type$);
    expect(er().attributes[added.id]!.dataType).toBe('VARCHAR(10)');
  });

  it('adds a composite attribute with two sub-attributes in one commit', async () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'entity', f.emp)]);
    render(<PropertiesPanel />);
    const depth = st().undoStack.length;
    act(() => void fireEvent.click(screen.getByTestId('add-attribute')));
    await pickMenu('Composite attribute');
    expect(st().undoStack.length).toBe(depth + 1);
    const composite = Object.values(er().attributes).find((a) => a.name === 'Composite')!;
    const kids = Object.values(er().attributes).filter((a) => a.owner.kind === 'attribute' && a.owner.id === composite.id);
    expect(kids.map((k) => k.name).sort()).toEqual(['Part 1', 'Part 2']);
  });
});

describe('attribute panel', () => {
  it('sets key kind, multivalued and the derivedFrom picker through ops', () => {
    const f = loadEr();
    const name = Object.values(er().attributes).find((a) => a.name === 'Name')!;
    select([nodeOf(f.diagramId, 'attribute', name.id)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Derived' })));
    expect(er().attributes[name.id]!.derived).toBe(true);
    act(() => void fireEvent.click(within(screen.getByTestId('derived-from')).getByRole('checkbox', { name: 'Eid' })));
    const eid = Object.values(er().attributes).find((a) => a.name === 'Eid')!;
    expect(er().attributes[name.id]!.derivedFrom).toEqual([eid.id]);
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Multivalued' })));
    expect(er().attributes[name.id]!.multivalued).toBe(true);
  });
});

describe('relationship panel', () => {
  it('identified-side hint is accurate: "Total" only when it is total, otherwise "should be Total"', () => {
    const f = loadEr();
    act(() => {
      st().commit('setup', (d) => {
        const m = d.models[er().id] as ErModel;
        m.entities[f.weak]!.weak = true;
        const r = m.relationships[f.rel]!;
        r.identifying = true;
        r.participants[1]!.entityId = f.weak; // weak side, still partial
      });
    });
    select([nodeOf(f.diagramId, 'relationship', f.rel)]);
    render(<PropertiesPanel />);
    expect(screen.getByText('This is the identified side; it should be Total.')).toBeTruthy();
    expect(screen.queryByText('Total, because it is the identified side.')).toBeNull();
    act(() => void fireEvent.change(screen.getByRole('combobox', { name: 'Participation, participant 2' }), { target: { value: 'total' } }));
    expect(screen.getByText('Total, because it is the identified side.')).toBeTruthy();
  });

  it('shows the derived cardinality sentence and edits participants', () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'relationship', f.rel)]);
    render(<PropertiesPanel />);
    const lines = screen.getByTestId('effect-lines');
    expect(within(lines).getByText('Each Employee is related through WorksFor to at most one Department.')).toBeTruthy();
    expect(within(lines).getByText('Each Department is related through WorksFor to any number of Employees.')).toBeTruthy();
    // add a participant: recursive / ternary
    act(() => void fireEvent.click(screen.getByTestId('add-participant')));
    expect(er().relationships[f.rel]!.participants).toHaveLength(3);
    // cardinality + participation of participant 1
    const card = screen.getByRole('combobox', { name: 'Cardinality, participant 1' });
    act(() => void fireEvent.change(card, { target: { value: 'many' } }));
    const p1 = er().relationships[f.rel]!.participants[0]!;
    expect(p1.max).toBe('many');
    act(() => void fireEvent.change(screen.getByRole('combobox', { name: 'Participation, participant 1' }), { target: { value: 'total' } }));
    expect(er().relationships[f.rel]!.participants[0]!.participation).toBe('total');
    // role
    const role = screen.getByRole('textbox', { name: 'Role, participant 1' });
    type(role, 'boss');
    blur(role);
    expect(er().relationships[f.rel]!.participants[0]!.role).toBe('boss');
    // remove participant 3
    act(() => void fireEvent.click(screen.getByRole('button', { name: /Remove participant 3/ })));
    expect(er().relationships[f.rel]!.participants).toHaveLength(2);
  });

  it('turning identifying on needs a choice when no single weak participant exists, then marks the identified side total', () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'relationship', f.rel)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Identifying' })));
    expect(er().relationships[f.rel]!.identifying).toBe(false); // nothing happens until a participant is chosen
    const select$ = screen.getByRole('combobox', { name: 'Identified participant' });
    const emp = er().relationships[f.rel]!.participants.find((p) => p.entityId === f.emp)!;
    act(() => void fireEvent.change(select$, { target: { value: emp.id } }));
    const after = er().relationships[f.rel]!;
    expect(after.identifying).toBe(true);
    expect(after.participants.find((p) => p.id === emp.id)!.participation).toBe('total');
    expect(after.participants.find((p) => p.id === emp.id)!.identified).toBe(true);
  });

  it('M:N and n-ary relationships get a key-participants picker that stores keyParticipantIds', () => {
    const b = erBuilder('t');
    const a = b.entity('A').key('a');
    const c = b.entity('B').key('b');
    const d = b.entity('C').key('c');
    const r = b.relationship('R', [{ entity: a }, { entity: c }, { entity: d, max: 'one' }]);
    const project = createBareProject('t');
    const diagram = withDiagram(project, b.build(), 'chen');
    st().loadProject(project);
    st().setActiveDiagram(diagram.id);
    select([nodeOf(diagram.id, 'relationship', r.relationship.id)]);
    render(<PropertiesPanel />);
    const picker = screen.getByTestId('key-picker');
    // derived key = {A, B}; add C as well
    act(() => void fireEvent.click(within(picker).getByRole('checkbox', { name: 'C' })));
    expect(er().relationships[r.relationship.id]!.keyParticipantIds).toHaveLength(3);
    act(() => void fireEvent.click(within(screen.getByTestId('key-picker')).getByRole('button', { name: 'Use derived key' })));
    expect(er().relationships[r.relationship.id]!.keyParticipantIds).toBeUndefined();
  });
});

describe('table panel', () => {
  it('PK toggle writes relation.primaryKey (append order) and forces NOT NULL', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    select([nodeOf(f.diagramId, 'relation', rx.id)]);
    render(<PropertiesPanel />);
    const noteRow = document.querySelector(`[data-column-id="${f.rx.col('Note')}"]`) as HTMLElement;
    expect(rel().relations[rx.id]!.columns.find((c) => c.name === 'Note')!.nullable).toBe(true);
    act(() => void fireEvent.click(within(noteRow).getByRole('button', { name: /primary key/i })));
    const after = rel().relations[rx.id]!;
    expect(after.primaryKey).toEqual([f.rx.col('Id'), f.rx.col('Note')]);
    expect(after.columns.find((c) => c.name === 'Note')!.nullable).toBe(false);
    // NOT NULL is disabled for PK columns, and removing PK keeps the rest
    act(() => void fireEvent.click(within(noteRow).getByRole('button', { name: /primary key/i })));
    expect(rel().relations[rx.id]!.primaryKey).toEqual([f.rx.col('Id')]);
  });

  it('adds, renames, types, reorders and removes columns', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    select([nodeOf(f.diagramId, 'relation', rx.id)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByTestId('add-column')));
    expect(rel().relations[rx.id]!.columns).toHaveLength(5);
    const added = rel().relations[rx.id]!.columns[4]!;
    const row = document.querySelector(`[data-column-id="${added.id}"]`) as HTMLElement;
    const name = within(row).getByRole('textbox', { name: 'Column name' });
    type(name, 'Dose');
    blur(name);
    const dt = within(row).getByRole('combobox', { name: 'Data type' });
    type(dt, 'INTEGER');
    blur(dt);
    expect(rel().relations[rx.id]!.columns[4]).toMatchObject({ name: 'Dose', dataType: 'INTEGER' });
    act(() => void fireEvent.click(within(row).getByRole('button', { name: 'Move Dose left' })));
    expect(rel().relations[rx.id]!.columns.map((c) => c.name)).toEqual(['Id', 'CompanyName', 'DrugTradeName', 'Dose', 'Note']);
    // keyboard: the handle moves with the arrow keys
    act(() => void fireEvent.keyDown(within(row).getByRole('button', { name: 'Reorder Dose' }), { key: 'ArrowUp' }));
    expect(rel().relations[rx.id]!.columns.map((c) => c.name)).toEqual(['Id', 'CompanyName', 'Dose', 'DrugTradeName', 'Note']);
    act(() => void fireEvent.click(within(row).getByRole('button', { name: 'Remove Dose' })));
    expect(rel().relations[rx.id]!.columns.map((c) => c.name)).not.toContain('Dose');
  });

  it('the composite FK form creates ONE foreign key with ordered pairs, and the card edits the pairs in place', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    select([nodeOf(f.diagramId, 'relation', rx.id)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByTestId('add-fk')));
    const form = screen.getByTestId('new-fk-form');
    // target defaults to the other table; its composite key is pre-mapped by name
    const target = within(form).getByRole('combobox', { name: 'References table' }) as HTMLSelectElement;
    expect(target.value).toBe(f.drug.relation.id);
    act(() => void fireEvent.click(within(form).getByRole('button', { name: 'Create foreign key' })));
    const fks = Object.values(rel().foreignKeys);
    expect(fks).toHaveLength(1);
    expect(fks[0]!.columns).toEqual([
      { sourceColumnId: f.rx.col('CompanyName'), targetColumnId: f.drug.col('CompanyName') },
      { sourceColumnId: f.rx.col('DrugTradeName'), targetColumnId: f.drug.col('TradeName') },
    ]);
    // the card is open: re-map the 2nd pair's source column to Note
    const editor = screen.getByTestId('fk-editor');
    const src2 = within(editor).getByRole('combobox', { name: 'Column 2 in this table' });
    act(() => void fireEvent.change(src2, { target: { value: f.rx.col('Note') } }));
    const after = Object.values(rel().foreignKeys);
    expect(after).toHaveLength(1);
    expect(after[0]!.columns[1]).toEqual({ sourceColumnId: f.rx.col('Note'), targetColumnId: f.drug.col('TradeName') });
    // picking a column used by pair 1 swaps instead of failing
    const src1 = within(screen.getByTestId('fk-editor')).getByRole('combobox', { name: 'Column 1 in this table' });
    act(() => void fireEvent.change(src1, { target: { value: f.rx.col('Note') } }));
    const swapped = Object.values(rel().foreignKeys)[0]!;
    expect(swapped.columns.map((p) => p.sourceColumnId)).toEqual([f.rx.col('Note'), f.rx.col('CompanyName')]);
    // actions
    act(() => void fireEvent.change(within(screen.getByTestId('fk-editor')).getByRole('combobox', { name: 'On delete' }), { target: { value: 'CASCADE' } }));
    expect(Object.values(rel().foreignKeys)[0]!.onDelete).toBe('CASCADE');
  });

  it('"Create columns and key" adds the FK columns and the FK in ONE commit', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    select([nodeOf(f.diagramId, 'relation', rx.id)]);
    render(<PropertiesPanel />);
    const depth = st().undoStack.length;
    act(() => void fireEvent.click(screen.getByTestId('add-fk')));
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Create columns and key' })));
    expect(st().undoStack.length).toBe(depth + 1);
    const after = rel();
    expect(Object.keys(after.foreignKeys)).toHaveLength(1);
    const fk = Object.values(after.foreignKeys)[0]!;
    expect(fk.columns).toHaveLength(2);
    expect(after.relations[rx.id]!.columns.length).toBe(6);
    act(() => st().undo());
    expect(Object.keys(rel().foreignKeys)).toHaveLength(0);
    expect(rel().relations[rx.id]!.columns.length).toBe(4);
  });

  it('an op that throws shows an inline message and leaves the project unchanged', () => {
    const f = loadRel();
    const drug = f.drug.relation;
    const unique = rel();
    st().commit('seed', (d) => void (d.models[unique.id] as RelationalModel).relations[drug.id]!.uniques.push({ id: 'uq_x', columnIds: [f.drug.col('Formula')] }));
    select([nodeOf(f.diagramId, 'relation', drug.id)]);
    render(<PropertiesPanel />);
    const before = proj();
    const chips = screen.getByRole('group', { name: 'Columns of unique constraint 1' });
    act(() => void fireEvent.click(within(chips).getByRole('button', { name: /Formula/ }))); // removing the last column is refused
    expect(proj()).toBe(before);
    expect(screen.getByTestId('edit-error').textContent).toMatch(/That change was not applied/);
  });

  it('selecting one column cell shows the focused column editor', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    const col = f.rx.col('Note');
    select([nodeOf(f.diagramId, 'relation', rx.id)], { kind: 'column', relationId: rx.id, id: col });
    render(<PropertiesPanel />);
    const focus = screen.getByTestId('column-focus');
    const name = within(focus).getByRole('textbox', { name: 'Column name' });
    type(name, 'Remark');
    blur(name);
    expect(rel().relations[rx.id]!.columns.find((c) => c.id === col)!.name).toBe('Remark');
    act(() => void fireEvent.click(within(focus).getByRole('checkbox', { name: 'Unique' })));
    expect(rel().relations[rx.id]!.uniques.some((u) => u.columnIds.length === 1 && u.columnIds[0] === col)).toBe(true);
  });

  it('the header is a live single-row table with PK and FK marks', () => {
    const f = loadRel();
    const rx = f.rx.relation;
    select([nodeOf(f.diagramId, 'relation', rx.id)]);
    render(<PropertiesPanel />);
    act(() => st().commit('fk', (d) => {
      const m = d.models[rel().id] as RelationalModel;
      m.foreignKeys['fk_1'] = { id: 'fk_1', sourceRelationId: rx.id, targetRelationId: f.drug.relation.id, columns: [{ sourceColumnId: f.rx.col('CompanyName'), targetColumnId: f.drug.col('CompanyName') }] };
    }));
    const mini = screen.getByTestId('mini-table');
    const roles = Array.from(mini.querySelectorAll('[data-role]')).map((c) => `${c.textContent}:${c.getAttribute('data-role')}`);
    expect(roles).toEqual(['Id:pk', 'CompanyName:fk', 'DrugTradeName:plain', 'Note:plain']);
  });
});

describe('selection routing', () => {
  it('shows diagram properties with nothing selected and edits them via setDiagramOptions (undoable)', () => {
    const f = loadEr();
    render(<PropertiesPanel />);
    const grid = screen.getByTestId('diagram-grid');
    const snap = within(grid).getByRole('switch', { name: 'Snap to grid' });
    const before = proj().diagrams[f.diagramId]!.options.grid.snap;
    act(() => void fireEvent.click(snap));
    expect(proj().diagrams[f.diagramId]!.options.grid.snap).toBe(!before);
    act(() => st().undo());
    expect(proj().diagrams[f.diagramId]!.options.grid.snap).toBe(before);
    // Chen specific option
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Show data types' })));
    expect(proj().diagrams[f.diagramId]!.options.chen!.showDataTypes).toBe(true);
    // diagram name
    const name = screen.getByRole('textbox', { name: 'Diagram name' });
    type(name, 'Company ER');
    blur(name);
    expect(proj().diagrams[f.diagramId]!.name).toBe('Company ER');
  });

  it('switches panels as the selection changes', () => {
    const f = loadEr();
    render(<PropertiesPanel />);
    expect(screen.getByTestId('diagram-general')).toBeTruthy();
    select([nodeOf(f.diagramId, 'entity', f.emp)]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveProperty('value', 'Employee');
    select([nodeOf(f.diagramId, 'entity', f.emp), nodeOf(f.diagramId, 'entity', f.dept)]);
    expect(screen.getByTestId('multi-title').textContent).toBe('2 items selected');
    act(() => st().clearSelection());
    expect(screen.getByTestId('diagram-general')).toBeTruthy();
  });

  it('a relational diagram exposes the relational options and the model dialect', () => {
    const f = loadRel();
    render(<PropertiesPanel />);
    const rowHeight = screen.getByRole('textbox', { name: 'Row height' });
    type(rowHeight, '40');
    blur(rowHeight);
    expect(proj().diagrams[f.diagramId]!.options.relational!.rowHeight).toBe(40);
    act(() => void fireEvent.change(screen.getByRole('combobox', { name: 'SQL dialect' }), { target: { value: 'postgresql' } }));
    expect(rel().dialect).toBe('postgresql');
  });

  it('multi-selection style edits write one setNodeStyle for every selected node', () => {
    const f = loadEr();
    const ids = [nodeOf(f.diagramId, 'entity', f.emp), nodeOf(f.diagramId, 'entity', f.dept)];
    select(ids);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByText('Appearance')));
    const hex = screen.getAllByRole('textbox', { name: 'Fill' })[0]!;
    const depth = st().undoStack.length;
    type(hex, '#ffeeaa');
    blur(hex);
    expect(st().undoStack.length).toBe(depth + 1);
    for (const id of ids) expect(proj().diagrams[f.diagramId]!.nodes[id]!.style?.fill).toBe('#ffeeaa');
  });
});

describe('issue badges', () => {
  it('lists issues for the selected element and clicking one focuses it and opens the issues dock', () => {
    const f = loadEr();
    const nodeId = nodeOf(f.diagramId, 'entity', f.weak);
    select([nodeId]);
    uiStore.setState({
      issues: [
        {
          id: 'i1',
          code: 'er.weak-no-owner',
          severity: 'warning',
          title: 'Weak entity without owner',
          explanation: 'x',
          suggestion: 'y',
          affected: [{ kind: 'entity', id: f.weak }],
          modelId: er().id,
        },
      ],
    });
    render(<PropertiesPanel />);
    const badges = screen.getByTestId('issue-badges');
    act(() => void fireEvent.click(within(badges).getAllByRole('button')[0]!));
    expect(uiStore.getState().focusedIssueId).toBe('i1');
    expect(uiStore.getState().dock).toBe('issues');
  });
});

describe('diagram-options dialog', () => {
  it('hosts the same form inside a dialog', () => {
    const f = loadEr();
    render(<DiagramOptionsDialog props={{}} onClose={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Diagram options' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('switch', { name: 'Show grid' })));
    expect(proj().diagrams[f.diagramId]!.options.grid.visible).toBe(false);
  });
});

describe('zh locale', () => {
  it('renders the panel in Chinese', () => {
    const f = loadEr();
    settingsStore.getState().setLocale('zh');
    select([nodeOf(f.diagramId, 'entity', f.emp)]);
    render(<PropertiesPanel />);
    expect(screen.getByRole('textbox', { name: '名称' })).toBeTruthy();
    expect(screen.getByText('属性')).toBeTruthy();
  });
});
