/**
 * Stable, id-independent names for diagram nodes. The frozen layouts are keyed by these, so a layout never depends on
 * id order or on generation order.
 *   ER:         entity `Student`, relationship `Makes`, attribute `Student.Name.First`, relationship attribute `Sell.Price`
 *   relational: relation `Drug`
 */
import type { Diagram, DiagramNode, ErAttribute, ErModel, Model } from '@/model/types';

function attributePath(er: ErModel, a: ErAttribute): string {
  const parts: string[] = [a.name];
  let owner = a.owner;
  for (let guard = 0; guard < 64; guard++) {
    if (owner.kind === 'attribute') {
      const parent = er.attributes[owner.id];
      if (!parent) break;
      parts.unshift(parent.name);
      owner = parent.owner;
    } else {
      const holder = owner.kind === 'entity' ? er.entities[owner.id] : er.relationships[owner.id];
      if (holder) parts.unshift(holder.name);
      break;
    }
  }
  return parts.join('.');
}

export function nodeKey(model: Model, node: DiagramNode): string | undefined {
  const ref = node.ref;
  if (model.kind === 'er') {
    switch (ref.kind) {
      case 'entity':
        return model.entities[ref.id]?.name;
      case 'relationship':
        return model.relationships[ref.id]?.name;
      case 'attribute': {
        const a = model.attributes[ref.id];
        return a && attributePath(model, a);
      }
      default:
        return undefined;
    }
  }
  return ref.kind === 'relation' ? model.relations[ref.id]?.name : undefined;
}

/** `{key: nodeId}`; throws on a duplicate key (a layout could not tell the two apart). */
export function nodeIdsByKey(model: Model, diagram: Diagram): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of Object.values(diagram.nodes)) {
    const k = nodeKey(model, n);
    if (k === undefined) continue;
    if (k in out) throw new Error(`examples: duplicate node key "${k}" in diagram ${diagram.name}`);
    out[k] = n.id;
  }
  return out;
}

/** Write frozen positions into `diagram`; returns the keys that had no entry (callers/tests treat that as a bug). */
export function applyFrozenPositions(model: Model, diagram: Diagram, table: Record<string, [number, number]>): string[] {
  const missing: string[] = [];
  for (const [key, id] of Object.entries(nodeIdsByKey(model, diagram))) {
    const p = table[key];
    if (!p) {
      missing.push(key);
      continue;
    }
    const node = diagram.nodes[id]!;
    node.x = p[0];
    node.y = p[1];
  }
  return missing;
}
