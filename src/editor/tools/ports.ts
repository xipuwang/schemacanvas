/**
 * Ports: the small round grab points that appear on a hovered / selected node. Pure geometry (tested).
 *   connect        Chen entity / relationship  -> drag to another node (participant / new relationship)
 *   add-attribute  Chen entity / relationship / composite attribute -> click adds an attribute
 *   fk             a selected / hovered column cell of a table -> drag to the referenced table
 */
import { attributesOf } from '@/model/queries';
import type { Diagram, ErModel, Id, Point, Project } from '@/model/types';
import type { Scene } from '@/scene/types';
import { dist } from './geom';

export type PortKind = 'connect' | 'add-attribute' | 'fk';

export interface Port {
  id: string;
  kind: PortKind;
  nodeId: Id;
  columnId?: Id;
  at: Point;
}

/** Screen-px hit radius of a port (visible glyph radius is 9). */
export const PORT_HIT_PX = 11;

export function portsFor(scene: Scene, project: Project, diagram: Diagram, nodeId: Id, zoom: number, columnId?: Id): Port[] {
  const g = scene.nodes[nodeId];
  const node = diagram.nodes[nodeId];
  if (!g || !node || node.locked) return [];
  const model = project.models[diagram.modelId];
  const out: Port[] = [];
  if (g.kind === 'chen-entity' || g.kind === 'chen-relationship' || g.kind === 'chen-attribute') {
    const b = g.bounds;
    const x = b.x + b.w + 22 / zoom;
    const y = b.y + b.h / 2;
    const er: ErModel | undefined = model?.kind === 'er' ? model : undefined;
    const composite = g.kind === 'chen-attribute' && !!er && node.ref.kind === 'attribute' && attributesOf(er, { kind: 'attribute', id: node.ref.id }).length > 0;
    if (g.kind !== 'chen-attribute') {
      out.push({ id: `port:add:${nodeId}`, kind: 'add-attribute', nodeId, at: { x, y: y - 13 / zoom } });
      out.push({ id: `port:connect:${nodeId}`, kind: 'connect', nodeId, at: { x, y: y + 13 / zoom } });
    } else if (composite) out.push({ id: `port:add:${nodeId}`, kind: 'add-attribute', nodeId, at: { x, y } });
    return out;
  }
  if (!columnId) return out;
  if (g.kind === 'h-table') {
    const c = g.cells.find((x) => x.columnId === columnId);
    if (c) out.push({ id: `port:fk:${nodeId}:${columnId}`, kind: 'fk', nodeId, columnId, at: { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h + 20 / zoom } });
  } else if (g.kind === 'v-table') {
    const r = g.rows.find((x) => x.columnId === columnId);
    if (r) {
      out.push(
        g.orientation === 'vertical'
          ? { id: `port:fk:${nodeId}:${columnId}`, kind: 'fk', nodeId, columnId, at: { x: r.rect.x + r.rect.w + 28 / zoom, y: r.rect.y + r.rect.h / 2 } }
          : { id: `port:fk:${nodeId}:${columnId}`, kind: 'fk', nodeId, columnId, at: { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h + 20 / zoom } },
      );
    }
  }
  return out;
}

export function hitPort(ports: readonly Port[], world: Point, zoom: number): Port | undefined {
  let best: { p: Port; d: number } | undefined;
  for (const p of ports) {
    const d = dist(p.at, world);
    if (d <= PORT_HIT_PX / zoom && (!best || d < best.d)) best = { p, d };
  }
  return best?.p;
}

/** True when `world` is within the hover zone of `nodeId`: its bounds plus the ports (so the pointer can travel to a port). */
export function inPortZone(scene: Scene, nodeId: Id, ports: readonly Port[], world: Point, zoom: number): boolean {
  const g = scene.nodes[nodeId];
  if (!g) return false;
  const pad = 14 / zoom;
  const b = g.paintBounds;
  if (world.x >= b.x - pad && world.x <= b.x + b.w + pad && world.y >= b.y - pad && world.y <= b.y + b.h + pad) return true;
  return ports.some((p) => dist(p.at, world) <= (PORT_HIT_PX + 10) / zoom);
}
