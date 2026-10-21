import { describe, expect, it } from 'vitest';
import { createBareProject, createDiagram, createErModel, createRelationalModel } from './defaults';
import { createNodeResolver, edgeEndpointRefs, nodeIdOfRef, refResolves, resolveRefsInDiagram, syncDiagram } from './diagramSync';
import { identificationOrder, weakEntityOwners } from './erSemantics';
import { dataTypesCompatible, parseDataType } from './relationalFacts';
import {
  columnRole,
  describeForeignKey,
  describeRef,
  findColumn,
  fkCardinality,
  foreignKeysOf,
  foreignKeysReferencing,
  modelOfDiagram,
  relationalModelOf,
  rootOwner,
} from './queries';
import type { ErModel, ErParticipant, ErRelationship, ForeignKey, Id, Project, RelationalModel } from './types';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const NASTY = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

// ----- fixtures ---------------------------------------------------------------

function er(entityIds: Id[]): ErModel {
  const m = createErModel('E', 'mdl_e');
  for (const id of entityIds) m.entities[id] = { id, name: id, weak: true };
  return m;
}
/** `owner` identifies `weak` (weak participant flagged `identified`). */
function own(m: ErModel, owner: Id, weak: Id, rid: string): void {
  const parts: ErParticipant[] = [
    { id: `${rid}_o`, entityId: owner, max: 'one', participation: 'partial' },
    { id: `${rid}_w`, entityId: weak, max: 'many', participation: 'total', identified: true },
  ];
  const rel: ErRelationship = { id: rid, name: rid, identifying: true, participants: parts };
  m.relationships[rid] = rel;
}

// ----- 1. prototype safety ----------------------------------------------------

describe('prototype-named ids', () => {
  it('refResolves / edgeEndpointRefs do not resolve inherited members (ER)', () => {
    const m = er(['a']);
    for (const id of NASTY) {
      expect(refResolves(m, { kind: 'entity', id })).toBe(false);
      expect(refResolves(m, { kind: 'attribute', id })).toBe(false);
      expect(refResolves(m, { kind: 'relationship', id })).toBe(false);
      expect(refResolves(m, { kind: 'participant', relationshipId: id, id: 'x' })).toBe(false);
      expect(edgeEndpointRefs(m, { kind: 'participant', relationshipId: id, participantId: id })).toBeUndefined();
      expect(edgeEndpointRefs(m, { kind: 'attribute', attributeId: id })).toBeUndefined();
      expect(describeRef({ models: { m } } as Any, { kind: 'entity', id })).toBe(`entity:${id}`);
    }
  });

  it('a participant whose entityId is prototype-named has no endpoint', () => {
    const m = er(['a']);
    m.relationships.r = {
      id: 'r',
      name: 'r',
      identifying: false,
      participants: [{ id: 'p', entityId: 'constructor', max: 'one', participation: 'partial' }],
    };
    expect(edgeEndpointRefs(m, { kind: 'participant', relationshipId: 'r', participantId: 'p' })).toBeUndefined();
  });

  it('refResolves / findColumn / fk lookups ignore inherited members (relational)', () => {
    const m = createRelationalModel('R', 'generic', 'mdl_r') as RelationalModel;
    for (const id of NASTY) {
      expect(refResolves(m, { kind: 'relation', id })).toBe(false);
      expect(refResolves(m, { kind: 'foreignKey', id })).toBe(false);
      expect(refResolves(m, { kind: 'column', relationId: id, id: 'x' })).toBe(false);
      expect(refResolves(m, { kind: 'unique', relationId: id, id: 'x' })).toBe(false);
      expect(findColumn(m, id)).toBeUndefined();
      expect(columnRole(m, id, id)).toBe('plain');
      expect(edgeEndpointRefs(m, { kind: 'foreignKey', foreignKeyId: id })).toBeUndefined();
    }
  });

  it('elements that really use prototype-named ids still resolve', () => {
    const m = createRelationalModel('R', 'generic', 'mdl_r') as RelationalModel;
    const raw = JSON.parse(
      '{"__proto__":{"id":"__proto__","name":"P","columns":[{"id":"constructor","name":"c","nullable":false}],"primaryKey":["constructor"],"uniques":[],"indexes":[]}}',
    );
    m.relations = raw;
    expect(Object.keys(m.relations)).toEqual(['__proto__']);
    expect(refResolves(m, { kind: 'relation', id: '__proto__' })).toBe(true);
    expect(refResolves(m, { kind: 'column', relationId: '__proto__', id: 'constructor' })).toBe(true);
    expect(findColumn(m, 'constructor')?.column.name).toBe('c');
  });

  it('node resolver / nodeIdOfRef / resolveRefsInDiagram / syncDiagram survive prototype-named ids', () => {
    const p: Project = createBareProject('P');
    const m = er(['a']);
    p.models[m.id] = m;
    const d = createDiagram('chen', m.id, 'D', 'dgm_1');
    p.diagrams[d.id] = d;
    JSON.parse('{"x":1}'); // keep the parser honest
    d.nodes = JSON.parse(
      '{"__proto__":{"id":"__proto__","ref":{"kind":"entity","id":"constructor"},"x":0,"y":0},"n2":{"id":"n2","ref":{"kind":"entity","id":"a"},"x":0,"y":0}}',
    );
    expect(nodeIdOfRef(d, m, { kind: 'entity', id: 'a' })).toBe('n2');
    expect(createNodeResolver(d, m)({ kind: 'entity', id: 'toString' })).toBeUndefined();
    expect(() => resolveRefsInDiagram(p, d, [{ kind: 'entity', id: 'constructor' }, { kind: 'entity', id: 'a' }])).not.toThrow();
    expect(resolveRefsInDiagram(p, d, [{ kind: 'entity', id: 'constructor' }]).nodeIds).toEqual([]);
    syncDiagram(p, d.id);
    // The dangling '__proto__' node (ref 'constructor' does not exist) is removed, the real one kept.
    expect(Object.keys(d.nodes)).toContain('n2');
    expect(Object.keys(d.nodes)).not.toContain('__proto__');
  });

  it('modelOfDiagram / relationalModelOf / syncDiagram do not resolve prototype-named model or diagram ids', () => {
    const p = createBareProject('P');
    const d = createDiagram('chen', 'constructor', 'D', 'dgm_1');
    expect(modelOfDiagram(p, d)).toBeUndefined();
    expect(relationalModelOf(p, d)).toBeUndefined();
    expect(syncDiagram(p, '__proto__')).toEqual({ addedNodes: [], removedNodes: [], addedEdges: [], removedEdges: [] });
    expect(syncDiagram(p, 'toString').addedNodes).toEqual([]);
  });

  it('erSemantics ignores prototype-named entities and relationships', () => {
    const m = er(['a']);
    m.relationships.r = {
      id: 'r',
      name: 'r',
      identifying: true,
      participants: [
        { id: 'p1', entityId: 'constructor', max: 'one', participation: 'partial' },
        { id: 'p2', entityId: 'a', max: 'many', participation: 'total', identified: true },
      ],
    };
    expect(weakEntityOwners(m, 'a')).toEqual([]);
    expect(identificationOrder(m)).toEqual({ order: ['a'], cycles: [] });
  });

  it('rootOwner does not walk into inherited members', () => {
    const m = er(['a']);
    m.attributes.x = { id: 'x', name: 'x', owner: { kind: 'attribute', id: 'constructor' }, order: 0, key: 'none', multivalued: false, derived: false };
    expect(rootOwner(m, m.attributes.x)).toBeUndefined();
  });

  it('data type parsing is safe for prototype-like names', () => {
    for (const t of ['constructor', '__proto__', 'toString', 'valueOf']) {
      expect(parseDataType(t)?.base).toBe(t.toUpperCase());
      expect(dataTypesCompatible(t, 'INT')).toBe('unknown');
    }
  });
});

// ----- 2. erSemantics complexity & equivalence -------------------------------

/** The original restart-loop Kahn + recursive Tarjan, kept as a reference. */
function referenceOrder(model: ErModel): { order: Id[]; cycles: Id[][] } {
  const ids = Object.keys(model.entities);
  const owners = new Map<Id, Set<Id>>();
  for (const id of ids) {
    const s = new Set<Id>();
    for (const r of Object.values(model.relationships)) {
      if (!r.identifying) continue;
      const flagged = r.participants.filter((p) => p.identified);
      const weak = r.participants.filter((p) => model.entities[p.entityId]?.weak);
      const identified = flagged.length > 0 ? flagged : weak.length === 1 ? weak : [];
      for (const wp of identified) {
        if (wp.entityId !== id) continue;
        for (const op of r.participants) {
          if (identified.some((i) => i.id === op.id)) continue;
          if (model.entities[op.entityId]) s.add(op.entityId);
        }
      }
    }
    owners.set(id, s);
  }
  const order: Id[] = [];
  const placed = new Set<Id>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of ids) {
      if (placed.has(id)) continue;
      if ([...owners.get(id)!].every((o) => placed.has(o))) {
        order.push(id);
        placed.add(id);
        progressed = true;
      }
    }
  }
  const blocked = ids.filter((id) => !placed.has(id));
  let index = 0;
  const idx = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const cycles: Id[][] = [];
  const strong = (v: Id): void => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    onStack.add(v);
    for (const w of owners.get(v)!) {
      if (!blocked.includes(w)) continue;
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: Id[] = [];
      let w: Id;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || owners.get(v)!.has(v)) cycles.push(comp.reverse());
    }
  };
  for (const v of blocked) if (!idx.has(v)) strong(v);
  return { order: [...order, ...blocked], cycles };
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('identificationOrder is linear and iterative', () => {
  it('matches the reference algorithm on randomised small graphs', () => {
    const rand = rng(12345);
    for (let iter = 0; iter < 400; iter++) {
      const n = 1 + Math.floor(rand() * 9);
      const ids = Array.from({ length: n }, (_, i) => `e${i}`);
      const m = er(ids);
      const edges = Math.floor(rand() * 14);
      for (let k = 0; k < edges; k++) {
        const o = ids[Math.floor(rand() * n)]!;
        const w = ids[Math.floor(rand() * n)]!;
        own(m, o, w, `r${k}`);
      }
      // a few entities strong so ownership isn't all-weak
      for (const id of ids) if (rand() < 0.3) m.entities[id]!.weak = false;
      const got = identificationOrder(m);
      expect(got, `iteration ${iter}`).toEqual(referenceOrder(m));
    }
  });

  it('handles a 5000-entity weak chain (listed in reverse) quickly, without stack overflow', () => {
    const N = 5000;
    const ids = Array.from({ length: N }, (_, i) => `e${N - 1 - i}`); // e4999 first ... e0 last
    const m = er(ids);
    for (let i = 0; i < N - 1; i++) own(m, `e${i}`, `e${i + 1}`, `r${i}`);
    const t = Date.now();
    const { order, cycles } = identificationOrder(m);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(cycles).toEqual([]);
    expect(order).toEqual(Array.from({ length: N }, (_, i) => `e${i}`));
  });

  it('handles a 20000-entity weak cycle quickly, without stack overflow', () => {
    const N = 20000;
    const ids = Array.from({ length: N }, (_, i) => `e${i}`);
    const m = er(ids);
    for (let i = 0; i < N; i++) own(m, `e${i}`, `e${(i + 1) % N}`, `r${i}`);
    const t = Date.now();
    const { order, cycles } = identificationOrder(m);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(order).toHaveLength(N);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(N);
  });
});

// ----- 4. corrupt FK data -----------------------------------------------------

describe('queries tolerate corrupt data', () => {
  const model = (): RelationalModel => {
    const m = createRelationalModel('R', 'generic', 'mdl_r') as RelationalModel;
    m.relations.a = { id: 'a', name: 'A', columns: [{ id: 'c1', name: 'x', nullable: false }], primaryKey: ['c1'], uniques: [], indexes: [] };
    return m;
  };

  it('fkCardinality / describeForeignKey with missing columns array, null pairs, missing relations', () => {
    const m = model();
    const bad: Any[] = [
      { id: 'f1', sourceRelationId: 'a', targetRelationId: 'a' },
      { id: 'f2', sourceRelationId: 'a', targetRelationId: 'a', columns: [null, { sourceColumnId: 'c1' }, 5] },
      { id: 'f3', sourceRelationId: 'zzz', targetRelationId: '__proto__', columns: 'nope' },
      { id: 'f4', sourceRelationId: 'a', targetRelationId: 'a', columns: [], cardinality: null },
      {},
    ];
    for (const fk of bad as ForeignKey[]) {
      expect(() => fkCardinality(m, fk)).not.toThrow();
      expect(() => describeForeignKey(m, fk)).not.toThrow();
    }
    expect(fkCardinality(m, bad[0])).toEqual({ childMax: 'many', childMin: 0, parentMin: 0, stated: [] });
    expect(describeForeignKey(m, bad[0])).toBe('A.? → A.?');
    expect(fkCardinality(m, bad[2]).childMax).toBe('many');
  });

  it('findColumn / foreignKeysOf / columnRole / describeRef with broken relations', () => {
    const m = model();
    (m.relations as Any).b = { id: 'b', name: 'B' }; // no columns / uniques / indexes
    (m.relations as Any).n = null;
    m.foreignKeys.f = { id: 'f', sourceRelationId: 'a', targetRelationId: 'a' } as Any;
    (m.foreignKeys as Any).g = null;
    expect(findColumn(m, 'c1')?.relation.id).toBe('a');
    expect(findColumn(m, 'nope')).toBeUndefined();
    expect(foreignKeysOf(m, 'a')).toHaveLength(1);
    expect(foreignKeysReferencing(m, 'a')).toHaveLength(1);
    expect(columnRole(m, 'a', 'c1')).toBe('pk');
    expect(() => describeRef({ models: { m } } as Any, { kind: 'foreignKey', id: 'f' })).not.toThrow();
    expect(() => fkCardinality(m, { id: 'q', sourceRelationId: 'b', targetRelationId: 'b', columns: [{ sourceColumnId: 'c1', targetColumnId: 'c1' }] })).not.toThrow();
  });
});
