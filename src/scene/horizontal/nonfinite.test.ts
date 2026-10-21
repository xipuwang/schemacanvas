import { afterEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '@/model/ids';
import type { DiagramNode } from '@/model/types';
import { defaultMeasure } from '../measure';
import { buildHorizontalScene } from './index';
import { nodeIdOf, pharmacyFixture, type Fixture } from './fixtures';

let restore = () => {};
afterEach(() => restore());

const BAD = [NaN, Infinity, -Infinity, 1e308, -1e308];

const build = (f: Fixture) => buildHorizontalScene({ project: f.project, diagram: f.diagram, model: f.model, measure: defaultMeasure });

/** Every number reachable in the scene must be finite and of sane magnitude. */
function assertSane(value: unknown, path = 'scene'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} = ${value}`).toBe(true);
    expect(Math.abs(value), `${path} = ${value}`).toBeLessThan(1e9);
  } else if (Array.isArray(value)) value.forEach((v, i) => assertSane(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) assertSane(v, `${path}.${k}`);
}

const nodeOf = (f: Fixture, name: string): DiagramNode => f.diagram.nodes[nodeIdOf(f.diagram, f.rel[name]!.id)]!;

describe('non-finite safety of the horizontal scene builder', () => {
  it('a node with non-finite x or y is skipped with h-node-invalid and its FK edges are reported dangling', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (const axis of ['x', 'y'] as const) {
        restore = useDeterministicIds();
        const f = pharmacyFixture();
        const node = nodeOf(f, 'Doctor');
        node[axis] = bad;
        const scene = build(f);
        expect(scene.nodes[node.id]).toBeUndefined();
        expect(scene.warnings).toContain(`h-node-invalid:${node.id}`);
        expect(scene.warnings.some((w) => w.startsWith('dangling-fk-edge:'))).toBe(true);
        assertSane(scene);
        restore();
      }
    }
  });

  it.each(BAD)('node width/height/columnWidths/style = %s never throws or emits bad geometry', (bad) => {
    restore = useDeterministicIds();
    const f = pharmacyFixture();
    for (const name of Object.keys(f.rel)) {
      const node = nodeOf(f, name);
      node.width = bad;
      node.height = bad;
      node.style = { strokeWidth: bad, fontSize: bad };
      node.columnWidths = Object.fromEntries(f.model.relations[f.rel[name]!.id]!.columns.map((c) => [c.id, bad]));
    }
    assertSane(build(f));
  });

  it.each(BAD)('x/y huge or non-finite on EVERY node (%s) never emits bad geometry', (bad) => {
    restore = useDeterministicIds();
    const f = pharmacyFixture();
    for (const name of Object.keys(f.rel)) nodeOf(f, name).x = bad;
    assertSane(build(f));
  });

  it.each(BAD)('anchor offsets, waypoints and label offsets = %s never emit bad geometry', (bad) => {
    restore = useDeterministicIds();
    const f = pharmacyFixture();
    f.diagram.options.relational!.fkLabels = true;
    for (const e of Object.values(f.diagram.edges)) {
      e.route = {
        mode: 'manual',
        waypoints: [{ x: bad, y: 100 }, { x: 200, y: bad }, { x: 300, y: 300 }],
        sourceAnchor: { side: 'bottom', offset: bad },
        targetAnchor: { side: 'top', offset: bad },
        branchAnchors: Object.fromEntries(
          f.model.foreignKeys[(e.ref as { foreignKeyId: string }).foreignKeyId]!.columns.map((p) => [p.sourceColumnId, { source: { side: 'bottom' as const, offset: bad }, target: { side: 'top' as const, offset: bad } }]),
        ),
      };
      e.labelOffsets = { main: { x: bad, y: bad } };
      e.style = { strokeWidth: bad };
    }
    assertSane(build(f));
  });

  it('fuzz: random mixes of bad numbers in every numeric field', () => {
    restore = useDeterministicIds();
    let seed = 7;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = (good: number) => (rnd() < 0.35 ? BAD[Math.floor(rnd() * BAD.length)]! : good);
    for (let round = 0; round < 40; round++) {
      const f = pharmacyFixture();
      for (const name of Object.keys(f.rel)) {
        const n = nodeOf(f, name);
        n.x = pick(n.x);
        n.y = pick(n.y);
        if (rnd() < 0.5) n.width = pick(300);
        if (rnd() < 0.5) n.height = pick(40);
        if (rnd() < 0.5) n.columnWidths = Object.fromEntries(f.model.relations[f.rel[name]!.id]!.columns.map((c) => [c.id, pick(90)]));
      }
      for (const e of Object.values(f.diagram.edges)) {
        if (rnd() < 0.5) e.route = { mode: 'manual', waypoints: [{ x: pick(100), y: pick(100) }, { x: pick(250), y: pick(250) }], sourceAnchor: { side: 'bottom', offset: pick(0.5) } };
        if (rnd() < 0.5) e.labelOffsets = { main: { x: pick(5), y: pick(5) } };
      }
      const scene = build(f);
      assertSane(scene);
    }
  });

  it('well-formed input produces no h-node-invalid warning', () => {
    restore = useDeterministicIds();
    expect(build(pharmacyFixture()).warnings.filter((w) => w.startsWith('h-node-invalid'))).toEqual([]);
  });
});
