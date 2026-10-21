import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '../ids';
import { useFixedClock } from '../clock';
import { parseProjectFile, serializeProject } from './index';
import { sampleProject } from './testFixtures';

let restoreIds: () => void;
let restoreClock: () => void;
beforeEach(() => {
  restoreIds = useDeterministicIds();
  restoreClock = useFixedClock('2026-01-01T00:00:00.000Z');
});
afterEach(() => {
  restoreIds();
  restoreClock();
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Any => JSON.parse(serializeProject(sampleProject()));
const models = (c: Any, kind: string): Any[] => Object.values(c.project.models).filter((m: Any) => m.kind === kind);
const first = (o: Any): Any => Object.values(o)[0];
const load = (c: Any) => parseProjectFile(JSON.stringify(c));

/** Apply `mutate` to a fresh file and expect a typed invalid-structure error mentioning `path`. */
function rejects(mutate: (c: Any) => void, path: string): void {
  const c = base();
  mutate(c);
  const r = load(c);
  expect(r.ok, `expected rejection for ${path}`).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe('invalid-structure');
    expect(r.error.message).toContain(path);
  }
}

describe('optional fields are type-checked', () => {
  it('rejects ill-typed optional fields other modules dereference', () => {
    rejects((c) => (first(models(c, 'er')[0].relationships).keyParticipantIds = 'p1'), 'keyParticipantIds');
    rejects((c) => (first(models(c, 'er')[0].relationships).keyParticipantIds = [1]), 'keyParticipantIds');
    rejects((c) => (first(models(c, 'relational')[0].relations).schemaName = 7), 'schemaName');
    rejects((c) => (first(first(models(c, 'relational')[0].relations).columns as Any) .dataType = {}), 'dataType');
    rejects((c) => (first(models(c, 'er')[0].relationships).participants[0].entityId = 5), 'entityId');
    rejects((c) => (first(models(c, 'er')[0].relationships).participants[0].entityId = null), 'entityId');
    rejects((c) => (first(models(c, 'relational')[0].relations).columns[0].id = 3), 'id');
    rejects((c) => (first(models(c, 'relational')[0].relations).uniques = {}), 'uniques');
    rejects((c) => (first(models(c, 'relational')[0].relations).indexes = 'x'), 'indexes');
    rejects((c) => (first(models(c, 'relational')[0].relations).checks = {}), 'checks');
    rejects((c) => (first(models(c, 'relational')[0].relations).checks = [{ id: 'k', expression: 4 }]), 'expression');
    rejects((c) => (first(models(c, 'relational')[0].relations).checks = [null]), 'checks');
    rejects((c) => (first(models(c, 'relational')[0].relations).origin = { ruleId: 'r', sources: 'x' }), 'origin.sources');
    rejects((c) => (first(models(c, 'relational')[0].relations).origin = { ruleId: 'r', sources: [{ kind: 'entity' }] }), 'origin.sources[0]');
    rejects((c) => (first(models(c, 'relational')[0].relations).origin = { ruleId: 'r', sources: [null] }), 'origin.sources[0]');
    rejects((c) => (first(models(c, 'relational')[0].relations).origin = { ruleId: 'r', sources: [{ id: 'x' }] }), 'origin.sources[0]');
    rejects((c) => (first(models(c, 'relational')[0].relations).columns[0].origin = 'x'), 'origin');
    rejects((c) => (first(models(c, 'relational')[0].foreignKeys).cardinality = 3), 'cardinality');
    rejects((c) => (first(models(c, 'er')[0].entities).associativeOf = 3), 'associativeOf');
  });

  it('accepts well-typed optional fields and preserves them and unknown properties verbatim', () => {
    const c = base();
    const rel = first(models(c, 'relational')[0].relations);
    rel.schemaName = 's';
    rel.checks = [{ id: 'k', expression: 'a > 0', columnIds: [rel.columns[0].id], future: { x: 1 } }];
    rel.origin = { ruleId: 'r', sources: [{ kind: 'entity', id: 'e' }, { kind: 'column', relationId: 'r', id: 'c' }], extra: true };
    rel.columns[0].dataType = 'INT';
    first(models(c, 'er')[0].relationships).keyParticipantIds = [];
    rel.unknownProp = [1, { a: null }];
    const r = load(c);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out: Any = Object.values((r.project.models as Any)[rel_model(c)].relations)[0];
      expect(out.unknownProp).toEqual([1, { a: null }]);
      expect(out.origin.extra).toBe(true);
      expect(out.checks[0].future).toEqual({ x: 1 });
    }
  });

  it('fuzz: randomly corrupted optional fields either load or yield a typed LoadError, never throw', () => {
    let seed = 99;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const junk: Any[] = [null, 0, 1.5, 'x', true, [], {}, [1], [null], { kind: 1 }, ['a', 2]];
    const fields = ['keyParticipantIds', 'dataType', 'schemaName', 'origin', 'checks', 'uniques', 'indexes', 'columns', 'participants', 'entityId', 'sources', 'cardinality', 'primaryKey'];
    const walk = (o: Any, out: Any[]): void => {
      if (o && typeof o === 'object') {
        out.push(o);
        for (const v of Object.values(o)) walk(v, out);
      }
    };
    for (let i = 0; i < 300; i++) {
      const c = base();
      const objs: Any[] = [];
      walk(c.project.models, objs);
      for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) {
        const o = objs[Math.floor(rand() * objs.length)];
        const f = fields[Math.floor(rand() * fields.length)]!;
        o[f] = junk[Math.floor(rand() * junk.length)];
      }
      let r: Any;
      expect(() => (r = load(c))).not.toThrow();
      if (!r.ok) expect(['invalid-structure', 'wrong-format']).toContain(r.error.code);
    }
  });
});

function rel_model(c: Any): string {
  return (models(c, 'relational')[0] as Any).id;
}
