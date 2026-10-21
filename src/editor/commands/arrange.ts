import { alignNodes, distributeNodes, matchSize, type AlignMode } from '@/layout';
import type { LayoutRect } from '@/layout';
import * as ops from '@/model/ops';
import { buildScene } from '@/scene/registry';
import type { NodeGeom } from '@/scene/types';
import { registerCommand, type Command, type CommandContext } from './registry';
import { activeInfo, guarded } from './util';

function items(ctx: CommandContext): { rects: LayoutRect[]; locked: Set<string>; diagramId: string } | undefined {
  const i = activeInfo(ctx);
  if (!i) return undefined;
  const scene = buildScene(i.project, i.diagramId);
  const rects: LayoutRect[] = [];
  for (const id of i.nodeIds) {
    const g = scene.nodes[id];
    if (g) rects.push({ id, x: g.bounds.x, y: g.bounds.y, w: g.bounds.w, h: g.bounds.h });
  }
  return { rects, locked: new Set(i.nodeIds.filter((id) => i.diagram.nodes[id]?.locked)), diagramId: i.diagramId };
}

const enough = (min: number) => (c: CommandContext): boolean => {
  const i = activeInfo(c);
  return !!i && i.unlockedNodeIds.length >= min;
};

function align(id: string, mode: AlignMode): Command {
  return {
    id: `arrange.align${id}`,
    labelKey: `commands.arrange.align${id}`,
    group: 'arrange',
    icon: `align-${mode}`,
    isEnabled: enough(2),
    run: (c) => {
      const it = items(c);
      if (!it) return;
      const positions = alignNodes(it.rects, mode, it.locked);
      if (Object.keys(positions).length === 0) return;
      guarded(() => c.store.getState().commit(`Align ${mode}`, (d) => void ops.setNodePositions(d, it.diagramId, positions)));
    },
  };
}

function distribute(id: string, axis: 'horizontal' | 'vertical'): Command {
  return {
    id: `arrange.distribute${id}`,
    labelKey: `commands.arrange.distribute${id}`,
    group: 'arrange',
    icon: `distribute-${axis}`,
    isEnabled: enough(3),
    run: (c) => {
      const it = items(c);
      if (!it) return;
      const positions = distributeNodes(it.rects, axis, 'even', it.locked);
      if (Object.keys(positions).length === 0) return;
      guarded(() => c.store.getState().commit(`Distribute ${axis}`, (d) => void ops.setNodePositions(d, it.diagramId, positions)));
    },
  };
}

/** `DiagramNode.width/height` meaning differs per notation: h-table = row width / row height; Chen = the shape's box. */
function sizeBasis(g: NodeGeom): { w: number; h: number } {
  return g.kind === 'h-table' ? { w: g.row.w, h: g.row.h } : { w: g.bounds.w, h: g.bounds.h };
}

function match(id: string, dim: 'width' | 'height'): Command {
  return {
    id: `arrange.match${id}`,
    labelKey: `commands.arrange.match${id}`,
    group: 'arrange',
    icon: `match-${dim}`,
    isEnabled: enough(2),
    run: (c) => {
      const info = activeInfo(c);
      if (!info) return;
      const scene = buildScene(info.project, info.diagramId);
      const rects: LayoutRect[] = [];
      for (const id of info.nodeIds) {
        const g = scene.nodes[id];
        if (g) rects.push({ id, x: 0, y: 0, ...sizeBasis(g) });
      }
      const movable = new Set(info.unlockedNodeIds);
      const sizes = matchSize(rects, dim, 'largest');
      const targets = Object.entries(sizes).filter(([id]) => movable.has(id));
      if (targets.length === 0) return;
      guarded(() =>
        c.store.getState().commit(`Match ${dim}`, (d) => {
          for (const [id, s] of targets) ops.setNodeSize(d, info.diagramId, id, dim === 'width' ? { width: s.w } : { height: s.h });
        }),
      );
    },
  };
}

const hasNodes = (c: CommandContext): boolean => (activeInfo(c)?.nodeIds.length ?? 0) > 0;

export const arrangeCommands: Command[] = [
  align('Left', 'left'),
  align('Center', 'center'),
  align('Right', 'right'),
  align('Top', 'top'),
  align('Middle', 'middle'),
  align('Bottom', 'bottom'),
  distribute('H', 'horizontal'),
  distribute('V', 'vertical'),
  match('Width', 'width'),
  match('Height', 'height'),
  {
    id: 'arrange.bringToFront',
    labelKey: 'commands.arrange.bringToFront',
    group: 'arrange',
    shortcut: 'Mod+Shift+]',
    isEnabled: hasNodes,
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Bring to front', (d) => ops.bringToFront(d, i.diagramId, i.nodeIds)));
    },
  },
  {
    id: 'arrange.sendToBack',
    labelKey: 'commands.arrange.sendToBack',
    group: 'arrange',
    shortcut: 'Mod+Shift+[',
    isEnabled: hasNodes,
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Send to back', (d) => ops.sendToBack(d, i.diagramId, i.nodeIds)));
    },
  },
  {
    id: 'arrange.lock',
    labelKey: 'commands.arrange.lock',
    group: 'arrange',
    isEnabled: (c) => {
      const i = activeInfo(c);
      return !!i && i.unlockedNodeIds.length > 0;
    },
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Lock', (d) => ops.setNodeLocked(d, i.diagramId, i.nodeIds, true)));
    },
  },
  {
    id: 'arrange.unlock',
    labelKey: 'commands.arrange.unlock',
    group: 'arrange',
    isEnabled: (c) => {
      const i = activeInfo(c);
      return !!i && i.unlockedNodeIds.length < i.nodeIds.length;
    },
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Unlock', (d) => ops.setNodeLocked(d, i.diagramId, i.nodeIds, false)));
    },
  },
];

arrangeCommands.forEach(registerCommand);
