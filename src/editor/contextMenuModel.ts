/** Which commands the context menu offers for a hit target (pure; the plugin entries are appended by the canvas). */
import { getCommand } from './commands/registry';
import type { HitResult } from './hit';
import type { MenuEntry } from './plugins';

const cmd = (commandId: string): MenuEntry => ({ kind: 'command', commandId });
const SEP: MenuEntry = { kind: 'separator' };

export interface MenuSelectionInfo {
  /** Selected nodes in the diagram, how many are locked. */
  nodeCount: number;
  lockedCount: number;
}

export function builtinMenuEntries(hit: HitResult, sel: MenuSelectionInfo): MenuEntry[] {
  if (hit.kind === 'node') {
    const allLocked = sel.nodeCount > 0 && sel.lockedCount === sel.nodeCount;
    return [
      cmd('edit.cut'),
      cmd('edit.copy'),
      cmd('edit.duplicate'),
      cmd('edit.delete'),
      SEP,
      cmd('arrange.bringToFront'),
      cmd('arrange.sendToBack'),
      cmd(allLocked ? 'arrange.unlock' : 'arrange.lock'),
      SEP,
      cmd('focus.properties'),
      cmd('edit.removeFromDiagram'),
    ];
  }
  if (hit.kind === 'edge' || hit.kind === 'edge-label') return [cmd('edge.resetRoute'), cmd('focus.properties'), SEP, cmd('edit.delete')];
  return [cmd('edit.paste'), cmd('edit.selectAll'), SEP, cmd('view.fit'), cmd('layout.auto')];
}

/** Drop unknown commands, collapse repeated / leading / trailing separators. */
export function tidyEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (e.kind === 'command' && !getCommand(e.commandId)) continue;
    if (e.kind === 'separator' && (out.length === 0 || out[out.length - 1]!.kind === 'separator')) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1]!.kind === 'separator') out.pop();
  return out;
}
