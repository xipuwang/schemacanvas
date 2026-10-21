import type { Id } from '@/model/types';
import type { Scene } from '@/scene/types';

/** Node ids of the scene whose semantic ref has the given kind (`relation` = every table). */
export function nodesOfKind(scene: Scene, kind: 'relation' | 'entity' | 'relationship' | 'attribute'): Id[] {
  return scene.nodeOrder.filter((id) => {
    const k = scene.nodes[id]?.ref.kind;
    return k === kind;
  });
}
