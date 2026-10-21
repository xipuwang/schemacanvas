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
const diagramOf = (c: Any, type: string): Any => Object.values(c.project.diagrams).find((d: Any) => d.type === type);
const load = (c: Any) => parseProjectFile(JSON.stringify(c));

describe('loader hardening (STORE-1..5)', () => {
  it('STORE-1: prototype-named ids in edge refs yield a LoadError, never a throw', () => {
    const c = base();
    const e: Any = Object.values(diagramOf(c, 'chen').edges).find((x: Any) => x.ref.kind === 'attribute');
    e.ref.attributeId = 'constructor';
    expect(() => load(c)).not.toThrow();
    const c2 = base();
    const p: Any = Object.values(diagramOf(c2, 'chen').edges).find((x: Any) => x.ref.kind === 'participant');
    p.ref.relationshipId = 'constructor';
    expect(() => load(c2)).not.toThrow();
  });

  it('STORE-1: edge refs missing their id fields are structurally invalid', () => {
    const c = base();
    const e: Any = Object.values(diagramOf(c, 'chen').edges).find((x: Any) => x.ref.kind === 'attribute');
    delete e.ref.attributeId;
    const r = load(c);
    expect(r.ok).toBe(false);
  });

  it('STORE-2: wrong-typed option values are replaced by defaults', () => {
    for (const bad of ['NaN', {}, null, [] as unknown]) {
      const c = base();
      const d = diagramOf(c, 'relational-schema');
      d.options.relational.rowHeight = bad;
      const r = load(c);
      expect(r.ok).toBe(true);
      if (r.ok) {
        const h = (Object.values(r.project.diagrams).find((x) => x.type === 'relational-schema') as Any).options.relational.rowHeight;
        expect(typeof h).toBe('number');
        expect(Number.isFinite(h)).toBe(true);
        expect(r.repairs.join('\n')).toContain('relational.rowHeight');
      }
    }
  });

  it('STORE-4: prototype-named diagramOrder entries and modelId are not accepted', () => {
    const c = base();
    c.project.diagramOrder = ['constructor', ...c.project.diagramOrder];
    const r = load(c);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.project.diagramOrder).not.toContain('constructor');
    const c2 = base();
    diagramOf(c2, 'chen').modelId = 'toString';
    expect(load(c2).ok).toBe(false);
  });

  it('STORE-5: absurdly deep unknown properties are rejected, not accepted', () => {
    const text = serializeProject(sampleProject()).replace('"project": {', `"project": { "deepX": ${'['.repeat(5000)}${']'.repeat(5000)},`);
    const r = parseProjectFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-structure');
  });
});
