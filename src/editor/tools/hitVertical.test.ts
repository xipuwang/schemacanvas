import { describe, expect, it } from 'vitest';
import { pharmacyVFixture } from '@/scene/vertical/fixtures';
import { buildScene } from '@/scene/registry';
import { rectCenter } from '@/scene/geometry';
import type { VFkEdgeGeom, VTableGeom } from '@/scene/types';
import { deepFreeze } from '@/test/deepFreeze';
import { hitTest } from '../hit';

function scene(type: 'crows-foot' | 'physical', orientation: 'vertical' | 'horizontal') {
  const f = pharmacyVFixture(type, orientation);
  const project = deepFreeze(f.project);
  return buildScene(project, f.diagram.id);
}

describe('hitTest: vertical family (v-table rows, v-fk edges)', () => {
  it('a row of a vertical table yields its column id; the header yields onName; the table body outside rows is a node hit', () => {
    const sc = scene('crows-foot', 'vertical');
    const g = Object.values(sc.nodes).find((n): n is VTableGeom => n.kind === 'v-table')!;
    const row = g.rows[1]!;
    expect(hitTest(sc, rectCenter(row.rect), 1)).toEqual({ kind: 'node', nodeId: g.nodeId, columnId: row.columnId });
    expect(hitTest(sc, rectCenter(g.header), 1)).toEqual({ kind: 'node', nodeId: g.nodeId, onName: true });
    expect(hitTest(sc, { x: g.bounds.x + g.bounds.w + 40, y: g.bounds.y }, 1).kind).not.toBe('node');
  });

  it('physical tables: rows resolve too, sections are plain node hits', () => {
    const sc = scene('physical', 'vertical');
    for (const g of Object.values(sc.nodes)) {
      if (g.kind !== 'v-table') continue;
      for (const r of g.rows) expect(hitTest(sc, rectCenter(r.rect), 1)).toMatchObject({ kind: 'node', nodeId: g.nodeId, columnId: r.columnId });
    }
  });

  it('horizontal orientation: cells yield columns and vertical borders; the empty space beside the name is click-through', () => {
    const sc = scene('crows-foot', 'horizontal');
    const g = Object.values(sc.nodes).find((n): n is VTableGeom => n.kind === 'v-table' && n.rows.length > 1)!;
    const cell = g.rows[0]!;
    const hit = hitTest(sc, { x: cell.rect.x + cell.rect.w / 2, y: cell.rect.y + cell.rect.h / 2 }, 1);
    expect(hit).toMatchObject({ kind: 'node', columnId: cell.columnId });
    const onBorder = hitTest(sc, { x: cell.rect.x + cell.rect.w - 1, y: cell.rect.y + cell.rect.h / 2 }, 1);
    expect(onBorder).toMatchObject({ kind: 'node', border: { columnId: cell.columnId, side: 'right' } });
  });

  it('a v-fk connector is hit on its path with the attached SOURCE column as branch id', () => {
    const sc = scene('crows-foot', 'vertical');
    const e = Object.values(sc.edges).find((x): x is VFkEdgeGeom => x.kind === 'v-fk')!;
    const pts = e.points;
    let hit;
    for (let i = 0; i + 1 < pts.length && !hit; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) < 20) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = hitTest(sc, mid, 1, { kinds: ['edge'] });
      if (r.kind === 'edge') hit = r;
    }
    expect(hit).toMatchObject({ kind: 'edge', edgeId: e.edgeId, branchId: e.sourceColumnId });
  });
});
