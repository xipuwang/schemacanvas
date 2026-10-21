/**
 * THE command registry: toolbar buttons, menus, the context menu, keyboard shortcuts and the command palette all
 * invoke commands from here, so enable/disable state, labels and shortcuts are defined exactly once.
 * Any module may `registerCommand` (the editor registers edit/view/arrange commands; the UI registers dialog/file
 * commands). Ids are dotted: `edit.undo`, `view.fit`, `arrange.alignLeft`, `file.export`, `diagram.convert` …
 */
import { useStore, createStore } from 'zustand';
import { editorStore } from '@/store';
import type { DiagramCanvasHandle } from '../canvasHandle';

export type CommandGroup = 'file' | 'edit' | 'view' | 'arrange' | 'diagram' | 'tools' | 'help';

export interface CommandContext {
  store: typeof editorStore;
  /** The mounted canvas for the active diagram, if any. */
  canvas: DiagramCanvasHandle | null;
}

export interface Command {
  id: string;
  /** i18n key of the label (`commands.<id>` by convention). */
  labelKey: string;
  group: CommandGroup;
  /** One or more shortcuts (see shortcuts.ts); the first is the one displayed. */
  shortcut?: string | string[];
  /** Icon name understood by the UI icon set. */
  icon?: string;
  isEnabled?(ctx: CommandContext): boolean;
  /** For toggles (grid, snap, panels): checked state. */
  isChecked?(ctx: CommandContext): boolean;
  run(ctx: CommandContext, arg?: unknown): void | Promise<void>;
}

const commands = new Map<string, Command>();
let canvas: DiagramCanvasHandle | null = null;
const version = createStore<{ v: number }>(() => ({ v: 0 }));
const bump = (): void => version.setState((s) => ({ v: s.v + 1 }));

export function registerCommand(cmd: Command): () => void {
  commands.set(cmd.id, cmd);
  bump();
  return () => {
    if (commands.get(cmd.id) === cmd) {
      commands.delete(cmd.id);
      bump();
    }
  };
}

export const getCommand = (id: string): Command | undefined => commands.get(id);
export const listCommands = (): Command[] => [...commands.values()];

/** The canvas calls this on mount/unmount so commands can reach viewport/overlay state. */
export function setCanvasHandle(handle: DiagramCanvasHandle | null): void {
  canvas = handle;
  bump();
}

export const commandContext = (): CommandContext => ({ store: editorStore, canvas });

export function isCommandEnabled(id: string): boolean {
  const c = commands.get(id);
  return !!c && (c.isEnabled?.(commandContext()) ?? true);
}

export async function runCommand(id: string, arg?: unknown): Promise<boolean> {
  const c = commands.get(id);
  if (!c) return false;
  const ctx = commandContext();
  if (c.isEnabled && !c.isEnabled(ctx)) return false;
  await c.run(ctx, arg);
  return true;
}

/** Find the command a keyboard event triggers (used by the canvas/app key handler). */
export function findCommandForEvent(ev: import('./shortcuts').KeyEventLike, matches: (ev: import('./shortcuts').KeyEventLike, s: string) => boolean): Command | undefined {
  // Several commands may share a key when they apply in different situations (cell mode / connector focus / ...): the first ENABLED
  // one wins, else the first match (so a disabled owner still swallows the key exactly as before).
  let first: Command | undefined;
  for (const c of commands.values()) {
    const list = c.shortcut === undefined ? [] : Array.isArray(c.shortcut) ? c.shortcut : [c.shortcut];
    if (!list.some((s) => matches(ev, s))) continue;
    first ??= c;
    if (!c.isEnabled || c.isEnabled(commandContext())) return c;
  }
  return first;
}

/**
 * React hook for toolbar/menu items: re-renders when the registry, the canvas handle or the editor state changes,
 * so `enabled`/`checked` stay live.
 */
export function useCommand(id: string): { command: Command | undefined; enabled: boolean; checked: boolean; run: (arg?: unknown) => void } {
  useStore(version, (s) => s.v);
  // subscribe to every editor-state change that could affect enablement
  useStore(editorStore, (s) => s.project);
  useStore(editorStore, (s) => s.selection);
  useStore(editorStore, (s) => s.canUndo);
  useStore(editorStore, (s) => s.canRedo);
  const command = commands.get(id);
  const ctx = commandContext();
  return {
    command,
    enabled: !!command && (command.isEnabled?.(ctx) ?? true),
    checked: !!command?.isChecked?.(ctx),
    run: (arg) => void runCommand(id, arg),
  };
}
