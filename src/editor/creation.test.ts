import { afterEach, describe, expect, it } from 'vitest';
import { rectCenter } from '@/scene/geometry';
import type { ErModel, RelationalModel } from '@/model/types';
import { createFromLibraryItem, nextDefaultName, registerTemplateInserter } from './creation';
import { makeStore, nodeNamed, sceneOf } from './testFixtures';

const FAR = { x: 2000, y: 2000 };
const er = (s: ReturnType<typeof makeStore>) => s.store.getState().project.models[s.store.getState().project.diagrams[s.diagramId]!.modelId] as ErModel;
const rm = (s: ReturnType<typeof makeStore>) => s.store.getState().project.models[s.store.getState().project.diagrams[s.diagramId]!.modelId] as RelationalModel;

afterEach(() => registerTemplateInserter(undefined));

describe('nextDefaultName', () => {
  it('numbers from 1 and skips taken names (case-insensitive)', () => {
    expect(nextDefaultName('Entity', [])).toBe('Entity1');
    expect(nextDefaultName('Entity', ['entity1', 'Entity2'])).toBe('Entity3');
    expect(nextDefaultName('attribute', ['x'])).toBe('attribute1');
  });
});

describe('createFromLibraryItem: Chen', () => {
  it('drops an entity in ONE undo step, selects it, asks for a rename and centres it on the drop point', () => {
    const s = makeStore('chen');
    const before = s.store.getState().undoStack.length;
    const res = createFromLibraryItem(s.store, s.diagramId, { kind: 'entity' }, FAR, { grid: 0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(s.store.getState().undoStack.length).toBe(before + 1);
    expect(s.store.getState().selection.ids).toEqual(res.selectIds);
    expect(res.rename).toEqual({ nodeId: res.nodeIds[0] });
    const id = res.nodeIds[0]!;
    const g = sceneOf(s.store.getState().project, s.diagramId).nodes[id]!;
    const c = rectCenter(g.bounds);
    expect(Math.abs(c.x - FAR.x)).toBeLessThan(1);
    expect(Math.abs(c.y - FAR.y)).toBeLessThan(1);
    const ref = s.store.getState().project.diagrams[s.diagramId]!.nodes[id]!.ref;
    expect(er(s).entities[ref.id]!.name).toBe('Entity1');
    s.store.getState().undo();
    expect(s.store.getState().project.diagrams[s.diagramId]!.nodes[id]).toBeUndefined();
    expect(Object.values(er(s).entities).some((e) => e.name === 'Entity1')).toBe(false);
  });
  it('snaps the new shape to the grid and names stay unique', () => {
    const s = makeStore('chen');
    const a = createFromLibraryItem(s.store, s.diagramId, { kind: 'entity', weak: true }, FAR, { grid: 20 });
    const b = createFromLibraryItem(s.store, s.diagramId, { kind: 'entity' }, { x: FAR.x + 400, y: FAR.y }, { grid: 20 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const nodes = s.store.getState().project.diagrams[s.diagramId]!.nodes;
    expect(nodes[a.nodeIds[0]!]!.x % 20).toBe(0);
    expect(nodes[a.nodeIds[0]!]!.y % 20).toBe(0);
    const names = Object.values(er(s).entities).map((e) => e.name);
    expect(names).toContain('Entity1');
    expect(names).toContain('Entity2');
    expect(Object.values(er(s).entities).find((e) => e.name === 'Entity1')!.weak).toBe(true);
  });
  it('relationship and identifying relationship', () => {
    const s = makeStore('chen');
    const a = createFromLibraryItem(s.store, s.diagramId, { kind: 'relationship' }, FAR, { grid: 0 });
    const b = createFromLibraryItem(s.store, s.diagramId, { kind: 'relationship', identifying: true }, { x: FAR.x + 300, y: FAR.y }, { grid: 0 });
    expect(a.ok && b.ok).toBe(true);
    const rels = Object.values(er(s).relationships);
    expect(rels.find((r) => r.name === 'Relationship1')!.identifying).toBe(false);
    expect(rels.find((r) => r.name === 'Relationship2')!.identifying).toBe(true);
  });
  it('an attribute dropped onto an entity belongs to it; flavors map to key / partial / multivalued / derived', () => {
    const s = makeStore('chen');
    const doctor = nodeNamed(s.store.getState().project, s.diagramId, 'Doctor');
    const at = rectCenter(sceneOf(s.store.getState().project, s.diagramId).nodes[doctor]!.bounds);
    const flavors = ['simple', 'key', 'partial-key', 'multivalued', 'derived'] as const;
    flavors.forEach((flavor) => {
      const r = createFromLibraryItem(s.store, s.diagramId, { kind: 'attribute', flavor }, at, { grid: 0 });
      expect(r.ok).toBe(true);
    });
    const m = er(s);
    const doctorEntity = Object.values(m.entities).find((e) => e.name === 'Doctor')!;
    const mine = Object.values(m.attributes).filter((a) => a.owner.kind === 'entity' && a.owner.id === doctorEntity.id && /^attribute\d+$/.test(a.name));
    expect(mine.map((a) => a.name).sort()).toEqual(['attribute1', 'attribute2', 'attribute3', 'attribute4', 'attribute5']);
    expect(mine.filter((a) => a.key === 'primary')).toHaveLength(1);
    expect(mine.filter((a) => a.key === 'partial')).toHaveLength(1);
    expect(mine.filter((a) => a.multivalued)).toHaveLength(1);
    expect(mine.filter((a) => a.derived)).toHaveLength(1);
  });
  it('composite attribute gets two children; dropping on a relationship; key on a relationship is downgraded with a notice', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const doctor = nodeNamed(p, s.diagramId, 'Doctor');
    const at = rectCenter(sceneOf(p, s.diagramId).nodes[doctor]!.bounds);
    const c = createFromLibraryItem(s.store, s.diagramId, { kind: 'attribute', flavor: 'composite' }, at, { grid: 0 });
    expect(c.ok && c.nodeIds.length).toBe(3);
    const m = er(s);
    const comp = Object.values(m.attributes).find((a) => a.name === 'attribute1' && a.owner.kind === 'entity')!;
    const kids = Object.values(m.attributes).filter((a) => a.owner.kind === 'attribute' && a.owner.id === comp.id);
    expect(kids).toHaveLength(2);
    expect(new Set(kids.map((k) => k.name)).size).toBe(2);
    const sell = nodeNamed(s.store.getState().project, s.diagramId, 'Sell');
    const sat = rectCenter(sceneOf(s.store.getState().project, s.diagramId).nodes[sell]!.bounds);
    const k = createFromLibraryItem(s.store, s.diagramId, { kind: 'attribute', flavor: 'key' }, sat, { grid: 0 });
    expect(k.ok && k.notice).toBe('key-downgraded');
    const relAttr = Object.values(er(s).attributes).filter((a) => a.owner.kind === 'relationship' && /^attribute\d+$/.test(a.name));
    expect(relAttr).toHaveLength(1);
    expect(relAttr[0]!.key).toBe('none');
  });
  it('an attribute dropped on an existing attribute nests under it', () => {
    const s = makeStore('chen');
    const p = s.store.getState().project;
    const name = nodeNamed(p, s.diagramId, 'Speciality');
    const at = rectCenter(sceneOf(p, s.diagramId).nodes[name]!.bounds);
    const r = createFromLibraryItem(s.store, s.diagramId, { kind: 'attribute', flavor: 'simple' }, at, { grid: 0 });
    expect(r.ok).toBe(true);
    const m = er(s);
    const parent = Object.values(m.attributes).find((a) => a.name === 'Speciality')!;
    expect(Object.values(m.attributes).some((a) => a.owner.kind === 'attribute' && a.owner.id === parent.id)).toBe(true);
  });
  it('an attribute dropped on empty space is refused and changes nothing', () => {
    const s = makeStore('chen');
    const before = s.store.getState().project;
    const r = createFromLibraryItem(s.store, s.diagramId, { kind: 'attribute', flavor: 'simple' }, FAR);
    expect(r).toEqual({ ok: false, reason: 'needs-owner' });
    expect(s.store.getState().project).toBe(before);
    expect(s.store.getState().canUndo).toBe(false);
  });
});

describe('createFromLibraryItem: relational and cross-kind', () => {
  it('a relation gets 3 columns (first is the PK) and a unique name', () => {
    const s = makeStore('rel');
    const r = createFromLibraryItem(s.store, s.diagramId, { kind: 'relation' }, FAR, { grid: 0 });
    expect(r.ok && r.rename).toBeDefined();
    const rel = Object.values(rm(s).relations).find((x) => x.name === 'Table1')!;
    expect(rel.columns.map((c) => c.name)).toEqual(['Column1', 'Column2', 'Column3']);
    expect(rel.primaryKey).toEqual([rel.columns[0]!.id]);
    const r2 = createFromLibraryItem(s.store, s.diagramId, { kind: 'relation', columns: 5 }, { x: FAR.x + 500, y: FAR.y }, { grid: 0 });
    expect(r2.ok).toBe(true);
    expect(Object.values(rm(s).relations).find((x) => x.name === 'Table2')!.columns).toHaveLength(5);
  });
  it('refuses items that do not belong in the diagram kind, without touching the project', () => {
    const rel = makeStore('rel');
    const chen = makeStore('chen');
    const p1 = rel.store.getState().project;
    expect(createFromLibraryItem(rel.store, rel.diagramId, { kind: 'entity' }, FAR)).toEqual({ ok: false, reason: 'wrong-diagram' });
    expect(rel.store.getState().project).toBe(p1);
    expect(createFromLibraryItem(chen.store, chen.diagramId, { kind: 'relation' }, FAR)).toEqual({ ok: false, reason: 'wrong-diagram' });
  });
  it('templates go through the registered inserter hook', () => {
    const s = makeStore('chen');
    expect(createFromLibraryItem(s.store, s.diagramId, { kind: 'template', templateId: 't' }, FAR)).toEqual({ ok: false, reason: 'no-template-inserter' });
    const calls: string[] = [];
    registerTemplateInserter((ins) => {
      calls.push(`${ins.templateId}@${ins.at.x}`);
      return ['n1'];
    });
    const r = createFromLibraryItem(s.store, s.diagramId, { kind: 'template', templateId: 't' }, FAR);
    expect(calls).toEqual(['t@2000']);
    expect(r).toMatchObject({ ok: true, selectIds: ['n1'] });
  });
  it('the nodes a template inserted are selected afterwards', () => {
    const s = makeStore('chen');
    const nid = Object.keys(s.store.getState().project.diagrams[s.diagramId]!.nodes)[0]!;
    registerTemplateInserter(() => [nid, 'ghost-id']);
    createFromLibraryItem(s.store, s.diagramId, { kind: 'template', templateId: 't' }, FAR);
    expect(s.store.getState().selection.ids).toEqual([nid]);
    registerTemplateInserter(undefined);
  });
  it('an unknown diagram is reported', () => {
    const s = makeStore('chen');
    expect(createFromLibraryItem(s.store, 'nope', { kind: 'entity' }, FAR)).toEqual({ ok: false, reason: 'no-diagram' });
  });
});
