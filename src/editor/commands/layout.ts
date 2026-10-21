import { autoLayout, isAbortError } from '@/layout';
import * as ops from '@/model/ops';
import { buildScene } from '@/scene/registry';
import { t } from '@/i18n';
import { kbAnnounce } from '../keyboard/keyboardState';
import { registerCommand, type Command, type CommandContext } from './registry';
import { activeInfo, reportOpError } from './util';

/** The layout started by a command that is still running (one at a time); Esc / `cancelAutoLayout` aborts it. */
let running: AbortController | undefined;

/** Abort the running toolbar / command-palette layout. Returns true when one was running. */
export function cancelAutoLayout(): boolean {
  if (!running) return false;
  running.abort();
  return true;
}

async function runLayout(ctx: CommandContext, label: string, only: boolean): Promise<void> {
  if (running) return;
  const i = activeInfo(ctx);
  if (!i) return;
  const controller = new AbortController();
  running = controller;
  try {
    const scene = buildScene(i.project, i.diagramId);
    const positions = await autoLayout(scene, i.project, i.diagramId, { ...(only ? { onlyNodeIds: i.nodeIds } : {}), signal: controller.signal });
    if (controller.signal.aborted || Object.keys(positions).length === 0) return;
    ctx.store.getState().commit(label, (d) => void ops.setNodePositions(d, i.diagramId, positions));
    ctx.canvas?.fitToContent();
    kbAnnounce(t('editor.live.layout'));
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) return;
    reportOpError(err);
  } finally {
    if (running === controller) running = undefined;
  }
}

export const layoutCommands: Command[] = [
  {
    id: 'layout.auto',
    labelKey: 'commands.layout.auto',
    group: 'diagram',
    shortcut: 'Mod+Shift+L',
    icon: 'layout',
    isEnabled: (c) => !!activeInfo(c) && !c.store.getState().inTransaction,
    run: (c) => runLayout(c, 'Auto-layout', false),
  },
  {
    id: 'layout.autoSelection',
    labelKey: 'commands.layout.autoSelection',
    group: 'diagram',
    isEnabled: (c) => (activeInfo(c)?.unlockedNodeIds.length ?? 0) > 0 && !c.store.getState().inTransaction,
    run: (c) => runLayout(c, 'Auto-layout selection', true),
  },
  {
    id: 'edge.resetRoute',
    labelKey: 'commands.edge.resetRoute',
    group: 'diagram',
    shortcut: 'R',
    isEnabled: (c) => (activeInfo(c)?.edgeIds.length ?? 0) > 0,
    run: (c) => {
      const i = activeInfo(c);
      if (!i || i.edgeIds.length === 0) return;
      try {
        c.store.getState().commit('Reset route', (d) => ops.resetEdgeRoute(d, i.diagramId, i.edgeIds));
      } catch (err) {
        reportOpError(err);
      }
    },
  },
];

layoutCommands.forEach(registerCommand);
