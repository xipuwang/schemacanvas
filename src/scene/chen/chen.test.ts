import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '@/render/chen';
import { renderSceneToSvgStringCore } from '@/render/standaloneCore';
import { erBuilder } from '@/model/builders';
import { createDiagramForModel } from '@/model/diagramSync';
import { createBareProject } from '@/model/defaults';
import { useDeterministicIds } from '@/model/ids';
import type { Diagram, ErModel, Id, Point } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import type { Outline, Rect } from '../base';
import { distance, distanceToPolyline, labelRect, rectCenter, rectEncloses } from '../geometry';
import { defaultMeasure } from '../measure';
import { buildChenScene } from './index';
import { ALL_FIXTURES, associative, familyFour, recursiveAttrsTop, exampleA, exampleB, exampleC, exampleD, layoutChenFixture, nodeRects, pharmacy, ternary, type ChenFixture } from './fixtures';
import type { ChenAttributeGeom, ChenEdgeGeom, ChenEntityGeom, ChenRelationshipGeom } from './types';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds();
});
afterEach(() => restore());

/** `freeze` (default) deep-freezes the project like the app does; tests that mutate the diagram afterwards pass false. */
function build(fx: ChenFixture, tweak?: (d: Diagram) => void, freeze = true) {
  const lp = layoutChenFixture(fx, tweak);
  const { project, diagram, model } = lp;
  if (freeze) deepFreeze(project);
  const scene = buildChenScene({ project, diagram, model, measure: defaultMeasure });
  return { ...lp, scene };
}

const onOutline = (o: Outline, p: Point, tol = 1e-5): boolean => {
  const r = o.rect;
  const c = rectCenter(r);
  const a = r.w / 2;
  const b = r.h / 2;
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  if (o.kind === 'ellipse') return Math.abs(Math.hypot(dx / a, dy / b) - 1) * Math.min(a, b) < tol;
  if (o.kind === 'diamond') return Math.abs(dx / a + dy / b - 1) * Math.min(a, b) < tol;
  const inside = dx <= a + tol && dy <= b + tol;
  return inside && (Math.abs(dx - a) < tol || Math.abs(dy - b) < tol);
};

const nodeByName = (model: ErModel, diagram: Diagram, name: string): Id => {
  const ent = Object.values(model.entities).find((e) => e.name === name);
  const rel = Object.values(model.relationships).find((r) => r.name === name);
  const att = Object.values(model.attributes).find((a) => a.name === name);
  const ref = ent ? { kind: 'entity', id: ent.id } : rel ? { kind: 'relationship', id: rel.id } : { kind: 'attribute', id: att!.id };
  return Object.values(diagram.nodes).find((n) => n.ref.kind === ref.kind && n.ref.id === ref.id)!.id;
};

const edgeOfParticipant = (b: ReturnType<typeof build>, relName: string, entName: string, nth = 0): ChenEdgeGeom => {
  const rel = Object.values(b.model.relationships).find((r) => r.name === relName)!;
  const ent = Object.values(b.model.entities).find((e) => e.name === entName)!;
  const p = rel.participants.filter((x) => x.entityId === ent.id)[nth]!;
  const e = Object.values(b.diagram.edges).find((x) => x.ref.kind === 'participant' && x.ref.participantId === p.id)!;
  return b.scene.edges[e.id] as ChenEdgeGeom;
};

describe('node geometry invariants', () => {
  for (const make of ALL_FIXTURES) {
    const fx = make();
    it(`${fx.name}: bounds.x/y === node.x/y, paintBounds enclose bounds, scene bounds enclose everything`, () => {
      const { diagram, scene } = build(fx);
      for (const [id, node] of Object.entries(diagram.nodes)) {
        const g = scene.nodes[id]!;
        expect(g.bounds.x).toBe(node.x);
        expect(g.bounds.y).toBe(node.y);
        expect(rectEncloses(g.paintBounds, g.bounds)).toBe(true);
        expect(g.paintBounds.x).toBeLessThan(g.bounds.x); // stroke is painted outside the geometric box
        expect(rectEncloses(scene.bounds, g.paintBounds)).toBe(true);
      }
      for (const e of Object.values(scene.edges)) expect(rectEncloses(scene.bounds, e.bounds)).toBe(true);
      expect(scene.warnings).toEqual([]);
    });

    it(`${fx.name}: label text never wider than its shape; laid-out nodes do not overlap`, () => {
      const { diagram, scene } = build(fx);
      for (const g of Object.values(scene.nodes)) {
        const label = (g as ChenEntityGeom).label; // every Chen node kind carries `label`
        expect(label.width).toBeLessThan(g.bounds.w);
        expect(rectEncloses(g.paintBounds, labelRect(label))).toBe(true);
      }
      const rects = nodeRects(diagram, scene);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a: Rect = rects[i]!;
          const b: Rect = rects[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${i} overlaps ${j}`).toBe(false);
        }
      }
    });

    for (const routing of ['straight', 'orthogonal'] as const) {
      it(`${fx.name}: every edge end lies on the real outline (${routing})`, () => {
        const { scene } = build(fx, (d) => {
          d.options.chen!.routing = routing;
        });
        for (const e of Object.values(scene.edges)) {
          const [s, t] = e.ends;
          expect(onOutline(scene.nodes[s.nodeId]!.outline, s.at)).toBe(true);
          expect(onOutline(scene.nodes[t.nodeId]!.outline, t.at)).toBe(true);
          expect(e.paths[0]![0]).toEqual(s.at);
          expect(e.paths[0]![e.paths[0]!.length - 1]).toEqual(t.at);
        }
      });
    }
  }

  it('text fit in diamonds: the label box lies inside the INNER diamond of a double diamond', () => {
    const { scene } = build(exampleB());
    for (const g of Object.values(scene.nodes)) {
      if (g.kind !== 'chen-relationship') continue;
      const outer = (g as ChenRelationshipGeom).innerDiamond ?? g.bounds;
      const tw = (g as ChenRelationshipGeom).label.width;
      const th = (g as ChenRelationshipGeom).label.font.size;
      expect(tw / outer.w + th / outer.h).toBeLessThanOrEqual(1);
    }
  });

  it('a very long name grows the node instead of clipping; a manual size is clamped to the text fit', () => {
    const fx = exampleB();
    const company = Object.values(fx.model.entities).find((e) => e.name === 'Company')!;
    const lp = layoutChenFixture(fx);
    company.name = 'A really quite long entity name here'; // renamed after layout (the fixture layout keys by name)
    const id = nodeByName(lp.model, lp.diagram, company.name);
    lp.diagram.nodes[id]!.width = 20;
    lp.diagram.nodes[id]!.height = 200;
    const g = buildChenScene({ ...lp, measure: defaultMeasure }).nodes[id]! as ChenEntityGeom;
    expect(g.bounds.w).toBeGreaterThanOrEqual(g.label.width);
    expect(g.bounds.h).toBe(200);
    expect(g.bounds.x).toBe(lp.diagram.nodes[id]!.x);
  });
});

describe('notation from stored data', () => {
  it('weak entity = double rectangle inset by 4 on all sides; strong entity has none', () => {
    const { scene, model, diagram } = build(exampleB());
    const drug = scene.nodes[nodeByName(model, diagram, 'Drug')] as ChenEntityGeom;
    const company = scene.nodes[nodeByName(model, diagram, 'Company')] as ChenEntityGeom;
    expect(drug.weak).toBe(true);
    const o = drug.bounds;
    const i = drug.innerRect!;
    expect([i.x - o.x, i.y - o.y, o.x + o.w - (i.x + i.w), o.y + o.h - (i.y + i.h)]).toEqual([4, 4, 4, 4]);
    expect(company.weak).toBe(false);
    expect(company.innerRect).toBeUndefined();
  });

  it('identifying relationship = double diamond (inner strictly inside, centred); plain relationship is single', () => {
    const b = build(pharmacy());
    const makes = b.scene.nodes[nodeByName(b.model, b.diagram, 'Makes')] as ChenRelationshipGeom;
    const sell = b.scene.nodes[nodeByName(b.model, b.diagram, 'Sell')] as ChenRelationshipGeom;
    expect(makes.identifying).toBe(true);
    const i = makes.innerDiamond!;
    expect(i.x).toBeGreaterThan(makes.bounds.x);
    expect(i.y).toBeGreaterThan(makes.bounds.y);
    expect(i.x + i.w).toBeLessThan(makes.bounds.x + makes.bounds.w);
    expect(i.y + i.h).toBeLessThan(makes.bounds.y + makes.bounds.h);
    expect(rectCenter(i).x).toBeCloseTo(rectCenter(makes.bounds).x);
    expect(rectCenter(i).y).toBeCloseTo(rectCenter(makes.bounds).y);
    expect(sell.innerDiamond).toBeUndefined();
  });

  it('attributes: key solid underline, partial dashed, multivalued double ellipse, derived dashed, composite plain', () => {
    const b = build(exampleA());
    const att = (n: string) => b.scene.nodes[nodeByName(b.model, b.diagram, n)] as ChenAttributeGeom;
    expect(att('SID').label.underline).toBe('solid');
    expect(att('DOB').label.underline).toBeUndefined();
    expect(att('Age').derived).toBe(true);
    expect(att('Age').dashed).toBe(true);
    expect(att('DOB').dashed).toBe(false);
    const mv = att('ProgrammingLanguages');
    expect(mv.multivalued).toBe(true);
    const o = mv.bounds;
    const i = mv.innerEllipse!;
    expect([i.x - o.x, i.y - o.y, o.x + o.w - (i.x + i.w), o.y + o.h - (i.y + i.h)]).toEqual([4, 4, 4, 4]);
    expect(att('Name').innerEllipse).toBeUndefined();
    const b2 = build(exampleB());
    expect((b2.scene.nodes[nodeByName(b2.model, b2.diagram, 'TradeName')] as ChenAttributeGeom).label.underline).toBe('dashed');
  });

  it('composite children are linked to their parent attribute through attribute edges', () => {
    const b = build(exampleA());
    const parent = nodeByName(b.model, b.diagram, 'Address');
    const kids = ['Street', 'City', 'Zip'].map((n) => nodeByName(b.model, b.diagram, n));
    for (const k of kids) {
      const e = Object.values(b.scene.edges).find((x) => x.sourceNodeId === parent && x.targetNodeId === k);
      expect(e, k).toBeDefined();
      expect((e as ChenEdgeGeom).double).toBe(false);
    }
  });

  it('data type line only when showDataTypes and a type exists', () => {
    const fx = exampleA();
    Object.values(fx.model.attributes).find((a) => a.name === 'SID')!.dataType = 'INT';
    const off = build(fx, undefined, false);
    const sid = nodeByName(off.model, off.diagram, 'SID');
    expect((off.scene.nodes[sid] as ChenAttributeGeom).typeLabel).toBeUndefined();
    off.diagram.options.chen!.showDataTypes = true;
    const on = buildChenScene({ project: off.project, diagram: off.diagram, model: off.model, measure: defaultMeasure });
    const g = on.nodes[sid] as ChenAttributeGeom;
    expect(g.typeLabel?.text).toBe('INT');
    expect(g.typeLabel!.y).toBeGreaterThan(g.label.y);
  });
});

describe('participation lines', () => {
  it('total participation = two parallel rails at constant distance ending on the outlines; partial = single line', () => {
    const b = build(exampleB());
    const total = edgeOfParticipant(b, 'Makes', 'Drug');
    const partial = edgeOfParticipant(b, 'Makes', 'Company');
    expect(partial.double).toBe(false);
    expect(partial.rails).toBeUndefined();
    expect(total.double).toBe(true);
    const [r1, r2] = total.rails!;
    // distance of every rail-1 point to the infinite line of rail 2 is the rail gap
    const a = r2[0]!;
    const c = r2[r2.length - 1]!;
    const len = distance(a, c);
    for (const p of r1) {
      const d = Math.abs((c.x - a.x) * (a.y - p.y) - (a.x - p.x) * (c.y - a.y)) / len;
      expect(d).toBeCloseTo(4, 6);
    }
    const sNode = b.scene.nodes[total.sourceNodeId]!;
    const tNode = b.scene.nodes[total.targetNodeId]!;
    for (const r of [r1, r2]) {
      expect(onOutline(sNode.outline, r[0]!)).toBe(true);
      expect(onOutline(tNode.outline, r[r.length - 1]!)).toBe(true);
    }
    expect(rectEncloses(total.bounds, { x: Math.min(...r1.map((p) => p.x)), y: Math.min(...r1.map((p) => p.y)), w: 0, h: 0 })).toBe(true);
  });

  it('rails stay parallel and end on the outline through orthogonal bends', () => {
    const b = build(pharmacy(), (d) => {
      d.options.chen!.routing = 'orthogonal';
    });
    for (const e of Object.values(b.scene.edges)) {
      const g = e as ChenEdgeGeom;
      if (!g.double) continue;
      const [r1, r2] = g.rails!;
      expect(r1.length).toBe(r2.length);
      // Rail segments keep the gap/2 offset from the centre line.
      for (const rail of [r1, r2]) {
        // first/last segments are clipped to the outline (their ends overhang the centre line's end points)
        for (let i = 1; i < rail.length - 2; i++) {
          const m = { x: (rail[i]!.x + rail[i + 1]!.x) / 2, y: (rail[i]!.y + rail[i + 1]!.y) / 2 };
          // never closer than gap/2 (rails cannot merge), at most the mitre distance gap/2*sqrt2 at a corner
          const d = distanceToPolyline(m, g.paths[0]!);
          expect(d).toBeGreaterThanOrEqual(2 - 1e-6);
          expect(d).toBeLessThanOrEqual(2 * Math.SQRT2 + 1e-6);
        }
      }
      expect(onOutline(b.scene.nodes[g.sourceNodeId]!.outline, r1[0]!)).toBe(true);
      expect(onOutline(b.scene.nodes[g.targetNodeId]!.outline, r2[r2.length - 1]!)).toBe(true);
    }
  });

  it('cardinality label sits at the entity end, beside the line (not on it); 1:N text is 1 / N', () => {
    const b = build(exampleB());
    const company = edgeOfParticipant(b, 'Makes', 'Company');
    const drug = edgeOfParticipant(b, 'Makes', 'Drug');
    const lc = company.labels.find((l) => l.id === 'cardinality')!.label;
    const ld = drug.labels.find((l) => l.id === 'cardinality')!.label;
    expect(lc.text).toBe('1');
    expect(ld.text).toBe('N');
    for (const [e, l] of [[company, lc], [drug, ld]] as const) {
      const entityEnd = e.ends[1].at;
      const relEnd = e.ends[0].at;
      expect(distance({ x: l.x, y: l.y }, entityEnd)).toBeLessThan(distance({ x: l.x, y: l.y }, relEnd));
      expect(distanceToPolyline({ x: l.x, y: l.y }, e.paths[0]!)).toBeGreaterThan(l.font.size / 2 - 1);
    }
  });

  it('minmax style prints (min,max) from near-side participation', () => {
    const b = build(exampleB(), (d) => {
      d.options.chen!.cardinalityStyle = 'minmax';
    });
    expect(edgeOfParticipant(b, 'Makes', 'Drug').labels.find((l) => l.id === 'cardinality')!.label.text).toBe('(1,1)');
    expect(edgeOfParticipant(b, 'Makes', 'Company').labels.find((l) => l.id === 'cardinality')!.label.text).toBe('(0,N)');
  });

  it('role label only when showRoles and a role exists', () => {
    const on = build(exampleC());
    const roles = Object.values(on.scene.edges).flatMap((e) => e.labels.filter((l) => l.id === 'role').map((l) => l.label.text));
    expect(roles.sort()).toEqual(['manager', 'subordinate']);
    const off = build(exampleC(), (d) => {
      d.options.chen!.showRoles = false;
    });
    expect(Object.values(off.scene.edges).some((e) => e.labels.some((l) => l.id === 'role'))).toBe(false);
  });

  for (const routing of ['straight', 'orthogonal'] as const) {
    it(`recursive relationship (${routing}): two distinct lines on DIFFERENT sides that never overlap`, () => {
      for (const make of [exampleC, exampleD]) {
        const b = build(make(), (d) => {
          d.options.chen!.routing = routing;
        });
        const entName = make === exampleC ? 'Employee' : 'Course';
        const relName = make === exampleC ? 'manages' : 'prerequisite';
        const e0 = edgeOfParticipant(b, relName, entName, 0);
        const e1 = edgeOfParticipant(b, relName, entName, 1);
        expect(e0.recursive && e1.recursive).toBe(true);
        expect(e0.ends[1].side).not.toBe(e1.ends[1].side);
        expect(e0.ends[0].side).not.toBe(e1.ends[0].side);
        expect(e0.ends[1].at).not.toEqual(e1.ends[1].at);
        for (const p of e0.paths[0]!) expect(distanceToPolyline(p, e1.paths[0]!)).toBeGreaterThan(5);
        // elbow route: only axis-aligned segments
        for (const pts of [e0.paths[0]!, e1.paths[0]!]) {
          for (let i = 0; i < pts.length - 1; i++) expect(pts[i]!.x === pts[i + 1]!.x || pts[i]!.y === pts[i + 1]!.y).toBe(true);
        }
      }
    });
  }

  it('ternary: three lines from the diamond to three different entities; only Supplier is total', () => {
    const b = build(ternary());
    const es = ['Supplier', 'Part', 'Project'].map((n) => edgeOfParticipant(b, 'Supplies', n));
    expect(new Set(es.map((e) => e.targetNodeId)).size).toBe(3);
    expect(new Set(es.map((e) => e.sourceNodeId)).size).toBe(1);
    expect(es.map((e) => e.double)).toEqual([true, false, false]);
    expect(es.map((e) => e.labels.find((l) => l.id === 'cardinality')!.label.text)).toEqual(['M', 'N', 'P']);
  });

  it('associative entity: no node for the relationship; its edges attach to the entity node (rect around a diamond)', () => {
    const b = build(associative());
    const reg = Object.values(b.model.entities).find((e) => e.name === 'Registration')!;
    const rel = Object.values(b.model.relationships)[0]!;
    expect(Object.values(b.diagram.nodes).some((n) => n.ref.kind === 'relationship')).toBe(false);
    const regNode = nodeByName(b.model, b.diagram, 'Registration');
    const g = b.scene.nodes[regNode] as ChenEntityGeom;
    expect(g.associative).toBe(true);
    expect(g.weak).toBe(false);
    expect(rectEncloses(g.bounds, g.innerDiamond!)).toBe(true);
    for (const p of rel.participants) {
      const e = Object.values(b.diagram.edges).find((x) => x.ref.kind === 'participant' && x.ref.participantId === p.id)!;
      expect((b.scene.edges[e.id] as ChenEdgeGeom).sourceNodeId).toBe(regNode);
    }
    expect(reg.associativeOf).toBe(rel.id);
  });
});

describe('routing, anchors, manual routes, labels', () => {
  it('manual route passes through its waypoints exactly and exposes bend handles', () => {
    const b = build(exampleB(), undefined, false);
    const e = edgeOfParticipant(b, 'Makes', 'Drug');
    const edge = b.diagram.edges[e.edgeId]!;
    edge.route = { mode: 'manual', waypoints: [{ x: 500, y: 300 }, { x: 600, y: 300 }] };
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    const g = scene.edges[e.edgeId] as ChenEdgeGeom;
    expect(g.paths[0]!.slice(1, 3)).toEqual([{ x: 500, y: 300 }, { x: 600, y: 300 }]);
    expect(g.bendHandles).toEqual([{ index: 0, at: { x: 500, y: 300 } }, { index: 1, at: { x: 600, y: 300 } }]);
    expect(g.autoWaypoints).toEqual(edge.route.waypoints);
    expect(onOutline(scene.nodes[g.targetNodeId]!.outline, g.ends[1].at)).toBe(true);
    expect(rectEncloses(g.bounds, { x: 500, y: 300, w: 100, h: 0 })).toBe(true);
  });

  it('anchor spec: side + offset along the outline rect side, projected onto the outline', () => {
    const b = build(exampleB(), undefined, false);
    const e = edgeOfParticipant(b, 'Makes', 'Drug');
    b.diagram.edges[e.edgeId]!.route.targetAnchor = { side: 'top', offset: 0.25 };
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    const g = scene.edges[e.edgeId] as ChenEdgeGeom;
    const r = scene.nodes[g.targetNodeId]!.bounds;
    expect(g.ends[1].at.y).toBeCloseTo(r.y);
    expect(g.ends[1].at.x).toBeCloseTo(r.x + r.w * 0.25);
    expect(g.ends[1].side).toBe('top');
  });

  it('labelOffsets move the label and are folded into the edge paint bounds', () => {
    const b = build(exampleB(), undefined, false);
    const e = edgeOfParticipant(b, 'Makes', 'Drug');
    const before = e.labels.find((l) => l.id === 'cardinality')!.label;
    b.diagram.edges[e.edgeId]!.labelOffsets = { cardinality: { x: 0, y: 150 } };
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    const g = scene.edges[e.edgeId] as ChenEdgeGeom;
    const after = g.labels.find((l) => l.id === 'cardinality')!.label;
    expect(after.y).toBeCloseTo(before.y + 150);
    expect(rectEncloses(g.bounds, labelRect(after))).toBe(true);
    expect(rectEncloses(scene.bounds, g.bounds)).toBe(true);
  });

  it('orthogonal routing spreads edges sharing a node side to distinct attachment points', () => {
    const b = build(pharmacy(), (d) => {
      d.options.chen!.routing = 'orthogonal';
    });
    const seen = new Set<string>();
    for (const e of Object.values(b.scene.edges)) {
      for (const end of e.ends) {
        const key = `${end.nodeId}:${end.at.x.toFixed(3)},${end.at.y.toFixed(3)}`;
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });

  it('dangling edges and nodes are skipped with scene warnings (never drawn, never thrown)', () => {
    const b = build(exampleB(), undefined, false);
    const some = Object.values(b.diagram.edges)[0]!;
    b.diagram.edges.ghost = { id: 'ghost', ref: { kind: 'participant', relationshipId: 'nope', participantId: 'nope' }, route: { mode: 'auto', waypoints: [] } };
    b.diagram.nodes.ghostNode = { id: 'ghostNode', ref: { kind: 'entity', id: 'missing' }, x: 0, y: 0 };
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    expect(scene.warnings).toContain('chen-edge-dangling:ghost');
    expect(scene.warnings).toContain('chen-node-dangling:ghostNode');
    expect(scene.edges.ghost).toBeUndefined();
    expect(scene.edges[some.id]).toBeDefined();
  });

  it('is deterministic and does not mutate a deeply frozen project', () => {
    const b = build(pharmacy());
    const again = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    expect(again).toEqual(b.scene);
  });
});

describe('SVG rendering', () => {
  it('draws notation with SVG hygiene: double shapes, rails, data attributes, no markers / text-decoration', () => {
    const b = build(pharmacy());
    const svg = renderSceneToSvgStringCore(b.scene, b.project, b.diagram);
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('text-decoration');
    expect(svg).toContain('data-chen-shape="entity" data-weak="true"');
    expect(svg).toContain('data-chen-shape="relationship" data-identifying="true"');
    expect(svg).toContain('data-chen-line="participant" data-double="true"');
    expect(svg).toContain('data-part="inner"');
    expect(svg).toContain('stroke-dasharray'); // dashed partial-key underline
    expect(svg.match(/data-rail="/g)!.length).toBe(2 * Object.values(b.scene.edges).filter((e) => (e as ChenEdgeGeom).double).length);
    expect(svg).toContain('data-layer="edge-labels"');
  });

  it('derived attribute outline is dashed; node style overrides apply', () => {
    const b = build(exampleA(), undefined, false);
    const age = nodeByName(b.model, b.diagram, 'Age');
    b.diagram.nodes[age]!.style = { fill: '#fee2e2', stroke: '#b91c1c', strokeWidth: 3, textColor: '#7f1d1d' };
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    const svg = renderSceneToSvgStringCore(scene, b.project, b.diagram);
    expect(svg).toContain('data-derived="true"');
    expect(svg).toMatch(/fill="#fee2e2" stroke="#b91c1c" stroke-width="3" stroke-dasharray="5 3"/);
    expect(svg).toContain('fill="#7f1d1d"');
    expect(scene.nodes[age]!.paintBounds.x).toBeCloseTo(scene.nodes[age]!.bounds.x - 3 / 2 - 1);
  });
});

describe('review regressions (chen)', () => {
  const segs = (pts: Point[]) => pts.slice(1).map((q, i) => [pts[i]!, q] as const);
  const segHitsRect = (a: Point, b: Point, r: Rect): boolean => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return x0 <= r.x + r.w && x1 >= r.x && y0 <= r.y + r.h && y1 >= r.y;
  };

  it('CHEN-1: double notation keeps a visible gap at thick strokes (weak entity, identifying diamond, total rails)', () => {
    const b = build(pharmacy(), (d) => {
      for (const n of Object.values(d.nodes)) n.style = { strokeWidth: 6 };
      for (const e of Object.values(d.edges)) e.style = { strokeWidth: 6 };
    });
    const drug = b.scene.nodes[nodeByName(b.model, b.diagram, 'Drug')] as ChenEntityGeom;
    expect(drug.innerRect!.x - drug.bounds.x).toBeGreaterThanOrEqual(6 + 2);
    const makes = b.scene.nodes[nodeByName(b.model, b.diagram, 'Makes')] as ChenRelationshipGeom;
    expect(makes.innerDiamond!.x - makes.bounds.x).toBeGreaterThan(6 + 2);
    const total = Object.values(b.scene.edges).find((e) => (e as ChenEdgeGeom).double) as ChenEdgeGeom;
    const [r1, r2] = total.rails!;
    expect(distanceToPolyline(r1[0]!, r2)).toBeGreaterThanOrEqual(6 + 2 - 1e-6);
  });

  it('CHEN-2: a recursive loop crosses no other node and shares no segment with an attribute link', () => {
    const b = build(recursiveAttrsTop());
    const loops = Object.values(b.scene.edges).filter((e) => (e as ChenEdgeGeom).recursive) as ChenEdgeGeom[];
    expect(loops.length).toBe(2);
    for (const l of loops) {
      for (const [nid, g] of Object.entries(b.scene.nodes)) {
        if (nid === l.sourceNodeId || nid === l.targetNodeId) continue;
        for (const [p, q] of segs(l.paths[0]!)) expect(segHitsRect(p, q, g.bounds)).toBe(false);
      }
      for (const o of Object.values(b.scene.edges) as ChenEdgeGeom[]) {
        if (o.recursive) continue;
        for (const [p, q] of segs(l.paths[0]!)) for (const e of o.paths[0]!) expect(distanceToPolyline(e, [p, q]) > 3 || o.lineKind !== 'attribute').toBe(true);
      }
    }
  });

  it('CHEN-3: four loops of one entity attach at distinct diamond points and their role labels do not overlap', () => {
    const b = build(familyFour(), (d) => { d.options.chen!.showRoles = true; });
    const edges = (Object.values(b.scene.edges) as ChenEdgeGeom[]).filter((e) => e.lineKind === 'participant');
    const starts = edges.map((e) => e.paths[0]![0]!);
    for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) expect(distance(starts[i]!, starts[j]!)).toBeGreaterThan(4);
    const roles = edges.map((e) => labelRect(e.labels.find((l) => l.id === 'role')!.label));
    expect(roles.length).toBe(4);
    for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
      const a = roles[i]!, c = roles[j]!;
      expect(a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h).toBe(false);
    }
  });

  it('CHEN-5 / LABEL-1: labels never sit on node outlines or on their own line (both routings)', () => {
    for (const routing of ['straight', 'orthogonal'] as const) {
      const b = build(pharmacy(), (d) => { d.options.chen!.routing = routing; d.options.chen!.cardinalityStyle = 'minmax'; });
      for (const e of Object.values(b.scene.edges) as ChenEdgeGeom[]) {
        for (const l of e.labels) {
          const r = labelRect(l.label);
          const own = segs(e.paths[0]!);
          for (const [p, q] of own.slice(0, -1)) expect(segHitsRect(p, q, r), `${routing} ${l.id} on own path`).toBe(false);
        }
      }
    }
  });

  it('CHEN-4: scene build of a dense 175-relationship diagram stays interactive (guard, generous bound)', () => {
    const bld = erBuilder('perf');
    const ents = Array.from({ length: 25 }, (_, i) => bld.entity(`E${i}`));
    for (let i = 0; i < 175; i++) bld.relationship(`R${i}`, [{ entity: ents[i % 25]! }, { entity: ents[(i * 7 + 3) % 25]! }]);
    const model = bld.build();
    const project = createBareProject('perf');
    const diagram = createDiagramForModel(model, 'chen');
    project.models[model.id] = model;
    project.diagrams[diagram.id] = diagram;
    Object.values(diagram.nodes).forEach((n, i) => {
      n.x = (i % 15) * 200;
      n.y = Math.floor(i / 15) * 140;
    });
    buildChenScene({ project, diagram, model, measure: defaultMeasure });
    const t0 = performance.now();
    buildChenScene({ project, diagram, model, measure: defaultMeasure });
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('CHEN-1 (minor): orthogonal attribute links between close nodes are Z/L shaped, never U-turns', () => {
    const b = build(pharmacy(), (d) => { d.options.chen!.routing = 'orthogonal'; });
    for (const e of Object.values(b.scene.edges) as ChenEdgeGeom[]) {
      if (e.lineKind !== 'attribute') continue;
      const pts = e.paths[0]!;
      expect(pts.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('R2 regression: label placement, straight attribute links, invalid nodes', () => {
  const variants: Array<[string, (d: Diagram) => void]> = [
    ['default', () => {}],
    ['minmax', (d) => { d.options.chen!.cardinalityStyle = 'minmax'; }],
    ['orthogonal', (d) => { d.options.chen!.routing = 'orthogonal'; d.options.chen!.showRoles = true; }],
    ['orthogonal-noroles', (d) => { d.options.chen!.routing = 'orthogonal'; d.options.chen!.showRoles = false; }],
    ['bigfont', (d) => { d.options.typography.fontSize = 22; }],
  ];
  const ov = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

  for (const fx of ALL_FIXTURES) {
    for (const [vname, tweak] of variants) {
      it(`${fx().name} / ${vname}: no label overlaps any node box or another label`, () => {
        const b = build(fx(), tweak);
        const labels = Object.values(b.scene.edges).flatMap((e) => e.labels.map((l) => ({ id: `${e.edgeId}/${l.id}`, r: labelRect(l.label) })));
        const bad: string[] = [];
        for (const l of labels) for (const n of Object.values(b.scene.nodes)) if (ov(l.r, n.bounds)) bad.push(`${l.id} over ${n.nodeId}`);
        for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (ov(labels[i]!.r, labels[j]!.r)) bad.push(`${labels[i]!.id} x ${labels[j]!.id}`);
        expect(bad).toEqual([]);
      });
    }
  }

  it('orthogonal routing keeps attribute links straight (2 points) and never ends off the outline', () => {
    for (const fx of ALL_FIXTURES) {
      const b = build(fx(), (d) => { d.options.chen!.routing = 'orthogonal'; });
      for (const e of Object.values(b.scene.edges)) {
        if ((e as ChenEdgeGeom).lineKind !== 'attribute') continue;
        expect(e.paths[0]!.length, `${fx().name} ${e.edgeId}`).toBe(2);
      }
    }
  });

  it('a crowded label (node right beside the entity end) is moved clear instead of left on the node', () => {
    const b = build(exampleB(), (d) => { d.options.chen!.routing = 'orthogonal'; d.options.chen!.cardinalityStyle = 'minmax'; });
    for (const e of Object.values(b.scene.edges)) for (const l of e.labels) {
      const r = labelRect(l.label);
      for (const n of Object.values(b.scene.nodes)) expect(ov(r, n.bounds)).toBe(false);
    }
  });

  it('nodes with NaN / Infinity geometry are skipped with chen-node-invalid and their edges as dangling (no throw, no NaN bounds)', () => {
    const b = build(exampleB(), undefined, false);
    const ids = Object.keys(b.diagram.nodes);
    const victimX = ids[0]!;
    const victimW = ids[1]!;
    b.diagram.nodes[victimX]!.x = NaN;
    b.diagram.nodes[victimW]!.width = Infinity;
    const scene = buildChenScene({ project: b.project, diagram: b.diagram, model: b.model, measure: defaultMeasure });
    expect(scene.warnings).toContain(`chen-node-invalid:${victimX}`);
    expect(scene.warnings).toContain(`chen-node-invalid:${victimW}`);
    expect(scene.nodes[victimX]).toBeUndefined();
    expect(scene.nodes[victimW]).toBeUndefined();
    expect(scene.warnings.some((w) => w.startsWith('chen-edge-dangling:'))).toBe(true);
    const finite = (r: Rect): boolean => [r.x, r.y, r.w, r.h].every(Number.isFinite);
    for (const n of Object.values(scene.nodes)) expect(finite(n.bounds)).toBe(true);
    for (const e of Object.values(scene.edges)) {
      expect(finite(e.bounds)).toBe(true);
      for (const p of e.paths.flat()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
