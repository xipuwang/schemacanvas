import { describe, expect, it } from 'vitest';
import { buildExample } from '@/examples';
import { run } from '@/conversion/testkit';
import { erBuilder } from '@/model/builders';
import { DEFAULT_CONVERSION_OPTIONS } from '@/model/defaults';
import type { ErModel, Project, RelationalModel } from '@/model/types';
import { createEditorStore } from '@/store';
import { deepFreeze } from '@/test/deepFreeze';
import { applyPlan, warningItems, findPreviousConversion, listDerivedAttributes, listOneToOneRelationships, overrideChoice, planConversion, pruneOptions, renderPlanSvg, withMaterialized, withOverride } from './convertFlow';

const erOf = (p: Project): ErModel => Object.values(p.models).find((m): m is ErModel => m.kind === 'er')!;
const relOf = (p: Project): RelationalModel => Object.values(p.models).find((m): m is RelationalModel => m.kind === 'relational')!;
const relationNames = (m: RelationalModel): string[] => Object.values(m.relations).map((r) => r.name).sort();

describe('options helpers', () => {
  it('lists 1:1 relationships and derived attributes with readable labels', () => {
    const company = buildExample('company');
    const ones = listOneToOneRelationships(erOf(company));
    expect(ones.map((o) => o.relationship.name)).toContain('Manages');
    const student = buildExample('composite-multivalued');
    expect(listDerivedAttributes(erOf(student)).map((d) => d.label)).toEqual(['Student.Age']);
  });

  it('round-trips per-relationship choices and materialised attributes without mutating the input', () => {
    const o = deepFreeze({ ...DEFAULT_CONVERSION_OPTIONS });
    const withMerge = withOverride(o, 'r1', 'merge');
    expect(overrideChoice(withMerge, 'r1')).toBe('merge');
    expect(overrideChoice(withOverride(withMerge, 'r1', { fk: 'p2' }), 'r1')).toEqual({ fk: 'p2' });
    expect(overrideChoice(withOverride(withMerge, 'r1', 'default'), 'r1')).toBe('default');
    expect(o.relationshipOverrides).toEqual({});
    expect(withMaterialized(o, 'a1', true).materializeDerived).toEqual(['a1']);
    expect(withMaterialized(withMaterialized(o, 'a1', true), 'a1', false).materializeDerived).toEqual([]);
  });

  it('prunes options that point at vanished elements', () => {
    const er = erOf(buildExample('company'));
    const stale = withMaterialized(withOverride(DEFAULT_CONVERSION_OPTIONS, 'gone', 'merge'), 'gone-attr', true);
    const pruned = pruneOptions(stale, er);
    expect(pruned.relationshipOverrides).toEqual({});
    expect(pruned.materializeDerived).toEqual([]);
  });
});

describe('planConversion cancellation', () => {
  it('rejects with an AbortError when the signal is aborted (superseded preview / Esc / dialog closed)', async () => {
    const project = buildExample('company');
    const controller = new AbortController();
    const pending = planConversion(project, erOf(project).id, DEFAULT_CONVERSION_OPTIONS, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    // an un-aborted signal still produces a plan
    const ok = await planConversion(project, erOf(project).id, DEFAULT_CONVERSION_OPTIONS, { signal: new AbortController().signal });
    expect(ok.tables).toBeGreaterThan(0);
  });
});

describe('planConversion / applyPlan (add mode)', () => {
  it('produces the relational model, diagram and record and never touches the ER model', async () => {
    const project = deepFreeze(buildExample('pharmacy'));
    const er = erOf(project);
    const plan = await planConversion(project, er.id, DEFAULT_CONVERSION_OPTIONS);
    expect(plan.tables).toBe(Object.keys(relOf(project).relations).length);
    expect(plan.foreignKeys).toBe(Object.keys(relOf(project).foreignKeys).length);
    expect(plan.result.record.erModelId).toBe(er.id);
    expect(plan.project.models[er.id]).toBe(project.models[er.id]); // structurally shared: untouched
    expect(plan.diagramId && plan.project.diagrams[plan.diagramId]!.type).toBe('relational-schema');
    expect(Object.keys(plan.positions)).toHaveLength(plan.tables);
    expect(renderPlanSvg(plan)).toMatch(/^<svg|^<\?xml/);
  });

  it('applies in ONE commit, activates the new diagram, positions come from the layout, and undo restores everything', async () => {
    const start = buildExample('pharmacy');
    const store = createEditorStore({ project: start });
    const er = erOf(start);
    const plan = await planConversion(store.getState().project, er.id, DEFAULT_CONVERSION_OPTIONS);
    const undoBefore = store.getState().undoStack.length;
    const applied = applyPlan(plan, 'Convert', store);
    const s = store.getState();
    expect(s.undoStack.length).toBe(undoBefore + 1);
    expect(s.activeDiagramId).toBe(applied.diagramId);
    const rel = s.project.models[applied.modelId] as RelationalModel;
    expect(relationNames(rel)).toEqual(relationNames(relOf(start)));
    expect(Object.keys(s.project.conversions)).toHaveLength(Object.keys(start.conversions).length + 1);
    const d = s.project.diagrams[applied.diagramId!]!;
    expect(Object.keys(d.edges)).toHaveLength(Object.keys(rel.foreignKeys).length);
    const spots = new Set(Object.values(d.nodes).map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(Object.keys(d.nodes).length);
    expect(s.project.models[er.id]).toEqual(start.models[er.id]);
    s.undo();
    const after = store.getState().project;
    expect(Object.keys(after.models).sort()).toEqual(Object.keys(start.models).sort());
    expect(Object.keys(after.conversions)).toEqual(Object.keys(start.conversions));
  });

  it('materialising a derived attribute changes the result', async () => {
    const project = buildExample('composite-multivalued');
    const er = erOf(project);
    const age = listDerivedAttributes(er)[0]!.attribute;
    const plain = await planConversion(project, er.id, DEFAULT_CONVERSION_OPTIONS);
    const kept = await planConversion(project, er.id, withMaterialized(DEFAULT_CONVERSION_OPTIONS, age.id, true));
    const cols = (p: typeof plain): string[] => Object.values(p.result.relationalModel.relations).find((r) => r.name === 'Student')!.columns.map((c) => c.name);
    expect(cols(plain)).not.toContain('Age');
    expect(cols(kept)).toContain('Age');
  });

  it('a 1:1 override changes the generated relations and the decisions', async () => {
    const project = buildExample('company');
    const er = erOf(project);
    const manages = listOneToOneRelationships(er).find((o) => o.relationship.name === 'Manages')!;
    const base = await planConversion(project, er.id, DEFAULT_CONVERSION_OPTIONS);
    const merged = await planConversion(project, er.id, withOverride(DEFAULT_CONVERSION_OPTIONS, manages.relationship.id, 'merge'));
    const separate = await planConversion(project, er.id, withOverride(DEFAULT_CONVERSION_OPTIONS, manages.relationship.id, 'relation'));
    expect(relationNames(merged.result.relationalModel)).not.toEqual(relationNames(base.result.relationalModel));
    expect(separate.tables).toBe(base.tables + 1);
  });
});

describe('re-conversion (replace mode)', () => {
  it('finds the previous conversion and updates the model in place, keeping positions and reporting what happened', async () => {
    const start = buildExample('pharmacy');
    const store = createEditorStore({ project: start });
    const er = erOf(start);
    const prev = findPreviousConversion(start, er.id)!;
    expect(prev.model.id).toBe(relOf(start).id);

    // the user moves a table by hand
    const relDiagramId = start.diagramOrder.find((id) => start.diagrams[id]!.type === 'relational-schema')!;
    const someNode = Object.values(start.diagrams[relDiagramId]!.nodes)[0]!;
    store.getState().commit('Move', (d) => {
      d.diagrams[relDiagramId]!.nodes[someNode.id]!.x = 1234;
    });
    const options = pruneOptions(prev.record.options, er);
    const plan = await planConversion(store.getState().project, er.id, options, { replace: { model: prev.model, recordId: prev.record.id } });
    expect(plan.replaceModelId).toBe(prev.model.id);
    expect(plan.result.record.previousConversionId).toBe(prev.record.id);
    expect(Array.isArray(plan.report.kept)).toBe(true);
    const applied = applyPlan(plan, 'Convert', store);
    expect(applied.modelId).toBe(prev.model.id);
    const p = store.getState().project;
    expect(Object.values(p.models).filter((m) => m.kind === 'relational')).toHaveLength(1);
    expect(p.diagrams[relDiagramId]!.nodes[someNode.id]!.x).toBe(1234);
    expect(relationNames(p.models[prev.model.id] as RelationalModel)).toEqual(relationNames(prev.model));
  });

  it('finds nothing when the ER model was never converted', () => {
    const start = buildExample('pharmacy');
    const er = erOf(start);
    const none = { ...start, conversions: {} } as Project;
    expect(findPreviousConversion(none, er.id)).toBeUndefined();
  });
});

describe('warningItems (Warnings tab)', () => {
  const dec = (id: string, level: 'info' | 'warning', ref?: string) =>
    ({ id, ruleId: 'strong-entity', title: id, explanation: id, sources: ref ? [{ kind: 'entity' as const, id: ref }] : [], targets: [], level });
  it('includes every warning-level decision, even when a warning concerns the same element', () => {
    const record = {
      decisions: [dec('a', 'warning', 'e1'), dec('b', 'info', 'e2'), dec('c', 'warning', 'e3')],
      warnings: [{ affected: [{ kind: 'entity' as const, id: 'e3' }] }],
    } as never;
    expect(warningItems(record).map((d) => d.id)).toEqual(['a', 'c']);
  });
  it('is non-empty for a keyless entity conversion', () => {
    const b = erBuilder('K');
    b.entity('Keyless').attr('x');
    const record = run(b.build()).record;
    expect(record.warnings).toHaveLength(0);
    expect(warningItems(record).length).toBeGreaterThan(0);
  });
});
