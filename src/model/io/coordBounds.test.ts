import { describe, expect, it } from 'vitest';
import { parseProjectFile, serializeProject } from './index';
import { sampleProject } from './testFixtures';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const base = (): Any => JSON.parse(serializeProject(sampleProject()));
const firstNode = (c: Any): Any => Object.values(Object.values(c.project.diagrams)[0] as Any).length && Object.values((Object.values(c.project.diagrams)[0] as Any).nodes)[0];

describe('PRIV-4 absurd coordinates', () => {
  it('rejects a node at 1e308 with invalid-structure naming the field', () => {
    const c = base();
    firstNode(c).x = 1e308;
    const r = parseProjectFile(JSON.stringify(c));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('invalid-structure');
      expect(r.error.path).toMatch(/\.x$/);
    }
  });
  it('rejects 1e999 (Infinity after JSON.parse) and a non-finite viewport offset', () => {
    const c = base();
    const text = JSON.stringify(c).replace(/"x":(-?[\d.]+)/, '"x":1e999');
    expect(parseProjectFile(text).ok).toBe(false);
    const c2 = base();
    (Object.values(c2.project.diagrams)[0] as Any).viewport = { x: 0, y: '-1e999', zoom: 1 };
    expect(parseProjectFile(JSON.stringify(c2).replace('"-1e999"', '-1e999')).ok).toBe(false);
  });
  it('still accepts ordinary and large-but-sane coordinates', () => {
    const c = base();
    firstNode(c).x = -9_000_000;
    expect(parseProjectFile(JSON.stringify(c)).ok).toBe(true);
  });
  it('round-trips a zoom-4 viewport whose screen offset exceeds the node bound (nodes near 3e6)', () => {
    const c = base();
    const d = Object.values(c.project.diagrams)[0] as Any;
    firstNode(c).x = 3_000_000;
    firstNode(c).y = -3_000_000;
    d.viewport = { x: -12_000_000, y: 12_000_000, zoom: 4 };
    const r = parseProjectFile(JSON.stringify(c));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const out = Object.values(r.project.diagrams)[0] as Any;
      expect(out.viewport).toEqual({ x: -12_000_000, y: 12_000_000, zoom: 4 });
      const again = parseProjectFile(serializeProject(r.project));
      expect(again.ok).toBe(true);
    }
  });
});
