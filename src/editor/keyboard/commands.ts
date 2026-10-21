/** Commands of the keyboard layer (labels: `commands.<id>` in src/i18n/messages/commands-editor.ts). They show up in the shortcuts dialog. */
import { t } from '@/i18n';
import { registerCommand, type Command, type CommandContext } from '../commands/registry';
import { activeInfo } from '../commands/util';
import { toolUi } from '../tools/toolState';
import {
  cellExit,
  cellRename,
  cellStep,
  cellToggle,
  createAtViewCentre,
  edgeCycle,
  enterCell,
  edgeInsertBend,
  edgeRemoveBend,
  envFromStore,
  hasEdgeFocus,
  linkStart,
  selectedEdgeId,
  selectedTableNode,
} from './actions';
import { kbAnnounce, kbStore } from './keyboardState';

const env = (ctx: CommandContext) => envFromStore(ctx.canvas);
const inCell = (): boolean => kbStore.getState().cell !== null;
const diagramType = (ctx: CommandContext): string | undefined => activeInfo(ctx)?.diagram.type;
const isChen = (ctx: CommandContext): boolean => diagramType(ctx) === 'chen';
const isTables = (ctx: CommandContext): boolean => {
  const type = diagramType(ctx);
  return !!type && type !== 'chen';
};
const singleEdge = (ctx: CommandContext): boolean => {
  const i = activeInfo(ctx);
  return !!i && selectedEdgeId(i.diagram, ctx.store.getState().selection.ids) !== undefined;
};

const cellCommand = (id: string, shortcut: string, run: (e: NonNullable<ReturnType<typeof env>>, ctx: CommandContext) => void): Command => ({
  id,
  labelKey: `commands.${id}`,
  group: 'tools',
  shortcut,
  icon: 'table',
  isEnabled: inCell,
  run: (ctx) => {
    const e = env(ctx);
    if (e) run(e, ctx);
  },
});

export const keyboardCommands: Command[] = [
  {
    id: 'table.cellMode',
    labelKey: 'commands.table.cellMode',
    group: 'tools',
    shortcut: 'Enter',
    icon: 'table',
    isEnabled: (ctx) => {
      const i = activeInfo(ctx);
      return !inCell() && !!i && !!selectedTableNode(i.project, i.diagram, ctx.store.getState().selection.ids);
    },
    run: (ctx) => {
      const e = env(ctx);
      if (e) enterCell(e);
    },
  },
  cellCommand('cell.next', 'ArrowRight', (e) => void cellStep(e, 1)),
  cellCommand('cell.prev', 'ArrowLeft', (e) => void cellStep(e, -1)),
  cellCommand('cell.first', 'Home', (e) => void cellStep(e, 'first')),
  cellCommand('cell.last', 'End', (e) => void cellStep(e, 'last')),
  cellCommand('cell.extendNext', 'Shift+ArrowRight', (e) => void cellStep(e, 1, true)),
  cellCommand('cell.extendPrev', 'Shift+ArrowLeft', (e) => void cellStep(e, -1, true)),
  cellCommand('cell.toggle', 'Space', (e) => void cellToggle(e)),
  cellCommand('cell.rename', 'F2', (_e, ctx) => void cellRename(ctx.canvas)),
  { ...cellCommand('cell.exit', 'Escape', () => void cellExit()), icon: 'close' },
  {
    id: 'edge.nextBend',
    labelKey: 'commands.edge.nextBend',
    group: 'tools',
    shortcut: ']',
    icon: 'link',
    isEnabled: singleEdge,
    run: (ctx) => {
      const e = env(ctx);
      if (e) edgeCycle(e, 1);
    },
  },
  {
    id: 'edge.prevBend',
    labelKey: 'commands.edge.prevBend',
    group: 'tools',
    shortcut: '[',
    icon: 'link',
    isEnabled: singleEdge,
    run: (ctx) => {
      const e = env(ctx);
      if (e) edgeCycle(e, -1);
    },
  },
  {
    id: 'edge.insertBend',
    labelKey: 'commands.edge.insertBend',
    group: 'tools',
    shortcut: 'I',
    icon: 'link',
    isEnabled: singleEdge,
    run: (ctx) => {
      const e = env(ctx);
      if (e) edgeInsertBend(e);
    },
  },
  {
    // Arrow keys move the focused handle; the plugin owns the keys (it needs the Shift state), this entry documents them
    id: 'edge.nudgeHandle',
    labelKey: 'commands.edge.nudgeHandle',
    group: 'tools',
    shortcut: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    icon: 'link',
    isEnabled: (ctx) => {
      const e = singleEdge(ctx) ? env(ctx) : undefined;
      return !!e && hasEdgeFocus(e);
    },
    run: () => kbAnnounce(t('editor.kb.edge.nudgeHelp')),
  },
  {
    id: 'edge.removeBend',
    labelKey: 'commands.edge.removeBend',
    group: 'tools',
    icon: 'trash',
    isEnabled: (ctx) => {
      const e = singleEdge(ctx) ? env(ctx) : undefined;
      return !!e && hasEdgeFocus(e);
    },
    run: (ctx) => {
      const e = env(ctx);
      if (e) edgeRemoveBend(e);
    },
  },
  {
    id: 'chen.linkFromSelection',
    labelKey: 'commands.chen.linkFromSelection',
    group: 'tools',
    shortcut: 'L',
    icon: 'link',
    isEnabled: (ctx) => {
      const i = activeInfo(ctx);
      if (!i || !isChen(ctx) || i.nodeIds.length !== 1 || i.edgeIds.length > 0) return false;
      const k = i.diagram.nodes[i.nodeIds[0]!]?.ref.kind;
      return k === 'entity' || k === 'relationship';
    },
    run: (ctx) => {
      const e = env(ctx);
      if (e) linkStart(e);
    },
  },
  {
    id: 'chen.newEntity',
    labelKey: 'commands.chen.newEntity',
    group: 'tools',
    shortcut: 'E',
    icon: 'entity',
    isEnabled: isChen,
    run: (ctx) => {
      const e = env(ctx);
      if (e) createAtViewCentre(e, { kind: 'entity' });
    },
  },
  {
    id: 'chen.newRelationship',
    labelKey: 'commands.chen.newRelationship',
    group: 'tools',
    shortcut: 'Shift+R',
    icon: 'relationship',
    isEnabled: isChen,
    run: (ctx) => {
      const e = env(ctx);
      if (e) createAtViewCentre(e, { kind: 'relationship' });
    },
  },
  {
    id: 'table.new',
    labelKey: 'commands.table.new',
    group: 'tools',
    shortcut: 'T',
    icon: 'table',
    isEnabled: isTables,
    run: (ctx) => {
      const e = env(ctx);
      if (e) createAtViewCentre(e, { kind: 'relation' });
    },
  },
];

/** Used by `fk.fromSelection` and the tools: true while the keyboard FK target selection is active. */
export const fkTargetPending = (): boolean => toolUi.getState().fkPending !== null;

export function registerKeyboardCommands(): () => void {
  const offs = keyboardCommands.map(registerCommand);
  return () => offs.forEach((off) => off());
}
