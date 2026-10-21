/** Commands of the editing tools (labels: `commands.<id>` from src/i18n/messages/editor-tools.ts). */
import { t } from '@/i18n';
import * as ops from '@/model/ops';
import type { Id } from '@/model/types';
import { registerCommand, type Command } from '../commands/registry';
import { activeInfo, guarded } from '../commands/util';
import { flavorsFor, ownerOfNode, type AttrFlavor } from './attributes';
import { planConnectSelected } from './chenConnect';
import { straightenEdge } from './handlesPlugin';
import { performConnect } from './toolsPlugin';
import { runAddAttribute } from './ToolChrome';
import { armFkFromCell } from '../keyboard/actions';
import { kbStore } from '../keyboard/keyboardState';
import { announce, setToolUi } from './toolState';

const isChen = (type: string | undefined): boolean => type === 'chen';

const diagramType = (ctx: Parameters<NonNullable<Command['isEnabled']>>[0]): string | undefined => activeInfo(ctx)?.diagram.type;

/** The single selected node that can own attributes, with its owner kind. */
function ownerSelection(ctx: Parameters<NonNullable<Command['isEnabled']>>[0]) {
  const info = activeInfo(ctx);
  if (!info || info.nodeIds.length !== 1 || info.edgeIds.length > 0) return undefined;
  const nodeId = info.nodeIds[0]!;
  const owner = ownerOfNode(info.diagram, nodeId);
  return owner ? { nodeId, owner, info } : undefined;
}

const attrCommand = (id: string, flavor: AttrFlavor, shortcut?: string): Command => ({
  id,
  labelKey: `commands.${id}`,
  group: 'tools',
  icon: 'attribute',
  ...(shortcut ? { shortcut } : {}),
  isEnabled: (ctx) => {
    const sel = ownerSelection(ctx);
    return !!sel && flavorsFor(sel.owner.kind).includes(flavor);
  },
  run: (ctx) => {
    const sel = ownerSelection(ctx);
    if (sel) runAddAttribute(sel.nodeId, flavor);
  },
});

export const toolsCommands: Command[] = [
  {
    id: 'tool.connect',
    labelKey: 'commands.tool.connect',
    group: 'tools',
    shortcut: 'C',
    icon: 'link',
    isEnabled: (ctx) => isChen(diagramType(ctx)),
    isChecked: (c) => c.store.getState().tool === 'connect',
    run: (c) => c.store.getState().setTool('connect'),
  },
  {
    id: 'tool.fk',
    labelKey: 'commands.tool.fk',
    group: 'tools',
    shortcut: 'F',
    icon: 'key',
    isEnabled: (ctx) => {
      const type = diagramType(ctx);
      return !!type && !isChen(type);
    },
    isChecked: (c) => c.store.getState().tool === 'fk',
    run: (c) => c.store.getState().setTool('fk'),
  },
  {
    id: 'chen.connectSelected',
    labelKey: 'commands.chen.connectSelected',
    group: 'tools',
    icon: 'link',
    isEnabled: (ctx) => {
      const info = activeInfo(ctx);
      return !!info && info.edgeIds.length === 0 && !!planConnectSelected(info.project, info.diagram, info.nodeIds);
    },
    run: (ctx) => {
      const info = activeInfo(ctx);
      const plan = info && planConnectSelected(info.project, info.diagram, info.nodeIds);
      if (!info || !plan) return;
      // the entity/relationship order of the selection does not matter: `performConnect` classifies the pair itself
      performConnect({ store: ctx.store, diagramId: info.diagramId, handle: ctx.canvas, zoom: ctx.canvas?.getViewport().zoom ?? 1 }, plan.from, plan.to, false);
    },
  },
  attrCommand('chen.addAttribute', 'simple', 'A'),
  attrCommand('chen.addKeyAttribute', 'key'),
  attrCommand('chen.addPartialKeyAttribute', 'partial-key'),
  attrCommand('chen.addMultivaluedAttribute', 'multivalued'),
  attrCommand('chen.addDerivedAttribute', 'derived'),
  attrCommand('chen.addCompositeAttribute', 'composite'),
  {
    id: 'chen.addSubAttribute',
    labelKey: 'commands.chen.addSubAttribute',
    group: 'tools',
    icon: 'attribute',
    isEnabled: (ctx) => ownerSelection(ctx)?.owner.kind === 'attribute',
    run: (ctx) => {
      const sel = ownerSelection(ctx);
      if (sel) runAddAttribute(sel.nodeId, 'simple');
    },
  },
  {
    id: 'edge.straighten',
    labelKey: 'commands.edge.straighten',
    group: 'arrange',
    icon: 'layout',
    isEnabled: (ctx) => {
      const info = activeInfo(ctx);
      if (!info) return false;
      return info.edgeIds.some((id) => {
        const r = info.diagram.edges[id]!.route;
        return r.mode === 'manual' && r.waypoints.length > 0;
      });
    },
    run: (ctx) => {
      const info = activeInfo(ctx);
      if (!info) return;
      let changed = false;
      for (const id of info.edgeIds) changed = straightenEdge({ store: ctx.store, diagramId: info.diagramId }, id) || changed;
      announce(t(changed ? 'editorTools.announce.straightened' : 'editorTools.announce.alreadyStraight'));
    },
  },
  {
    id: 'table.resetWidths',
    labelKey: 'commands.table.resetWidths',
    group: 'arrange',
    icon: 'match-size',
    isEnabled: (ctx) => {
      const info = activeInfo(ctx);
      return !!info && info.unlockedNodeIds.some((id) => info.diagram.nodes[id]!.ref.kind === 'relation');
    },
    run: (ctx) => {
      const info = activeInfo(ctx);
      if (!info) return;
      const ids = info.unlockedNodeIds.filter((id) => info.diagram.nodes[id]!.ref.kind === 'relation');
      guarded(() =>
        ctx.store.getState().commit('Reset column widths', (d) => {
          for (const id of ids) {
            const n = d.diagrams[info.diagramId]!.nodes[id]!;
            for (const col of Object.keys(n.columnWidths ?? {})) ops.setColumnWidth(d, info.diagramId, id, col, undefined);
            ops.setNodeSize(d, info.diagramId, id, { width: undefined });
          }
        }),
      );
    },
  },
  {
    id: 'node.resetSize',
    labelKey: 'commands.node.resetSize',
    group: 'arrange',
    icon: 'match-size',
    isEnabled: (ctx) => {
      const info = activeInfo(ctx);
      return !!info && info.unlockedNodeIds.some((id) => info.diagram.nodes[id]!.ref.kind !== 'relation' && (info.diagram.nodes[id]!.width !== undefined || info.diagram.nodes[id]!.height !== undefined));
    },
    run: (ctx) => {
      const info = activeInfo(ctx);
      if (!info) return;
      const ids = info.unlockedNodeIds.filter((id) => info.diagram.nodes[id]!.ref.kind !== 'relation');
      guarded(() => ctx.store.getState().commit('Reset size', (d) => void ids.forEach((id: Id) => ops.setNodeSize(d, info.diagramId, id, { width: undefined, height: undefined }))));
    },
  },
  {
    id: 'fk.fromSelection',
    labelKey: 'commands.fk.fromSelection',
    group: 'tools',
    shortcut: 'Shift+F',
    icon: 'key',
    isEnabled: (ctx) => {
      const info = activeInfo(ctx);
      const sub = ctx.store.getState().selection.sub;
      return !!info && !isChen(info.diagram.type) && info.nodeIds.length === 1 && (sub?.kind === 'column' || kbStore.getState().cell !== null);
    },
    run: (ctx) => {
      // keyboard cell mode: the MARKED cells (a composite source) are the source, arrows then choose the referenced table
      if (kbStore.getState().cell && armFkFromCell()) return;
      const info = activeInfo(ctx);
      const sub = ctx.store.getState().selection.sub;
      if (!info || sub?.kind !== 'column') return;
      const nodeId = info.nodeIds[0]!;
      ctx.store.getState().setTool('fk');
      setToolUi({ fkPending: { nodeId, relationId: sub.relationId, columnIds: [sub.id] } });
      announce(t('editorTools.announce.fkArmed'));
    },
  },
];

export function registerToolsCommands(): () => void {
  const offs = toolsCommands.map(registerCommand);
  return () => offs.forEach((off) => off());
}

