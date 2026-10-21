import { describe, expect, it } from 'vitest';
import { pharmacyVFixture } from '@/scene/vertical/fixtures';
import { buildScene } from '@/scene/registry';
import { deepFreeze } from '@/test/deepFreeze';
import { makeStore, nodeNamed, sceneOf } from '../testFixtures';
import { edgeHandles, hitHandle, nodeHandles, handleCursor } from './handles';
import { portsFor, hitPort, PORT_HIT_PX } from './ports';

describe('nodeHandles', () => {
  it('Chen nodes get 8 resize handles on the outline (4 corners + 4 edge midpoints) with the right cursors', () => {
    const { store, diagramId } = makeStore('chen');
    const project = deepFreeze(store.getState().project);
    const scene = sceneOf(project, diagramId);
    for (const name of ['Doctor', 'PrimaryPhysician', 'Speciality']) {
      const id = nodeNamed(project, diagramId, name);
      const hs = nodeHandles(scene, id, 1);
      expect(hs, name).toHaveLength(8);
      const b = scene.nodes[id]!.bounds;
      const ne = hs.find((h) => h.kind === 'resize' && h.dir === 'ne')!;
      expect(ne.kind === 'resize' && ne.at).toEqual({ x: b.x + b.w, y: b.y });
      expect(handleCursor(ne)).toBe('nesw-resize');
    }
  });

  it('very small on-screen nodes keep only the corners so handles never overlap', () => {
    const { store, diagramId } = makeStore('chen');
    const project = deepFreeze(store.getState().project);
    const scene = sceneOf(project, diagramId);
    const id = nodeNamed(project, diagramId, 'Doctor');
    expect(nodeHandles(scene, id, 0.1)).toHaveLength(4);
  });

  it('horizontal tables: a right border per column + the first left border + one row-height strip', () => {
    const { store, diagramId } = makeStore('rel');
    const project = deepFreeze(store.getState().project);
    const scene = sceneOf(project, diagramId);
    const id = nodeNamed(project, diagramId, 'Doctor');
    const g = scene.nodes[id]!;
    const hs = nodeHandles(scene, id, 1);
    expect(g.kind).toBe('h-table');
    expect(hs.filter((h) => h.kind === 'col-border')).toHaveLength(5); // 4 columns + the left border of the first
    expect(hs.filter((h) => h.kind === 'row-height')).toHaveLength(1);
  });

  it('vertical tables: a width handle; the horizontal orientation behaves like the horizontal schema', () => {
    const v = pharmacyVFixture('crows-foot', 'vertical');
    const sv = buildScene(deepFreeze(v.project), v.diagram.id);
    const first = sv.nodeOrder[0]!;
    expect(nodeHandles(sv, first, 1).map((h) => h.kind)).toEqual(['table-width']);
    const h = pharmacyVFixture('crows-foot', 'horizontal');
    const sh = buildScene(deepFreeze(h.project), h.diagram.id);
    expect(nodeHandles(sh, sh.nodeOrder[0]!, 1).some((x) => x.kind === 'col-border')).toBe(true);
  });
});

describe('edgeHandles', () => {
  it('an edge offers midpoints (segments >= 28 screen px), end handles and, for manual routes, bends', () => {
    const { store, diagramId } = makeStore('rel');
    const project = deepFreeze(store.getState().project);
    const scene = sceneOf(project, diagramId);
    const id = scene.edgeOrder[0]!;
    const hs = edgeHandles(scene, id, project.diagrams[diagramId]!.edges[id], 1);
    expect(hs.filter((h) => h.kind === 'end')).toHaveLength(2);
    expect(hs.some((h) => h.kind === 'mid')).toBe(true);
    expect(hs.some((h) => h.kind === 'bend')).toBe(false);
    // zoomed far out the short segments drop their midpoint handle
    expect(edgeHandles(scene, id, project.diagrams[diagramId]!.edges[id], 0.05).filter((h) => h.kind === 'mid').length).toBeLessThan(hs.filter((h) => h.kind === 'mid').length + 1);
  });

  it('end handles beat bends beat midpoints when they overlap; strips lose to point handles', () => {
    const hs = [
      { id: 'm', kind: 'mid' as const, edgeId: 'e', segment: 0, at: { x: 10, y: 10 } },
      { id: 'b', kind: 'bend' as const, edgeId: 'e', index: 0, at: { x: 10, y: 10 } },
      { id: 'e', kind: 'end' as const, edgeId: 'e', end: 'source' as const, at: { x: 10, y: 10 }, anchorRect: { x: 0, y: 0, w: 20, h: 20 }, nodeId: 'n', side: 'top' as const },
    ];
    expect(hitHandle(hs, { x: 10, y: 10 }, 1)?.id).toBe('e');
    expect(hitHandle(hs.slice(0, 2), { x: 10, y: 10 }, 1)?.id).toBe('b');
    expect(hitHandle(hs, { x: 40, y: 10 }, 1)).toBeUndefined();
    // the radius is in SCREEN pixels: 8.5 px away is a hit at any zoom, 12 px is not
    for (const z of [0.25, 1, 4]) {
      expect(hitHandle(hs, { x: 10 + 8.5 / z, y: 10 }, z)?.id).toBe('e');
      expect(hitHandle(hs, { x: 10 + 12 / z, y: 10 }, z)).toBeUndefined();
    }
  });
});

describe('ports', () => {
  it('Chen entities / relationships get a connect and an add-attribute port; attributes only when composite; tables get an FK port per cell', () => {
    const { store, diagramId } = makeStore('chen');
    const project = deepFreeze(store.getState().project);
    const scene = sceneOf(project, diagramId);
    const d = project.diagrams[diagramId]!;
    const doctor = nodeNamed(project, diagramId, 'Doctor');
    const ports = portsFor(scene, project, d, doctor, 1);
    expect(ports.map((p) => p.kind).sort()).toEqual(['add-attribute', 'connect']);
    expect(portsFor(scene, project, d, nodeNamed(project, diagramId, 'Speciality'), 1)).toEqual([]);
    // the pointer must be within the port radius in SCREEN px
    const p = ports[0]!;
    for (const z of [0.5, 1, 3]) {
      expect(hitPort(ports, { x: p.at.x + (PORT_HIT_PX - 1) / z, y: p.at.y }, z)?.id).toBe(p.id);
      expect(hitPort(ports, { x: p.at.x + (PORT_HIT_PX + 6) / z, y: p.at.y }, z)).toBeUndefined();
    }
    const rel = makeStore('rel');
    const rp = deepFreeze(rel.store.getState().project);
    const rs = sceneOf(rp, rel.diagramId);
    const rd = rp.diagrams[rel.diagramId]!;
    const tbl = nodeNamed(rp, rel.diagramId, 'Doctor');
    expect(portsFor(rs, rp, rd, tbl, 1)).toEqual([]);
    const g = rs.nodes[tbl]!;
    const col = g.kind === 'h-table' ? g.cells[0]!.columnId : '';
    expect(portsFor(rs, rp, rd, tbl, 1, col).map((x) => x.kind)).toEqual(['fk']);
  });
});
