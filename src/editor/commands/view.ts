import * as ops from '@/model/ops';
import { guarded, activeInfo } from './util';
import { canvasUiStore, writeSymbolHints } from '../canvasState';
import { kbAnnounce } from '../keyboard/keyboardState';
import { t } from '@/i18n';
import { focusNextRegion, focusProperties } from './focus';
import { registerCommand, type Command } from './registry';

const canvasReady = (c: { canvas: unknown }): boolean => !!c.canvas;

export const viewCommands: Command[] = [
  { id: 'view.zoomIn', labelKey: 'commands.view.zoomIn', group: 'view', shortcut: ['Mod+=', 'Mod++'], icon: 'zoom-in', isEnabled: canvasReady, run: (c) => c.canvas?.zoomBy(1.25) },
  { id: 'view.zoomOut', labelKey: 'commands.view.zoomOut', group: 'view', shortcut: 'Mod+-', icon: 'zoom-out', isEnabled: canvasReady, run: (c) => c.canvas?.zoomBy(1 / 1.25) },
  { id: 'view.zoomReset', labelKey: 'commands.view.zoomReset', group: 'view', shortcut: 'Mod+0', isEnabled: canvasReady, run: (c) => c.canvas?.zoomTo(1) },
  { id: 'view.fit', labelKey: 'commands.view.fit', group: 'view', shortcut: 'Shift+1', icon: 'fit', isEnabled: canvasReady, run: (c) => c.canvas?.fitToContent() },
  {
    id: 'view.fitSelection',
    labelKey: 'commands.view.fitSelection',
    group: 'view',
    shortcut: 'Shift+2',
    isEnabled: (c) => canvasReady(c) && (activeInfo(c)?.nodeIds.length ?? 0) > 0,
    run: (c) => {
      const i = activeInfo(c);
      if (i && i.nodeIds.length) c.canvas?.fitToNodes(i.nodeIds);
    },
  },
  {
    id: 'view.toggleGrid',
    labelKey: 'commands.view.toggleGrid',
    group: 'view',
    shortcut: 'Mod+\'',
    isEnabled: (c) => !!activeInfo(c),
    isChecked: (c) => !!activeInfo(c)?.diagram.options.grid.visible,
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Toggle grid', (d) => ops.setDiagramOptions(d, i.diagramId, { grid: { visible: !i.diagram.options.grid.visible } })));
    },
  },
  {
    id: 'view.toggleSnap',
    labelKey: 'commands.view.toggleSnap',
    group: 'view',
    isEnabled: (c) => !!activeInfo(c),
    isChecked: (c) => !!activeInfo(c)?.diagram.options.grid.snap,
    run: (c) => {
      const i = activeInfo(c);
      if (i) guarded(() => c.store.getState().commit('Toggle snap', (d) => ops.setDiagramOptions(d, i.diagramId, { grid: { snap: !i.diagram.options.grid.snap } })));
    },
  },
  {
    id: 'view.symbolHints',
    labelKey: 'commands.view.symbolHints',
    group: 'view',
    isChecked: () => canvasUiStore.getState().symbolHints,
    run: () => {
      const on = !canvasUiStore.getState().symbolHints;
      writeSymbolHints(on);
      kbAnnounce(t(on ? 'editor.live.hintsOn' : 'editor.live.hintsOff'));
    },
  },
  {
    id: 'view.outline',
    labelKey: 'commands.view.outline',
    group: 'view',
    isEnabled: canvasReady,
    run: () => focusOutline(),
  },
  { id: 'focus.properties', labelKey: 'commands.focus.properties', group: 'view', shortcut: 'Mod+Alt+P', isEnabled: canvasReady, run: () => focusProperties() },
  { id: 'focus.next', labelKey: 'commands.focus.next', group: 'view', shortcut: 'F6', run: () => void focusNextRegion(1) },
  { id: 'focus.prev', labelKey: 'commands.focus.prev', group: 'view', shortcut: 'Shift+F6', run: () => void focusNextRegion(-1) },
];

/** Focus the first item of the diagram outline (the text alternative of the canvas). */
export function focusOutline(): void {
  const first = document.querySelector<HTMLElement>('[data-diagram-outline] a');
  const nav = document.querySelector<HTMLElement>('[data-diagram-outline]');
  (first ?? nav)?.focus();
}

viewCommands.forEach(registerCommand);
