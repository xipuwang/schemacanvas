import { afterEach, describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import { useFixedClock } from '@/model/clock';
import { CONVERSION_RULE_IDS } from '@/model/conversionRules';
import { useDeterministicIds } from '@/model/ids';
import { fkReferencesKey } from '@/model/relationalFacts';
import { refKey } from '@/model/queries';
import { convertErToRelational } from './convert';
import type { ErModel } from '@/model/types';
import { exampleA, exampleE, kitchenSink } from './fixtures';
import { cloneJson, FIXED_NOW, frozenProject, rel, run } from './testkit';

const models: Array<[string, () => ErModel]> = [
  ['A', exampleA],
  ['E', exampleE],
  ['kitchen sink', kitchenSink],
];

describe.each(models)('invariants: %s', (_name, make) => {
  const { project, relationalModel: m, record, diagram } = run(make());
  const er = Object.values(project.models)[0]! as ErModel;

  it('trace completeness: every entity, attribute, relationship and participant is the source of >= 1 entry', () => {
    const sources = new Set(record.trace.map((t) => refKey(t.source)));
    for (const e of Object.values(er.entities)) expect(sources.has(`entity:${e.id}`), `entity ${e.name}`).toBe(true);
    for (const a of Object.values(er.attributes)) expect(sources.has(`attribute:${a.id}`), `attribute ${a.name}`).toBe(true);
    for (const r of Object.values(er.relationships)) {
      expect(sources.has(`relationship:${r.id}`), `relationship ${r.name}`).toBe(true);
      for (const p of r.participants) expect(sources.has(`participant:${p.id}`), `participant of ${r.name}`).toBe(true);
    }
  });

  it('the completeness safety net never fires and omitted elements carry a decision', () => {
    expect(record.decisions.filter((d) => d.id.includes('unmapped'))).toEqual([]);
    for (const t of record.trace.filter((x) => x.targets.length === 0)) {
      expect(record.decisions.some((d) => d.sources.some((s) => refKey(s) === refKey(t.source))), refKey(t.source)).toBe(true);
    }
  });

  it('trace targets and origins point at real generated elements; rule ids are in the vocabulary', () => {
    for (const t of record.trace) {
      expect(CONVERSION_RULE_IDS as readonly string[]).toContain(t.ruleId);
      for (const target of t.targets) {
        if (target.kind === 'relation') expect(m.relations[target.id]).toBeDefined();
        else if (target.kind === 'column') expect(m.relations[target.relationId]?.columns.some((c) => c.id === target.id)).toBe(true);
        else if (target.kind === 'foreignKey') expect(m.foreignKeys[target.id]).toBeDefined();
        else throw new Error(`unexpected target kind ${target.kind}`);
      }
    }
    const keys = new Set<string>();
    const check = (o: { ruleId: string; sources: unknown[]; key?: string } | undefined): void => {
      expect(o).toBeDefined();
      expect(CONVERSION_RULE_IDS as readonly string[]).toContain(o!.ruleId);
      expect(o!.sources.length).toBeGreaterThan(0);
      expect(o!.key).toBeTruthy();
      expect(keys.has(o!.key!), `duplicate origin key ${o!.key}`).toBe(false);
      keys.add(o!.key!);
    };
    for (const r of Object.values(m.relations)) {
      check(r.origin);
      r.columns.forEach((c) => check(c.origin));
      r.uniques.forEach((u) => check(u.origin));
    }
    Object.values(m.foreignKeys).forEach((fk) => check(fk.origin));
    for (const d of record.decisions) expect(CONVERSION_RULE_IDS as readonly string[]).toContain(d.ruleId);
  });

  it('the generated model is structurally sound: FKs reference whole keys, PK columns NOT NULL, unique names', () => {
    for (const fk of Object.values(m.foreignKeys)) {
      const src = m.relations[fk.sourceRelationId]!;
      const tgt = m.relations[fk.targetRelationId]!;
      expect(fk.columns.length).toBeGreaterThan(0);
      for (const p of fk.columns) {
        expect(src.columns.some((c) => c.id === p.sourceColumnId)).toBe(true);
        expect(tgt.columns.some((c) => c.id === p.targetColumnId)).toBe(true);
      }
      expect(fkReferencesKey(tgt, fk), `FK ${fk.id} must reference a complete key`).toBe(true);
    }
    for (const r of Object.values(m.relations)) {
      for (const id of r.primaryKey) expect(r.columns.find((c) => c.id === id)!.nullable).toBe(false);
      const names = r.columns.map((c) => c.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
    const relNames = Object.values(m.relations).map((r) => r.name.toLowerCase());
    expect(new Set(relNames).size).toBe(relNames.length);
  });

  it('warnings are conv.* only, with deterministic unique ids and ER-model modelId; record is consistent', () => {
    for (const w of record.warnings) {
      expect(w.code.startsWith('conv.')).toBe(true);
      expect(w.modelId).toBe(er.id);
      expect(w.affected.length).toBeGreaterThan(0);
    }
    expect(new Set(record.warnings.map((w) => w.id)).size).toBe(record.warnings.length);
    expect(new Set(record.decisions.map((d) => d.id)).size).toBe(record.decisions.length);
    expect(record.relationalModelId).toBe(m.id);
    expect(record.erModelId).toBe(er.id);
    expect(m.derivedFrom).toEqual({ erModelId: er.id, conversionId: record.id });
    expect(record.createdAt).toBe(FIXED_NOW);
    expect(record.previousConversionId).toBeUndefined();
  });

  it('diagram: one node per relation, one edge per FK (composite FK = one edge), edges resolve', () => {
    expect(Object.keys(diagram.nodes)).toHaveLength(Object.keys(m.relations).length);
    expect(Object.keys(diagram.edges)).toHaveLength(Object.keys(m.foreignKeys).length);
    for (const e of Object.values(diagram.edges)) {
      expect(e.ref.kind).toBe('foreignKey');
      expect(m.foreignKeys[(e.ref as { foreignKeyId: string }).foreignKeyId]).toBeDefined();
    }
  });
});

describe('purity', () => {
  it('never mutates a deeply frozen project (frozen mutation would throw) and leaves it JSON-identical', () => {
    const project = frozenProject(kitchenSink());
    const before = JSON.stringify(project);
    const erId = Object.keys(project.models)[0]!;
    convertErToRelational(project, erId, { oneToOne: 'merge', materializeDerived: Object.values((project.models[erId] as ErModel).attributes).filter((a) => a.derived).map((a) => a.id) });
    expect(JSON.stringify(project)).toBe(before);
  });

  it('does not alias the caller options (mutating the record afterwards leaves the input alone)', () => {
    const options = { oneToOne: 'auto' as const, relationshipOverrides: {}, materializeDerived: [] as string[], carryDataTypes: true };
    const r = run(exampleA(), options);
    r.record.options.materializeDerived.push('x');
    expect(options.materializeDerived).toEqual([]);
  });

  it('rejects a non-ER model id', () => {
    const project = frozenProject(exampleA());
    expect(() => convertErToRelational(project, 'nope')).toThrow();
  });
});

describe('determinism', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('same input twice => deep-equal output (ids stubbed), independent of Record key order', () => {
    const er = kitchenSink();
    const once = (e: ErModel) => {
      restore = useDeterministicIds(1);
      const out = convertErToRelational(frozenProject(e), e.id, {}, { now: FIXED_NOW });
      restore();
      return out;
    };
    const a = once(er);
    const b = once(er);
    expect(b).toEqual(a);

    // Re-insert entities / relationships / attributes in reverse order: the output must not change.
    const shuffled = cloneJson(er);
    shuffled.entities = Object.fromEntries(Object.entries(shuffled.entities).reverse());
    shuffled.relationships = Object.fromEntries(Object.entries(shuffled.relationships).reverse());
    shuffled.attributes = Object.fromEntries(Object.entries(shuffled.attributes).reverse());
    expect(once(shuffled)).toEqual(a);
  });

  it('createdAt defaults to the (fixable) clock', () => {
    const undo = useFixedClock('2030-05-05T00:00:00.000Z');
    try {
      const project = frozenProject(exampleA());
      const r = convertErToRelational(project, Object.keys(project.models)[0]!);
      expect(r.record.createdAt).toBe('2030-05-05T00:00:00.000Z');
    } finally {
      undo();
    }
  });
});

describe('id reuse via env.previous', () => {
  it('reuses ids of unchanged elements after adding an attribute; new elements get fresh ids', () => {
    const b = erBuilder('re');
    const s = b.entity('Student').key('Sid').attr('Name');
    const c = b.entity('Course').key('Cid');
    b.relate('Enrolls', s, c, 'M:N');
    b.relate('Likes', s, c, '1:N');
    const er = b.build();
    const first = run(er);

    s.attr('Email');
    const second = run(er, undefined, { previous: first.relationalModel });

    const ids = (m: typeof first.relationalModel) => ({
      relations: Object.values(m.relations).map((r) => r.id).sort(),
      fks: Object.keys(m.foreignKeys).sort(),
    });
    expect(ids(second.relationalModel)).toEqual(ids(first.relationalModel));
    const before = rel(first.relationalModel, 'Student');
    const after = rel(second.relationalModel, 'Student');
    expect(after.id).toBe(before.id);
    for (const col of before.columns) expect(after.columns.find((x) => x.id === col.id)?.name).toBe(col.name);
    const added = after.columns.filter((x) => !before.columns.some((o) => o.id === x.id));
    expect(added.map((x) => x.name)).toEqual(['Email']);
    // FK pairs still point at the same column ids.
    for (const fk of Object.values(first.relationalModel.foreignKeys)) {
      expect(second.relationalModel.foreignKeys[fk.id]?.columns).toEqual(fk.columns);
    }
    // fresh model / conversion ids, no previousConversionId (the applier sets it)
    expect(second.relationalModel.id).not.toBe(first.relationalModel.id);
    expect(second.record.id).not.toBe(first.record.id);
    expect(second.record.previousConversionId).toBeUndefined();
    // Element ids are never duplicated inside one result.
    const all = Object.values(second.relationalModel.relations).flatMap((r) => [r.id, ...r.columns.map((x) => x.id), ...r.uniques.map((u) => u.id)]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('survives a renamed entity/attribute (ids come from source ids, not names)', () => {
    const b = erBuilder('re');
    b.entity('Student').key('Sid');
    const er = b.build();
    const first = run(er);
    Object.values(er.entities)[0]!.name = 'Pupil';
    Object.values(er.attributes)[0]!.name = 'Pid';
    const second = run(er, undefined, { previous: first.relationalModel });
    expect(Object.keys(second.relationalModel.relations)).toEqual(Object.keys(first.relationalModel.relations));
    expect(rel(second.relationalModel, 'Pupil').columns[0]!.id).toBe(Object.values(first.relationalModel.relations)[0]!.columns[0]!.id);
  });
});
