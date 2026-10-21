import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useFixedClock } from '../clock';
import { useDeterministicIds } from '../ids';
import { parseProjectFile, serializeProject } from './index';
import { sampleProject } from './testFixtures';

let restore: Array<() => void> = [];
beforeEach(() => {
  restore = [useDeterministicIds(), useFixedClock('2026-01-01T00:00:00.000Z')];
});
afterEach(() => restore.forEach((r) => r()));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Any => JSON.parse(serializeProject(sampleProject()));
const relModel = (c: Any): Any => Object.values(c.project.models).find((m: Any) => m.kind === 'relational' || m.relations) as Any;
const load = (c: Any) => parseProjectFile(JSON.stringify(c));

describe('loader checks of fields that reach DDL text', () => {
  it('the sample project loads', () => {
    expect(load(base()).ok).toBe(true);
  });
  it('rejects a crafted onDelete / onUpdate', () => {
    for (const key of ['onDelete', 'onUpdate']) {
      for (const bad of ['CASCADE; DROP TABLE Doctor; --', 'EXPLODE', 5]) {
        const c = base();
        (Object.values(relModel(c).foreignKeys) as Any[])[0][key] = bad;
        const r = load(c);
        expect(r.ok, `${key} ${String(bad)}`).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe('invalid-structure');
          expect(JSON.stringify(r.error)).toContain(key);
        }
      }
    }
  });
  it('accepts the five actions in any case', () => {
    for (const ok of ['CASCADE', 'set null', 'No Action', 'RESTRICT', 'SET DEFAULT']) {
      const c = base();
      (Object.values(relModel(c).foreignKeys) as Any[])[0].onDelete = ok;
      expect(load(c).ok, ok).toBe(true);
    }
  });
  it('rejects an index method that is not a plain word', () => {
    for (const bad of ['btree; DROP TABLE t', 'a b', '1x', 7]) {
      const c = base();
      const r0 = (Object.values(relModel(c).relations) as Any[])[0];
      r0.indexes = [{ id: 'ixa', name: 'ix', columnIds: [r0.columns[0].id], unique: false, method: bad }];
      const r = load(c);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(JSON.stringify(r.error)).toContain('method');
    }
    const c = base();
    const r0 = (Object.values(relModel(c).relations) as Any[])[0];
    r0.indexes = [{ id: 'ixa', name: 'ix', columnIds: [r0.columns[0].id], unique: false, method: 'btree' }];
    expect(load(c).ok).toBe(true);
  });
});
