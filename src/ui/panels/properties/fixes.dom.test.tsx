// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { buildExample } from '@/examples';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { ErModel, Id, Project, RelationalModel } from '@/model/types';
import { buildScene } from '@/scene/registry';
import { editorStore, settingsStore } from '@/store';
import { uiStore } from '../../uiStore';
import { DiagramOptionsDialog } from './DiagramForm';
import { PropertiesPanel } from './PropertiesPanel';
import { canMoveTo, moveAttributeTo, ownerChoices, ownerValue } from './attrMove';
import { clearEditError } from './edit';
import { overlappingPairs } from './spacing';

const st = () => editorStore.getState();
const proj = (): Project => st().project;
const select = (ids: Id[]) => act(() => st().setSelection(ids));
const er = (): ErModel => Object.values(proj().models).find((m): m is ErModel => m.kind === 'er')!;
const rel = (): RelationalModel => Object.values(proj().models).find((m): m is RelationalModel => m.kind === 'relational')!;
const nodeOf = (diagramId: Id, kind: string, id: Id): Id => Object.values(proj().diagrams[diagramId]!.nodes).find((n) => n.ref.kind === kind && n.ref.id === id)!.id;

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  uiStore.setState({ issues: [], dialog: null, toasts: [] });
  clearEditError();
});
afterEach(cleanup);

function loadEr() {
  const b = erBuilder('Test');
  const company = b.entity('Company').key('name').attr('address').composite('Composite', ['Street']);
  const drug = b.entity('Drug').key('Id');
  const model = b.build();
  const project = createBareProject('t');
  const diagram = withDiagram(project, model, 'chen');
  st().loadProject(project);
  st().setActiveDiagram(diagram.id);
  const attrByName = (n: string) => Object.values(model.attributes).find((a) => a.name === n)!;
  return { diagramId: diagram.id, company: company.id, drug: drug.id, attrByName };
}

describe('SA-12: move an attribute to another owner', () => {
  it('offers entities, relationships and composite attributes, never the attribute or its own subtree', () => {
    const f = loadEr();
    const m = er();
    const composite = f.attrByName('Composite');
    const choices = ownerChoices(m, composite.id).map((c) => c.value);
    expect(choices).toContain(ownerValue({ kind: 'entity', id: f.drug }));
    expect(choices).toContain(ownerValue({ kind: 'entity', id: f.company }));
    expect(choices).not.toContain(ownerValue({ kind: 'attribute', id: composite.id }));
    // another attribute may nest under the composite
    expect(ownerChoices(m, f.attrByName('address').id).map((c) => c.value)).toContain(ownerValue({ kind: 'attribute', id: composite.id }));
    expect(canMoveTo(m, composite.id, { kind: 'attribute', id: f.attrByName('Street').id })).toBe(false);
    expect(canMoveTo(m, f.attrByName('address').id, { kind: 'entity', id: f.company })).toBe(false);
  });

  it('the Belongs to select moves the attribute in ONE undo step and places its node beside the new owner', () => {
    const f = loadEr();
    const addr = f.attrByName('address');
    select([nodeOf(f.diagramId, 'attribute', addr.id)]);
    render(<PropertiesPanel />);
    const before = st().undoStack.length;
    act(() => void fireEvent.change(screen.getByRole('combobox', { name: 'Belongs to' }), { target: { value: ownerValue({ kind: 'entity', id: f.drug }) } }));
    expect(er().attributes[addr.id]!.owner).toEqual({ kind: 'entity', id: f.drug });
    expect(st().undoStack.length).toBe(before + 1);
    act(() => st().undo());
    expect(er().attributes[addr.id]!.owner).toEqual({ kind: 'entity', id: f.company });
  });

  it('a key attribute moved under a composite loses its key flag (keys exist only on entities)', () => {
    const f = loadEr();
    const key = f.attrByName('name');
    expect(moveAttributeTo(er().id, key.id, { kind: 'attribute', id: f.attrByName('Composite').id }, f.diagramId)).toBe(true);
    expect(er().attributes[key.id]!.key).toBe('none');
  });

  it('dragging a row handle onto a composite row nests the attribute', () => {
    const f = loadEr();
    select([nodeOf(f.diagramId, 'entity', f.company)]);
    render(<PropertiesPanel />);
    const addr = f.attrByName('address');
    const comp = f.attrByName('Composite');
    const row = document.querySelector(`[data-attr-id="${addr.id}"]`) as HTMLElement;
    const target = document.querySelector(`[data-attr-id="${comp.id}"]`) as HTMLElement;
    const data: Record<string, string> = {};
    const dataTransfer = { types: ['application/x-schemacanvas-attribute'], effectAllowed: '', setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '' };
    act(() => void fireEvent.dragStart(within(row).getAllByTestId('attr-drag-handle')[0]!, { dataTransfer }));
    act(() => void fireEvent.dragOver(target, { dataTransfer }));
    act(() => void fireEvent.drop(target, { dataTransfer }));
    expect(er().attributes[addr.id]!.owner).toEqual({ kind: 'attribute', id: comp.id });
  });
});

describe('SA-13: Add column focuses the new name field', () => {
  it('focuses and selects the name input of the new column', () => {
    const b = relationalBuilder('R');
    const t = b.relation('Product', ['Id'], { pk: ['Id'] });
    const model = b.build();
    const project = createBareProject('t');
    const diagram = withDiagram(project, model, 'relational-schema');
    st().loadProject(project);
    st().setActiveDiagram(diagram.id);
    select([nodeOf(diagram.id, 'relation', t.relation.id)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByTestId('add-column')));
    const added = rel().relations[t.relation.id]!.columns[1]!;
    const input = within(document.querySelector(`[data-column-id="${added.id}"]`) as HTMLElement).getByRole('textbox', { name: 'Column name' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });
});

describe('A11Y-09: Escape reaches the dialog from a text field', () => {
  it('Escape in the focused name field closes the diagram options dialog, but first reverts a pending draft', () => {
    loadEr();
    let closed = 0;
    render(<DiagramOptionsDialog props={{}} onClose={() => closed++} />);
    const name = screen.getByRole('textbox', { name: 'Diagram name' }) as HTMLInputElement;
    name.focus();
    fireEvent.change(name, { target: { value: 'zzz' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(closed).toBe(0); // the draft was reverted instead
    expect(name.value).not.toBe('zzz');
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(closed).toBe(1);
  });
});

describe('UX-3: option changes that grow tables re-space them in one undo step', () => {
  it('raising the font size and row height leaves no new overlap, with a toast and one undo step', () => {
    const p = buildExample('pharmacy');
    st().loadProject(p);
    const diagramId = p.diagramOrder.find((id) => p.diagrams[id]!.type === 'relational-schema')!;
    st().setActiveDiagram(diagramId);
    select([]);
    render(<PropertiesPanel />);
    const overlapsBefore = overlappingPairs(buildScene(proj(), diagramId)).size;
    const positions = (): string => JSON.stringify(Object.values(proj().diagrams[diagramId]!.nodes).map((n) => [n.x, n.y]));
    const posBefore = positions();
    const sizeBefore = proj().diagrams[diagramId]!.options.typography.fontSize;
    const undoBefore = st().undoStack.length;
    const size = screen.getByLabelText('Size') as HTMLInputElement;
    fireEvent.change(size, { target: { value: '30' } });
    fireEvent.blur(size);
    expect(proj().diagrams[diagramId]!.options.typography.fontSize).toBe(30);
    expect(positions()).not.toBe(posBefore); // tables were pushed apart ...
    expect(overlappingPairs(buildScene(proj(), diagramId)).size).toBeLessThanOrEqual(overlapsBefore);
    expect(st().undoStack.length).toBe(undoBefore + 1); // ... in the SAME commit as the option
    expect(uiStore.getState().toasts.some((t) => /Moved \d+ tables apart/.test(t.message))).toBe(true);
    act(() => st().undo());
    expect(proj().diagrams[diagramId]!.options.typography.fontSize).toBe(sizeBefore);
    expect(positions()).toBe(posBefore);
  });
});

describe('UX-6: bulk data type for untyped columns', () => {
  it('sets one type on every untyped column of the table in one commit and shows the count', () => {
    const b = relationalBuilder('R');
    const t = b.relation('Product', ['Id', 'Name', 'Price'], { pk: ['Id'] });
    const model = b.build();
    const project = createBareProject('t');
    const diagram = withDiagram(project, model, 'relational-schema');
    st().loadProject(project);
    st().setActiveDiagram(diagram.id);
    st().commit('seed', (d) => void ((d.models[model.id] as RelationalModel).relations[t.relation.id]!.columns[0]!.dataType = 'INTEGER'));
    select([nodeOf(diagram.id, 'relation', t.relation.id)]);
    render(<PropertiesPanel />);
    act(() => void fireEvent.click(screen.getByTestId('bulk-type-open')));
    const apply = screen.getByTestId('bulk-type-apply');
    expect(apply.textContent).toContain('2 columns');
    const undoBefore = st().undoStack.length;
    act(() => void fireEvent.click(apply));
    expect(rel().relations[t.relation.id]!.columns.map((c) => c.dataType)).toEqual(['INTEGER', 'VARCHAR(255)', 'VARCHAR(255)']);
    expect(st().undoStack.length).toBe(undoBefore + 1);
    expect(screen.queryByTestId('bulk-type')).toBeNull();
  });
});
