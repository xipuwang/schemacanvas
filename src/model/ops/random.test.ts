/**
 * Property-style test: a seeded random sequence of 300 ops on an ER model and on a relational model must never violate the
 * hard invariants, must keep every diagram a fixed point of syncDiagram, and must never throw anything but the typed
 * refusals the generator deliberately provokes (moving an attribute below itself, promoting an identifying relationship…).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock } from '../clock';
import { useDeterministicIds } from '../ids';
import { nodeableRefs } from '../diagramSync';
import { checkInvariants } from '../invariants';
import { refKey } from '../queries';
import type { ErModel, Project, RelationalModel } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { projectWith, run, sampleEr, sampleRel } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(9000);
});
afterEach(() => restore());

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    pick<T>(xs: readonly T[]): T | undefined {
      return xs.length ? xs[Math.floor(next() * xs.length)] : undefined;
    },
    chance: (p: number) => next() < p,
  };
}
type Rng = ReturnType<typeof rng>;
type Step = (d: Project, r: Rng) => unknown;

const sortedValues = <T extends { id: string }>(rec: Record<string, T>): T[] => Object.values(rec).sort((a, b) => (a.id < b.id ? -1 : 1));

function presentation(mid: string, dgms: string[]): Record<string, Step> {
  const anyNode = (d: Project, r: Rng) => {
    const dg = r.pick(dgms)!;
    return { dg, n: r.pick(sortedValues(d.diagrams[dg]!.nodes)) };
  };
  return {
    moveNodes: (d, r) => {
      const { dg, n } = anyNode(d, r);
      if (n) ops.setNodePositions(d, dg, { [n.id]: { x: r.int(2000), y: r.int(2000) } });
    },
    moveBy: (d, r) => {
      const dg = r.pick(dgms)!;
      ops.moveNodesBy(d, dg, Object.keys(d.diagrams[dg]!.nodes), r.int(40) - 20, r.int(40) - 20);
    },
    front: (d, r) => {
      const { dg, n } = anyNode(d, r);
      if (n) (r.chance(0.5) ? ops.bringToFront : ops.sendToBack)(d, dg, [n.id]);
    },
    hide: (d, r) => {
      const { dg, n } = anyNode(d, r);
      if (n && r.chance(0.5)) ops.removeFromDiagram(d, dg, [n.id]);
    },
    show: (d, r) => {
      const dg = r.pick(dgms)!;
      const model = d.models[mid]!;
      const refs = nodeableRefs(model);
      ops.showInDiagram(d, dg, refs.filter(() => r.chance(0.5)));
    },
    reroute: (d, r) => {
      const dg = r.pick(dgms)!;
      const e = r.pick(sortedValues(d.diagrams[dg]!.edges));
      if (e) ops.setEdgeRoute(d, dg, e.id, { mode: 'manual', waypoints: [{ x: r.int(500), y: r.int(500) }] });
    },
    duplicate: (d, r) => {
      const dg = r.pick(dgms)!;
      if (Object.keys(d.diagrams[dg]!.nodes).length > 40) return;
      const picks = sortedValues(d.diagrams[dg]!.nodes).filter(() => r.chance(0.25));
      ops.duplicateNodes(d, dg, picks.map((n) => n.id));
    },
    options: (d, r) => ops.setDiagramOptions(d, r.pick(dgms)!, { grid: { size: 10 + r.int(20) } }),
  };
}

function erSteps(mid: string): Record<string, Step> {
  const m = (d: Project) => d.models[mid] as ErModel;
  const owner = (d: Project, r: Rng) => {
    const model = m(d);
    const owners = [
      ...sortedValues(model.entities).map((e) => ({ kind: 'entity' as const, id: e.id })),
      ...sortedValues(model.relationships).map((x) => ({ kind: 'relationship' as const, id: x.id })),
      ...sortedValues(model.attributes).map((a) => ({ kind: 'attribute' as const, id: a.id })),
    ];
    return r.pick(owners);
  };
  return {
    addEntity: (d, r) => {
      if (Object.keys(m(d).entities).length < 8) ops.addEntity(d, mid, { weak: r.chance(0.3) });
    },
    updateEntity: (d, r) => {
      const e = r.pick(sortedValues(m(d).entities));
      if (e && !e.associativeOf) ops.updateEntity(d, mid, e.id, { weak: r.chance(0.5), name: `E${r.int(99)}` });
    },
    removeEntity: (d, r) => {
      const e = r.pick(sortedValues(m(d).entities));
      if (e && Object.keys(m(d).entities).length > 3) ops.removeEntity(d, mid, e.id);
    },
    addAttribute: (d, r) => {
      const o = owner(d, r);
      if (o && Object.keys(m(d).attributes).length < 30) ops.addAttribute(d, mid, o, { key: r.pick(['none', 'primary', 'partial'] as const), multivalued: r.chance(0.2), derived: r.chance(0.2) });
    },
    updateAttribute: (d, r) => {
      const a = r.pick(sortedValues(m(d).attributes));
      const other = r.pick(sortedValues(m(d).attributes));
      if (a) ops.updateAttribute(d, mid, a.id, { name: `a${r.int(99)}`, derivedFrom: other ? [other.id] : undefined, optional: r.chance(0.5) });
    },
    reorderAttribute: (d, r) => {
      const a = r.pick(sortedValues(m(d).attributes));
      if (a) ops.reorderAttribute(d, mid, a.id, r.int(5));
    },
    moveAttribute: (d, r) => {
      const a = r.pick(sortedValues(m(d).attributes));
      const o = owner(d, r);
      if (!a || !o) return;
      ops.moveAttribute(d, mid, a.id, o, r.int(4)); // may refuse with 'cycle': deliberately not pre-checked
    },
    removeAttribute: (d, r) => {
      const a = r.pick(sortedValues(m(d).attributes));
      if (a) ops.removeAttribute(d, mid, a.id);
    },
    addRelationship: (d, r) => {
      const es = sortedValues(m(d).entities);
      if (es.length < 1 || Object.keys(m(d).relationships).length >= 6) return;
      const n = 2 + r.int(2);
      ops.addRelationship(d, mid, {
        participants: Array.from({ length: n }, () => ({ entityId: r.pick(es)!.id, max: r.chance(0.5) ? 'one' : ('many' as const), participation: r.chance(0.3) ? 'total' : ('partial' as const) })),
        identifying: r.chance(0.2),
      });
    },
    setIdentifying: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      if (!rel) return;
      const wantOn = r.chance(0.5);
      const hasAssoc = Object.values(m(d).entities).some((e) => e.associativeOf === rel.id);
      if (wantOn && hasAssoc) return;
      ops.setIdentifying(d, mid, rel.id, wantOn, wantOn && rel.participants.length && r.chance(0.5) ? { identifiedParticipantId: r.pick(rel.participants)!.id } : {});
    },
    addParticipant: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      const e = r.pick(sortedValues(m(d).entities));
      if (rel && e && rel.participants.length < 4) ops.addParticipant(d, mid, rel.id, { entityId: e.id });
    },
    updateParticipant: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      const p = rel && r.pick(rel.participants);
      const e = r.pick(sortedValues(m(d).entities));
      if (rel && p && e) ops.updateParticipant(d, mid, rel.id, p.id, { max: r.chance(0.5) ? 'one' : 'many', participation: r.chance(0.5) ? 'total' : 'partial', entityId: r.chance(0.3) ? e.id : undefined, role: r.chance(0.3) ? 'r' : undefined });
    },
    removeParticipant: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      const p = rel && r.pick(rel.participants);
      if (rel && p) ops.removeParticipant(d, mid, rel.id, p.id);
    },
    removeRelationship: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      if (rel) ops.removeRelationship(d, mid, rel.id);
    },
    makeAssociative: (d, r) => {
      const rel = r.pick(sortedValues(m(d).relationships));
      if (!rel) return;
      ops.makeAssociative(d, mid, rel.id); // may refuse (identifying / already promoted): deliberately not pre-checked
    },
    clearAssociative: (d, r) => {
      const e = r.pick(sortedValues(m(d).entities).filter((x) => x.associativeOf));
      if (e) ops.clearAssociative(d, mid, e.id, { keepEntity: r.chance(0.3) });
    },
  };
}

function relSteps(mid: string, dgms: string[]): Record<string, Step> {
  const m = (d: Project) => d.models[mid] as RelationalModel;
  const rel = (d: Project, r: Rng) => r.pick(sortedValues(m(d).relations));
  return {
    addRelation: (d, r) => {
      if (Object.keys(m(d).relations).length < 7) ops.addRelation(d, mid, { columns: [{ name: 'id', pk: r.chance(0.7) }, { name: 'v' }] });
    },
    updateRelation: (d, r) => {
      const x = rel(d, r);
      if (x) ops.updateRelation(d, mid, x.id, { name: `T${r.int(50)}`, schemaName: r.chance(0.3) ? 's' : undefined });
    },
    removeRelation: (d, r) => {
      const x = rel(d, r);
      if (x && Object.keys(m(d).relations).length > 2) ops.removeRelation(d, mid, x.id);
    },
    addColumn: (d, r) => {
      const x = rel(d, r);
      if (x && x.columns.length < 8) ops.addColumn(d, mid, x.id, { dataType: 'INT' }, { index: r.int(9) });
    },
    updateColumn: (d, r) => {
      const x = rel(d, r);
      const c = x && r.pick(x.columns);
      if (x && c) ops.updateColumn(d, mid, x.id, c.id, { name: `c${r.int(99)}`, nullable: r.chance(0.5) });
    },
    reorderColumn: (d, r) => {
      const x = rel(d, r);
      const c = x && r.pick(x.columns);
      if (x && c) ops.reorderColumn(d, mid, x.id, c.id, r.int(8));
    },
    removeColumn: (d, r) => {
      const x = rel(d, r);
      const c = x && r.pick(x.columns);
      if (x && c) ops.removeColumn(d, mid, x.id, c.id);
    },
    setPrimaryKey: (d, r) => {
      const x = rel(d, r);
      if (x) ops.setPrimaryKey(d, mid, x.id, x.columns.filter(() => r.chance(0.4)).map((c) => c.id));
    },
    setColumnUnique: (d, r) => {
      const x = rel(d, r);
      const c = x && r.pick(x.columns);
      if (x && c) ops.setColumnUnique(d, mid, x.id, c.id, r.chance(0.6));
    },
    addUnique: (d, r) => {
      const x = rel(d, r);
      const cols = x?.columns.filter(() => r.chance(0.5)).map((c) => c.id) ?? [];
      if (x && cols.length) ops.addUnique(d, mid, x.id, { columnIds: cols });
    },
    addIndex: (d, r) => {
      const x = rel(d, r);
      const cols = x?.columns.filter(() => r.chance(0.5)).map((c) => c.id) ?? [];
      if (x && cols.length) ops.addIndex(d, mid, x.id, { columnIds: cols, descendingColumnIds: cols.slice(0, 1) });
    },
    addCheck: (d, r) => {
      const x = rel(d, r);
      const c = x && r.pick(x.columns);
      if (x && c) ops.addCheck(d, mid, x.id, { expression: 'x > 0', columnIds: [c.id] });
    },
    removeConstraint: (d, r) => {
      const x = rel(d, r);
      if (!x) return;
      const u = r.pick(x.uniques);
      if (u) ops.removeUnique(d, mid, x.id, u.id);
      const i = r.pick(x.indexes);
      if (i) ops.removeIndex(d, mid, x.id, i.id);
    },
    addForeignKey: (d, r) => {
      const s = rel(d, r);
      const t = rel(d, r);
      if (!s || !t || Object.keys(m(d).foreignKeys).length > 12) return;
      const n = 1 + r.int(2);
      const sc = s.columns.slice(0, n);
      const tc = t.columns.slice(0, n);
      if (sc.length !== tc.length || sc.length === 0) return;
      ops.addForeignKey(d, mid, { sourceRelationId: s.id, targetRelationId: t.id, columns: sc.map((c, i) => ({ sourceColumnId: c.id, targetColumnId: tc[i]!.id })) });
    },
    createFkColumns: (d, r) => {
      const s = rel(d, r);
      const t = rel(d, r);
      if (!s || !t || t.primaryKey.length === 0 || s.columns.length > 6) return;
      const made = ops.createFkColumns(d, mid, { sourceRelationId: s.id, targetRelationId: t.id });
      ops.addForeignKey(d, mid, { sourceRelationId: s.id, targetRelationId: t.id, columns: made.pairs });
    },
    updateForeignKey: (d, r) => {
      const fk = r.pick(sortedValues(m(d).foreignKeys));
      if (!fk) return;
      const s = m(d).relations[fk.sourceRelationId]!;
      const t = m(d).relations[fk.targetRelationId]!;
      const n = Math.min(s.columns.length, t.columns.length, 1 + r.int(2));
      ops.updateForeignKey(d, mid, fk.id, { columns: s.columns.slice(0, n).map((c, i) => ({ sourceColumnId: c.id, targetColumnId: t.columns[i]!.id })), label: r.chance(0.5) ? 'L' : undefined });
    },
    removeForeignKey: (d, r) => {
      const fk = r.pick(sortedValues(m(d).foreignKeys));
      if (fk) ops.removeForeignKey(d, mid, fk.id);
    },
    columnWidth: (d, r) => {
      const dg = r.pick(dgms)!;
      const n = r.pick(sortedValues(d.diagrams[dg]!.nodes));
      const x = n && m(d).relations[n.ref.id];
      const c = x && r.pick(x.columns);
      if (n && c) ops.setColumnWidth(d, dg, n.id, c.id, r.chance(0.7) ? 60 + r.int(100) : undefined);
    },
    branchAnchors: (d, r) => {
      const dg = r.pick(dgms)!;
      const e = r.pick(sortedValues(d.diagrams[dg]!.edges));
      if (!e || e.ref.kind !== 'foreignKey') return;
      const fk = m(d).foreignKeys[e.ref.foreignKeyId]!;
      ops.setEdgeRoute(d, dg, e.id, { branchAnchors: Object.fromEntries(fk.columns.filter(() => r.chance(0.7)).map((c) => [c.sourceColumnId, { source: { side: 'top' as const, offset: 0.5 } }])) });
    },
  };
}

/** Ops whose preconditions the generator violates on purpose; every other op must succeed. */
const MAY_REFUSE = new Set(['moveAttribute', 'makeAssociative']);

function runSequence(start: Project, steps: Record<string, Step>, seed: number, count: number): { project: Project; applied: Record<string, number>; refused: number } {
  const r = rng(seed);
  const names = Object.keys(steps).sort();
  let project = start;
  const applied: Record<string, number> = {};
  let refused = 0;
  for (let i = 0; i < count; i++) {
    const name = names[r.int(names.length)]!;
    try {
      project = run(project, (d) => {
        steps[name]!(d, r);
      }).project;
      applied[name] = (applied[name] ?? 0) + 1;
    } catch (e) {
      // Only typed refusals are acceptable, and only for ops whose preconditions the generator may violate on purpose.
      if (e instanceof OpError && MAY_REFUSE.has(name) && (e.code === 'cycle' || e.code === 'invalid')) {
        refused++;
        continue;
      }
      throw new Error(`step ${i} (${name}, seed ${seed}) threw unexpectedly: ${(e as Error).stack ?? e}`);
    }
    // run() already asserted this; re-check explicitly so a failure names the step
    const v = checkInvariants(project);
    if (v.length) throw new Error(`step ${i} (${name}, seed ${seed}) violated invariants: ${JSON.stringify(v.slice(0, 3))}`);
  }
  return { project, applied, refused };
}

describe('random op sequences', () => {
  for (const seed of [1, 7, 20260101]) {
    it(`300 ER ops (seed ${seed}) keep every invariant, with two Chen diagrams of the model`, () => {
      const s = sampleEr();
      const p0 = projectWith(s.model, 'chen', 'chen');
      const dgms = Object.keys(p0.diagrams);
      const steps = { ...erSteps(s.model.id), ...presentation(s.model.id, dgms) };
      const { project, applied, refused } = runSequence(p0, steps, seed, 300);
      expect(Object.keys(applied).length).toBeGreaterThan(12); // the generator really exercises many op kinds
      expect(refused).toBeLessThan(150);
      for (const d of Object.values(project.diagrams)) expect(d.nodes).toBeDefined();
      // a complete (non-partial) diagram shows every node-able element exactly once
      const model = project.models[s.model.id]!;
      for (const d of Object.values(project.diagrams)) {
        if (d.partial) continue;
        const have = Object.values(d.nodes).map((n) => refKey(n.ref)).sort();
        expect(have).toEqual(nodeableRefs(model).map(refKey).sort());
      }
    });

    it(`300 relational ops (seed ${seed}) keep every invariant, with horizontal + crow's foot diagrams`, () => {
      const s = sampleRel();
      const p0 = projectWith(s.model, 'relational-schema', 'crows-foot');
      const dgms = Object.keys(p0.diagrams);
      const steps = { ...relSteps(s.model.id, dgms), ...presentation(s.model.id, dgms) };
      const { project, applied } = runSequence(p0, steps, seed, 300);
      expect(Object.keys(applied).length).toBeGreaterThan(12);
      const model = project.models[s.model.id] as RelationalModel;
      // every FK is still ONE constraint with consistent column ownership
      for (const fk of Object.values(model.foreignKeys)) {
        for (const pair of fk.columns) {
          expect(model.relations[fk.sourceRelationId]!.columns.some((c) => c.id === pair.sourceColumnId)).toBe(true);
          expect(model.relations[fk.targetRelationId]!.columns.some((c) => c.id === pair.targetColumnId)).toBe(true);
        }
      }
    });
  }

  it('the generator is deterministic: same seed and id counter give the identical project', () => {
    const once = () => {
      restore();
      restore = useDeterministicIds(9000);
      const s = sampleRel();
      const p0 = projectWith(s.model, 'relational-schema');
      return JSON.stringify(runSequence(p0, relSteps(s.model.id, Object.keys(p0.diagrams)), 5, 80).project);
    };
    const unfreeze = useFixedClock('2026-01-01T00:00:00.000Z');
    try {
      expect(once()).toBe(once());
    } finally {
      unfreeze();
    }
  });
});
