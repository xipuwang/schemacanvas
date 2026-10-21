import { describe, expect, it } from 'vitest';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { defaultParticipantEntity, effectLines, identifiedChoices, moveInList, needsKeyPicker, nextFreePair, pairsForTargetKey, setPairColumn, toggleInSet, toggleKeyParticipant, togglePrimaryKey } from './forms';

describe('list helpers', () => {
  it('moveInList clamps and keeps the array on a no-op', () => {
    expect(moveInList(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
    expect(moveInList(['a', 'b', 'c'], 2, -2)).toEqual(['c', 'a', 'b']);
  });
  it('PK toggle appends, removes, and never duplicates', () => {
    expect(togglePrimaryKey(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(togglePrimaryKey(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(togglePrimaryKey(['a'], 'a', true)).toEqual(['a']);
    expect(toggleInSet(['a'], 'a', true)).toEqual(['a']);
  });
});

describe('foreign key pairs', () => {
  const b = relationalBuilder('m');
  const drug = b.relation('Drug', ['CompanyName', 'TradeName', 'Formula'], { pk: ['CompanyName', 'TradeName'] });
  const rx = b.relation('Prescription', ['Id', 'CompanyName', 'DrugTradeName']);
  const m = b.build();
  const drugRel = m.relations[drug.relation.id]!;
  const rxRel = m.relations[rx.relation.id]!;

  it('pairsForTargetKey matches by name first, then the first free column, in key order', () => {
    const pairs = pairsForTargetKey(rxRel, drugRel);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ sourceColumnId: rx.col('CompanyName'), targetColumnId: drug.col('CompanyName') });
    expect(pairs[1]).toEqual({ sourceColumnId: rx.col('DrugTradeName'), targetColumnId: drug.col('TradeName') }); // name contains the target name
  });

  it('picking a column another pair uses swaps the two, so no forbidden duplicate ever exists', () => {
    const pairs = pairsForTargetKey(rxRel, drugRel);
    const swapped = setPairColumn(pairs, 0, 'target', drug.col('TradeName'));
    expect(swapped[0]!.targetColumnId).toBe(drug.col('TradeName'));
    expect(swapped[1]!.targetColumnId).toBe(drug.col('CompanyName'));
    expect(new Set(swapped.map((p) => p.targetColumnId)).size).toBe(2);
    expect(setPairColumn(pairs, 0, 'source', pairs[0]!.sourceColumnId)).toEqual(pairs);
  });

  it('nextFreePair uses unused columns and returns undefined when a side is exhausted', () => {
    const full = pairsForTargetKey(rxRel, drugRel);
    const next = nextFreePair(full, rxRel, drugRel)!;
    expect(full.some((p) => p.sourceColumnId === next.sourceColumnId)).toBe(false);
    expect(full.some((p) => p.targetColumnId === next.targetColumnId)).toBe(false);
    const all = drugRel.columns.map((c, i) => ({ sourceColumnId: rxRel.columns[i]!.id, targetColumnId: c.id }));
    expect(nextFreePair(all, rxRel, drugRel)).toBeUndefined();
  });
});

describe('relationship helpers', () => {
  const b = erBuilder('er');
  const dept = b.entity('Department').key('Id');
  const emp = b.entity('Employee').key('Eid');
  const rel = b.relate('WorksFor', dept, emp, '1:N');
  const model = b.build();
  const r = model.relationships[rel.relationship.id]!;

  it('effect lines restate the stored cardinality for each participant (look-across)', () => {
    const lines = effectLines(model, r);
    expect(lines.map((l) => [l.key, l.params.entity, l.params.others])).toEqual([
      ['one', 'Department', 'Employee'],
      ['many', 'Employee', 'Department'],
    ]);
  });
  it('n-ary relationships use the combination wording', () => {
    const t = erBuilder('t');
    const a = t.entity('A').key('a');
    const c = t.entity('B').key('b');
    const d = t.entity('C').key('c');
    const rr = t.relationship('R', [{ entity: a }, { entity: c }, { entity: d, max: 'one' }]);
    const tm = t.build();
    const keys = effectLines(tm, tm.relationships[rr.relationship.id]!).map((l) => l.key);
    expect(keys).toEqual(['manyNary', 'manyNary', 'oneNary']);
    expect(needsKeyPicker(tm, tm.relationships[rr.relationship.id]!)).toBe(true);
    expect(needsKeyPicker(model, r)).toBe(false);
  });
  it('key participants are returned in participant order', () => {
    const ids = r.participants.map((p) => p.id);
    expect(toggleKeyParticipant(r, [ids[1]!], ids[0]!, true)).toEqual(ids);
    expect(toggleKeyParticipant(r, ids, ids[0]!, false)).toEqual([ids[1]]);
  });
  it('identified choice is only requested when the weak-entity rule cannot decide', () => {
    expect(identifiedChoices(model, r)).toHaveLength(2); // no weak entity: the user must choose
    const w = erBuilder('w');
    const o = w.entity('Owner').key('id');
    const k = w.entity('Dep', { weak: true }).partialKey('n');
    const id = w.relate('Has', o, k, '1:N', { identifying: true, rightTotal: true });
    const wm = w.build();
    expect(identifiedChoices(wm, wm.relationships[id.relationship.id]!)).toEqual([]);
  });
  it('default participant entity prefers one not yet used', () => {
    const fresh = erBuilder('d');
    const x = fresh.entity('X').key('x');
    fresh.entity('Y').key('y');
    const rr = fresh.relationship('R', [{ entity: x }]);
    const fm = fresh.build();
    const picked = defaultParticipantEntity(fm, fm.relationships[rr.relationship.id]!)!;
    expect(fm.entities[picked]!.name).toBe('Y');
  });
});
