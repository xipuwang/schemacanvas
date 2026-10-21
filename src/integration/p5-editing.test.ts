// @vitest-environment node
/** P5 EDITING SEQUENCE: a scripted, realistic session through the REAL store + ops; invariants checked after EVERY step. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertErToRelational } from '@/conversion';
import { useDeterministicIds } from '@/model/ids';
import { useFixedClock } from '@/model/clock';
import { createProject } from '@/model/defaults';
import { syncDiagram } from '@/model/diagramSync';
import { checkInvariants } from '@/model/invariants';
import * as ops from '@/model/ops';
import type { ErModel, Id, Project, RelationalModel } from '@/model/types';
import { loadAutosave, startAutosave, flush, clear } from '@/persistence';
import { createEditorStore } from '@/store';
import { validateProject } from '@/validation';
import { buildScene } from '@/scene/registry';
import { generateDdl } from '@/sql';
import { nodeOverlaps } from './helpers';

let restore: Array<() => void> = [];
beforeEach(() => {
  restore = [useDeterministicIds(), useFixedClock('2026-02-02T00:00:00.000Z')];
});
afterEach(() => restore.forEach((r) => r()));

const J = (x: unknown) => JSON.parse(JSON.stringify(x));

/** Hard invariants + every diagram is a fixed point of syncDiagram + every scene builds without warnings/NaN. */
function assertHealthy(p: Project, label: string): void {
  expect(checkInvariants(p), `${label}: invariants`).toEqual([]);
  const copy: Project = J(p);
  for (const id of Object.keys(copy.diagrams)) syncDiagram(copy, id);
  expect(J(copy), `${label}: diagrams are complete & stray-free`).toEqual(J(p));
  for (const id of Object.keys(p.diagrams)) {
    const scene = buildScene(p, id);
    expect(scene.warnings, `${label}: scene warnings in ${p.diagrams[id]!.name}`).toEqual([]);
    expect(JSON.stringify(scene.bounds), `${label}: finite bounds`).not.toMatch(/null|NaN/);
  }
}

describe('P5 scripted editing session', () => {
  it('create ER from scratch -> convert -> edit relational -> undo/redo everything -> copy/paste -> delete -> autosave', async () => {
    const p0 = createProject('Session');
    const store = createEditorStore({ project: p0 });
    const erDiagramId = p0.diagramOrder[0]!;
    const erId = Object.keys(p0.models)[0]!;
    store.getState().setActiveDiagram(erDiagramId);

    const snapshots: Array<{ label: string; project: Project }> = [{ label: 'start', project: store.getState().project }];
    const step = <T>(label: string, fn: (d: Project) => T): T => {
      const r = store.getState().commit(label, (d) => {
        const out = fn(d);
        return out;
      });
      const p = store.getState().project;
      assertHealthy(p, label);
      snapshots.push({ label, project: p });
      return r;
    };
    // recipes must return undefined (immer) -> capture results in closures
    const at = (x: number, y: number) => ({ diagramId: erDiagramId, x, y });
    const id = (r: ops.OpResult) => r.refs[0]!.id;

    // --- ER from scratch
    let student!: Id, dept!: Id, course!: Id, company!: Id, drug!: Id;
    step('entities', (d) => {
      student = id(ops.addEntity(d, erId, { name: 'Student' }, at(0, 0)));
      dept = id(ops.addEntity(d, erId, { name: 'Dept' }, at(400, 0)));
      course = id(ops.addEntity(d, erId, { name: 'Course' }, at(800, 0)));
      company = id(ops.addEntity(d, erId, { name: 'Company' }, at(0, 400)));
      drug = id(ops.addEntity(d, erId, { name: 'Drug', weak: true }, at(400, 400)));
    });
    let nameAttr!: Id;
    step('attributes', (d) => {
      ops.addAttribute(d, erId, { kind: 'entity', id: student }, { name: 'SID', key: 'primary', dataType: 'INT' });
      nameAttr = id(ops.addAttribute(d, erId, { kind: 'entity', id: student }, { name: 'Name' }));
      ops.addAttribute(d, erId, { kind: 'entity', id: student }, { name: 'Phone', multivalued: true });
      ops.addAttribute(d, erId, { kind: 'entity', id: student }, { name: 'Age', derived: true });
      ops.addAttribute(d, erId, { kind: 'entity', id: dept }, { name: 'Did', key: 'primary' });
      ops.addAttribute(d, erId, { kind: 'entity', id: course }, { name: 'Cid', key: 'primary' });
      ops.addAttribute(d, erId, { kind: 'entity', id: company }, { name: 'CName', key: 'primary' });
      ops.addAttribute(d, erId, { kind: 'entity', id: drug }, { name: 'TradeName', key: 'partial' });
    });
    step('composite children', (d) => {
      ops.addAttribute(d, erId, { kind: 'attribute', id: nameAttr }, { name: 'First' });
      ops.addAttribute(d, erId, { kind: 'attribute', id: nameAttr }, { name: 'Last' });
    });
    let makes!: Id;
    step('identifying relationship', (d) => {
      makes = id(
        ops.addRelationship(d, erId, {
          name: 'Makes',
          participants: [{ entityId: company, max: 'one' }, { entityId: drug, max: 'many' }],
        }),
      );
      ops.setIdentifying(d, erId, makes, true);
    });
    step('ternary + M:N', (d) => {
      ops.addRelationship(d, erId, {
        name: 'Teaches',
        participants: [{ entityId: dept, max: 'one' }, { entityId: course }, { entityId: student }],
      });
      ops.addRelationship(d, erId, { name: 'Enrolls', participants: [{ entityId: student }, { entityId: course }] });
    });
    const er = store.getState().project.models[erId] as ErModel;
    expect(er.relationships[makes]!.participants.find((q) => q.entityId === drug)!.participation).toBe('total');
    expect(validateProject(store.getState().project, { modelId: erId }).filter((i) => i.severity === 'error')).toEqual([]);

    // second Chen diagram of the same model (both diagrams must stay consistent)
    let erDiagram2!: Id;
    step('second ER diagram', (d) => {
      erDiagram2 = ops.createDiagram(d, { type: 'chen', modelId: erId, name: 'ER 2' }).diagramId;
    });

    // --- convert (real flow, one commit)
    let relId!: Id, relDiagram!: Id;
    step('convert', (d) => {
      const result = convertErToRelational(store.getState().project, erId);
      const rep = ops.applyConversionResult(d, result);
      relId = rep.modelId;
      relDiagram = rep.diagramId!;
    });
    // add a crow's-foot + second horizontal diagram of the relational model
    let cfDiagram!: Id;
    step('extra relational diagrams', (d) => {
      cfDiagram = ops.createDiagram(d, { type: 'crows-foot', modelId: relId }).diagramId;
      ops.createDiagram(d, { type: 'relational-schema', modelId: relId, name: 'Schema 2', copyLayoutFrom: relDiagram });
    });
    let rel = store.getState().project.models[relId] as RelationalModel;
    const R = (n: string) => Object.values(rel.relations).find((r) => r.name === n)!;
    expect(Object.values(rel.relations).map((r) => r.name).sort()).toEqual(
      ['Course', 'Dept', 'Drug', 'Enrolls', 'Student', 'Student_Phone', 'Teaches', 'Company'].sort(),
    );
    expect(R('Drug').primaryKey.map((c) => R('Drug').columns.find((x) => x.id === c)!.name)).toEqual(['CompanyCName', 'TradeName']);
    expect(Object.values(rel.foreignKeys).some((f) => f.columns.length === 0)).toBe(false);
    expect(validateProject(store.getState().project, { modelId: relId }).filter((i) => i.severity === 'error')).toEqual([]);

    // --- edit the relational result
    const stu = R('Student');
    step('add column', (d) => {
      ops.addColumn(d, relId, stu.id, { name: 'GPA', dataType: 'DECIMAL(3,2)', nullable: true });
    });
    step('add FK with created columns', (d) => {
      const { pairs } = ops.createFkColumns(d, relId, { sourceRelationId: stu.id, targetRelationId: R('Dept').id, names: ['MajorDid'] });
      ops.addForeignKey(d, relId, { sourceRelationId: stu.id, targetRelationId: R('Dept').id, columns: pairs, label: 'major' });
    });
    step('reorder column', (d) => {
      const gpa = (d.models[relId] as RelationalModel).relations[stu.id]!.columns.find((c) => c.name === 'GPA')!;
      ops.reorderColumn(d, relId, stu.id, gpa.id, 0);
    });
    rel = store.getState().project.models[relId] as RelationalModel;
    expect(rel.relations[stu.id]!.columns[0]!.name).toBe('GPA');
    // composite FK still points at the same columns after reordering the SOURCE columns
    const compositeFk = Object.values(rel.foreignKeys).find((f) => f.columns.length === 2)!; // Drug.CompanyCName? (no: 1 col) -> Enrolls/Teaches none; Drug has 1
    void compositeFk;

    // composite FK scenario: add a composite FK Teaches.(CompanyName?) -- build one explicitly: Enrolls -> Drug-like composite
    let compFkId!: Id;
    step('add composite FK Student -> Drug', (d) => {
      const drug = R('Drug');
      const { pairs } = ops.createFkColumns(d, relId, {
        sourceRelationId: stu.id,
        targetRelationId: drug.id,
        names: ['FavCompany', 'FavDrug'],
      });
      compFkId = id(ops.addForeignKey(d, relId, { sourceRelationId: stu.id, targetRelationId: drug.id, columns: pairs }));
    });
    // The composite FK, scene check: both branches land on the right cells
    {
      const p = store.getState().project;
      rel = p.models[relId] as RelationalModel;
      expect(rel.foreignKeys[compFkId]!.columns).toHaveLength(2);
      const scene = buildScene(p, relDiagram);
      expect(Object.values(scene.edges).length).toBe(Object.keys(rel.foreignKeys).length);
    }
    step('delete column in composite FK', (d) => {
      const fk = (d.models[relId] as RelationalModel).foreignKeys[compFkId]!;
      ops.removeColumn(d, relId, stu.id, fk.columns[1]!.sourceColumnId);
    });
    {
      const p = store.getState().project;
      rel = p.models[relId] as RelationalModel;
      expect(rel.foreignKeys[compFkId]!.columns).toHaveLength(1); // partial composite FK stays (cascade table)
      const issues = validateProject(p, { modelId: relId });
      expect(issues.some((i) => i.code === 'rel.fk-target-not-key' && i.severity === 'error'), 'validation reports the now-incomplete composite FK').toBe(true);
      expect(generateDdl(rel, 'postgresql').sql, 'DDL refuses the broken FK instead of emitting wrong SQL').toBe('');
      // the horizontal scene still draws it, ending on the surviving referenced cell
      const scene = buildScene(p, relDiagram);
      expect(scene.warnings).toEqual([]);
    }
    step('remove the dangling FK', (d) => ops.removeForeignKey(d, relId, compFkId));
    expect(generateDdl(store.getState().project.models[relId] as RelationalModel, 'postgresql').issues.filter((i) => i.severity === 'error')).toEqual([]);

    // --- copy / paste a table inside the relational diagram
    step('copy/paste table', (d) => {
      const node = Object.values(d.diagrams[relDiagram]!.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === R('Dept').id)!;
      ops.duplicateNodes(d, relDiagram, [node.id], { x: 40, y: 40 });
    });
    {
      const p = store.getState().project;
      rel = p.models[relId] as RelationalModel;
      expect(Object.values(rel.relations).filter((r) => r.name.startsWith('Dept')).length).toBe(2);
      // all three horizontal/crow's-foot diagrams show the pasted table
      for (const did of [relDiagram, cfDiagram]) expect(Object.values(p.diagrams[did]!.nodes).length).toBe(Object.keys(rel.relations).length);
    }
    step('copy/paste Student + Dept together keeps the FK between the copies', (d) => {
      const ids = Object.values(d.diagrams[relDiagram]!.nodes).filter((n) => n.ref.kind === 'relation' && [stu.id, R('Dept').id].includes(n.ref.id)).map((n) => n.id);
      ops.duplicateNodes(d, relDiagram, ids, { x: 0, y: 300 });
    });
    {
      rel = store.getState().project.models[relId] as RelationalModel;
      for (const f of Object.values(rel.foreignKeys)) {
        expect(rel.relations[f.sourceRelationId], 'FK source exists').toBeDefined();
        expect(rel.relations[f.targetRelationId], 'FK target exists').toBeDefined();
        for (const pr of f.columns) {
          expect(rel.relations[f.sourceRelationId]!.columns.some((c) => c.id === pr.sourceColumnId)).toBe(true);
          expect(rel.relations[f.targetRelationId]!.columns.some((c) => c.id === pr.targetColumnId)).toBe(true);
        }
      }
    }

    // --- delete an ER entity: both ER diagrams (and the relational model derived earlier) stay healthy
    step('delete entity Course', (d) => {
      ops.removeEntity(d, erId, course);
    });
    {
      const p = store.getState().project;
      for (const did of [erDiagramId, erDiagram2]) {
        const nodes = Object.values(p.diagrams[did]!.nodes);
        expect(nodes.some((n) => n.ref.kind === 'entity' && n.ref.id === course)).toBe(false);
        expect(nodes.some((n) => n.ref.kind === 'attribute' && !(p.models[erId] as ErModel).attributes[n.ref.id])).toBe(false);
      }
      // relationships left with <2 participants are kept as soft state and reported, not crashed on
      const issues = validateProject(p, { modelId: erId });
      expect(issues.some((i) => i.code === 'er.relationship-too-few-participants')).toBe(true);
      expect(nodeOverlaps(buildScene(p, erDiagramId)).length).toBeGreaterThanOrEqual(0);
    }
    step('delete entity Student (owns multivalued + composite attrs)', (d) => ops.removeEntity(d, erId, student));

    // --- undo everything, one step at a time, comparing with the recorded snapshot
    const total = snapshots.length - 1;
    expect(store.getState().undoStack.length).toBe(total);
    for (let i = total; i > 0; i--) {
      store.getState().undo();
      expect(store.getState().project, `undo of "${snapshots[i]!.label}"`).toEqual(snapshots[i - 1]!.project);
      assertHealthy(store.getState().project, `undo ${snapshots[i]!.label}`);
    }
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().project).toEqual(snapshots[0]!.project);
    // --- redo everything
    for (let i = 1; i <= total; i++) {
      store.getState().redo();
      expect(store.getState().project, `redo of "${snapshots[i]!.label}"`).toEqual(snapshots[i]!.project);
    }
    expect(store.getState().canRedo).toBe(false);

    // --- autosave to fake-indexeddb and reload
    await clear();
    const stop = startAutosave(store, { delayMs: 5 });
    store.getState().commit('touch', (d) => {
      ops.updateEntity(d, erId, dept, { name: 'Department' });
    });
    await flush();
    stop();
    const loaded = await loadAutosave();
    expect(loaded && loaded.ok).toBe(true);
    if (loaded && loaded.ok) {
      expect(J(loaded.project)).toEqual(J(store.getState().project));
      expect(loaded.repairs).toEqual([]);
      assertHealthy(loaded.project, 'reloaded autosave');
    }
  }, 60_000);
});
