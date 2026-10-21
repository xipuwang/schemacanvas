/** Regression tests for the model-ops review findings (OPS-1 .. OPS-9). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { erBuilder, relationalBuilder } from '../builders';
import { createBareProject, DEFAULT_CONVERSION_OPTIONS } from '../defaults';
import { createDiagramForModel, withDiagram } from '../diagramSync';
import { useDeterministicIds } from '../ids';
import type { ConversionResult, ErModel, Origin, Project, RelationalModel } from '../types';
import * as ops from './index';
import { run } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(7000);
});
afterEach(() => restore());

const origin = (key: string): Origin => ({ ruleId: 'strong-entity', sources: [], key });

function generated() {
  const b = relationalBuilder('Gen');
  const A = b.relation('A', ['a1', 'a2', 'a3'], { pk: ['a1'] });
  const B = b.relation('B', ['b1', 'b_a'], { pk: ['b1'] });
  const fk = b.fk(B, ['b_a'], A, ['a1']);
  for (const r of [A, B]) {
    r.relation.origin = origin(`rel:${r.relation.name}`);
    for (const c of r.relation.columns) c.origin = origin(`col:${r.relation.name}.${c.name}`);
  }
  fk.origin = origin('fk:ba');
  return { A, B, fk, model: b.build() };
}

function regen(model: RelationalModel, erModelId = 'mdl_er', cnv = 'cnv_new'): ConversionResult {
  const m = JSON.parse(JSON.stringify(model)) as RelationalModel;
  m.id = 'mdl_regen';
  m.name = 'Generated name';
  m.dialect = 'generic';
  m.derivedFrom = { erModelId, conversionId: cnv };
  return {
    relationalModel: m,
    diagram: createDiagramForModel(m, 'relational-schema'),
    record: { id: cnv, erModelId, relationalModelId: m.id, createdAt: '2026-01-01T00:00:00.000Z', options: DEFAULT_CONVERSION_OPTIONS, trace: [], decisions: [], warnings: [] },
  };
}

function base() {
  const g = generated();
  g.model.derivedFrom = { erModelId: 'mdl_er', conversionId: 'cnv_old' };
  const p = createBareProject();
  withDiagram(p, g.model, 'relational-schema');
  return { g, p, mid: g.model.id };
}
const rm = (p: Project, id: string) => p.models[id] as RelationalModel;

describe('OPS-1 sync performance', () => {
  it('a rename in a 2,300-node Chen model with two diagrams stays interactive', () => {
    const b = erBuilder('big');
    const ents: ReturnType<typeof b.entity>[] = [];
    for (let i = 0; i < 200; i++) {
      const e = b.entity(`E${i}`).key(`K${i}`);
      for (let j = 0; j < 9; j++) e.attr(`a${i}_${j}`);
      ents.push(e);
    }
    for (let i = 0; i < 100; i++) b.relate(`R${i}`, ents[i]!, ents[i + 1]!, '1:N');
    const m = b.build();
    const p = createBareProject('x');
    withDiagram(p, m, 'chen');
    withDiagram(p, m, 'chen');
    const attr = Object.keys(m.attributes)[5]!;
    const t = performance.now();
    produce(p, (d) => {
      ops.updateAttribute(d, m.id, attr, { name: 'renamed' });
    });
    expect(performance.now() - t).toBeLessThan(4000); // was ~33,000 ms
  });
});

describe('OPS-3/4/5/6/9 replace-mode conversion', () => {
  it('OPS-3: user-filled fields on generated elements survive; replaced ones are reported', () => {
    const { g, p, mid } = base();
    const col = g.A.relation.columns[1]!;
    const q = run(p, (d) => {
      ops.updateColumn(d, mid, g.A.relation.id, col.id, { name: 'renamed', dataType: 'VARCHAR(80)' });
      ops.updateForeignKey(d, mid, g.fk.id, { onDelete: 'CASCADE' });
    }).project;
    const { project, result } = run(q, (d) => ops.applyConversionResult(d, regen(g.model), { replaceModelId: mid }));
    const c = rm(project, mid).relations[g.A.relation.id]!.columns.find((x) => x.id === col.id)!;
    expect(c.dataType).toBe('VARCHAR(80)'); // carried: converter left it unset
    expect(rm(project, mid).foreignKeys[g.fk.id]!.onDelete).toBe('CASCADE');
    expect(c.name).toBe('a2'); // regenerated name wins ...
    expect(result.overwritten!.join('|')).toMatch(/name: 'renamed' -> 'a2'/); // ... but is reported
    expect(project.conversions.cnv_new!.warnings.map((w) => w.code)).toContain('conv.edits-overwritten');
  });

  it('OPS-4: a hand-added column / relation clashing with a regenerated name is suffixed and reported', () => {
    const { g, p, mid } = base();
    const q = run(p, (d) => {
      ops.addColumn(d, mid, g.A.relation.id, { name: 'Email' });
      ops.addRelation(d, mid, { name: 'Audit', columns: [{ name: 'id', pk: true }] });
    }).project;
    const next = regen(g.model);
    next.relationalModel.relations[g.A.relation.id]!.columns.push({ id: 'col_new_email', name: 'email', nullable: true, origin: origin('col:A.email') });
    next.relationalModel.relations.rel_audit = { id: 'rel_audit', name: 'audit', columns: [{ id: 'col_x', name: 'x', nullable: false }], primaryKey: ['col_x'], uniques: [], indexes: [], origin: origin('rel:audit') };
    const { project } = run(q, (d) => ops.applyConversionResult(d, next, { replaceModelId: mid }));
    const m = rm(project, mid);
    const names = m.relations[g.A.relation.id]!.columns.map((c) => c.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const rels = Object.values(m.relations).map((r) => r.name.toLowerCase());
    expect(new Set(rels).size).toBe(rels.length);
    expect(project.conversions.cnv_new!.warnings.map((w) => w.code)).toContain('conv.hand-added-renamed');
  });

  it('OPS-5: a hand-added composite UNIQUE is never shrunk; it is dropped and reported', () => {
    const { g, p, mid } = base();
    const [a2, a3] = [g.A.relation.columns[1]!.id, g.A.relation.columns[2]!.id];
    const q = run(p, (d) => {
      ops.addUnique(d, mid, g.A.relation.id, { id: 'uq_h', columnIds: [a2, a3] });
    }).project;
    const next = regen(g.model);
    next.relationalModel.relations[g.A.relation.id]!.columns = next.relationalModel.relations[g.A.relation.id]!.columns.filter((c) => c.id !== a3);
    const { project, result } = run(q, (d) => ops.applyConversionResult(d, next, { replaceModelId: mid }));
    expect(rm(project, mid).relations[g.A.relation.id]!.uniques).toEqual([]);
    expect(result.dropped).toHaveLength(1);
  });

  it('OPS-6: the user model name and dialect survive a replace', () => {
    const { g, p, mid } = base();
    const q = produce(p, (d) => {
      (d.models[mid] as RelationalModel).name = 'My schema';
      (d.models[mid] as RelationalModel).dialect = 'postgresql';
    });
    const { project } = run(q, (d) => ops.applyConversionResult(d, regen(g.model), { replaceModelId: mid }));
    expect(rm(project, mid).name).toBe('My schema');
    expect(rm(project, mid).dialect).toBe('postgresql');
    expect(rm(project, mid).derivedFrom).toEqual({ erModelId: 'mdl_er', conversionId: 'cnv_new' });
  });

  it('OPS-9: replacing a model generated from a different ER model is refused', () => {
    const { g, p, mid } = base();
    expect(() => run(p, (d) => ops.applyConversionResult(d, regen(g.model, 'mdl_other'), { replaceModelId: mid }))).toThrow(/not generated from/);
  });
});

describe('OPS-7/8 associative entities in partial diagrams', () => {
  function setup() {
    const b = erBuilder('S');
    const a = b.entity('A').key('ida');
    const c = b.entity('C').key('idc');
    const r = b.relate('R', a, c, '1:N');
    r.attr('price');
    const model = b.build();
    const p = createBareProject();
    withDiagram(p, model, 'chen');
    const part = withDiagram(p, model, 'chen');
    const dropNode = Object.values(part.nodes).find((n) => n.ref.kind === 'attribute' && model.attributes[n.ref.id]!.name === 'ida')!;
    const q = run(p, (d) => ops.removeFromDiagram(d, part.id, [dropNode.id])).project;
    return { model, q, part, rel: Object.values(model.relationships)[0]! };
  }
  const hasNode = (p: Project, dgm: string, kind: string, id: string) => Object.values(p.diagrams[dgm]!.nodes).some((n) => n.ref.kind === kind && n.ref.id === id);

  it('OPS-7: makeAssociative / clearAssociative keep the element visible in a partial diagram', () => {
    const { model, q, part, rel } = setup();
    let entId = '';
    const q2 = run(q, (d) => {
      entId = ops.makeAssociative(d, model.id, rel.id).refs[0]!.id;
    }).project;
    expect(hasNode(q2, part.id, 'entity', entId)).toBe(true);
    const edges = Object.values(q2.diagrams[part.id]!.edges).filter((e) => e.ref.kind === 'participant');
    expect(edges.length).toBe(2);
    const q3 = run(q2, (d) => ops.clearAssociative(d, model.id, entId)).project;
    expect(hasNode(q3, part.id, 'relationship', rel.id)).toBe(true);
    expect((q3.models[model.id] as ErModel).entities[entId]).toBeUndefined();
  });

  it('OPS-8: clearAssociative({keepEntity}) does not stack the relationship on the entity', () => {
    const { model, q, rel } = setup();
    let entId = '';
    const q2 = run(q, (d) => {
      entId = ops.makeAssociative(d, model.id, rel.id).refs[0]!.id;
    }).project;
    const q3 = run(q2, (d) => ops.clearAssociative(d, model.id, entId, { keepEntity: true })).project;
    for (const dgm of Object.values(q3.diagrams)) {
      const en = Object.values(dgm.nodes).find((n) => n.ref.kind === 'entity' && n.ref.id === entId);
      const rn = Object.values(dgm.nodes).find((n) => n.ref.kind === 'relationship' && n.ref.id === rel.id);
      if (en && rn) expect([rn.x, rn.y]).not.toEqual([en.x, en.y]);
    }
  });
});
