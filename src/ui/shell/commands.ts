/**
 * Commands owned by the shell: file, dialogs, validation, panel toggles, palette. Labels live in the `commands`
 * i18n namespace (src/i18n/messages/commands-shell.ts) under the dotted command id.
 */
import { registerCommand, type Command } from '@/editor';
import { editorStore, settingsStore, type PanelVisibility } from '@/store';
import { uiStore } from '../uiStore';
import { confirmDiscardIfDirty, pickProjectFile, saveProjectFile } from './files';
import { currentLayoutMode } from './layout';
import { shellStore } from './shellStore';
import { runValidation } from './validation';

const activeDiagramType = (): string | undefined => {
  const s = editorStore.getState();
  return s.activeDiagramId ? s.project.diagrams[s.activeDiagramId]?.type : undefined;
};

const openDialog =
  (kind: Parameters<ReturnType<typeof uiStore.getState>['openDialog']>[0]) =>
  (): void =>
    uiStore.getState().openDialog(kind);

/** Is this panel currently showing? (docked in the wide layout, drawer otherwise) */
export function isPanelShown(slot: keyof PanelVisibility): boolean {
  if (slot === 'issues') return uiStore.getState().dock === 'issues';
  return currentLayoutMode() === 'wide' ? settingsStore.getState().panels[slot] : shellStore.getState().drawer === slot;
}

export function togglePanel(slot: keyof PanelVisibility): void {
  if (slot === 'issues') {
    const ui = uiStore.getState();
    ui.setDock(ui.dock === 'issues' ? null : 'issues');
    return;
  }
  if (currentLayoutMode() === 'wide') settingsStore.getState().togglePanel(slot);
  else shellStore.getState().toggleDrawer(slot);
}

export function shellCommands(): Command[] {
  const panel = (slot: keyof PanelVisibility, icon: string, shortcut: string): Command => ({
    id: `view.togglePanel.${slot}`,
    labelKey: `commands.view.togglePanel.${slot}`,
    group: 'view',
    shortcut,
    icon,
    isChecked: () => isPanelShown(slot),
    run: () => togglePanel(slot),
  });
  return [
    {
      id: 'file.new',
      labelKey: 'commands.file.new',
      group: 'file',
      icon: 'new',
      async run() {
        if (await confirmDiscardIfDirty()) uiStore.getState().openDialog('new-project');
      },
    },
    { id: 'file.open', labelKey: 'commands.file.open', group: 'file', icon: 'open', shortcut: 'Mod+O', run: pickProjectFile },
    { id: 'file.save', labelKey: 'commands.file.save', group: 'file', icon: 'save', shortcut: 'Mod+S', run: () => void saveProjectFile() },
    { id: 'file.export', labelKey: 'commands.file.export', group: 'file', icon: 'export', shortcut: 'Mod+Shift+E', run: openDialog('export') },
    { id: 'file.import', labelKey: 'commands.file.import', group: 'file', icon: 'import', run: openDialog('import') },
    { id: 'file.examples', labelKey: 'commands.file.examples', group: 'file', icon: 'example', run: openDialog('examples') },
    { id: 'file.recent', labelKey: 'commands.file.recent', group: 'file', icon: 'folder', run: openDialog('recent') },
    {
      id: 'diagram.validate',
      labelKey: 'commands.diagram.validate',
      group: 'diagram',
      icon: 'validate',
      shortcut: 'F8',
      run: () => void runValidation(true),
    },
    {
      id: 'diagram.convert',
      labelKey: 'commands.diagram.convert',
      group: 'diagram',
      icon: 'convert',
      isEnabled: () => activeDiagramType() === 'chen',
      run: openDialog('convert'),
    },
    { id: 'diagram.options', labelKey: 'commands.diagram.options', group: 'diagram', icon: 'settings', run: openDialog('diagram-options') },
    { id: 'help.shortcuts', labelKey: 'commands.help.shortcuts', group: 'help', icon: 'keyboard', shortcut: ['?', 'F1'], run: openDialog('shortcuts') },
    { id: 'help.about', labelKey: 'commands.help.about', group: 'help', icon: 'info', run: openDialog('about') },
    { id: 'settings', labelKey: 'commands.settings', group: 'tools', icon: 'settings', shortcut: 'Mod+,', run: openDialog('settings') },
    {
      id: 'palette.open',
      labelKey: 'commands.palette.open',
      group: 'tools',
      icon: 'command',
      shortcut: 'Mod+K',
      run: () => shellStore.getState().setPalette(true),
    },
    panel('library', 'panel-left', 'Mod+B'),
    panel('properties', 'panel-right', 'Mod+I'),
    panel('issues', 'panel-bottom', 'Mod+J'),
  ];
}

let unregister: (() => void) | undefined;

/** Register the shell commands (idempotent). Returns an unregister function. */
export function registerShellCommands(): () => void {
  unregister?.();
  const offs = shellCommands().map(registerCommand);
  unregister = () => {
    offs.forEach((off) => off());
    unregister = undefined;
  };
  return unregister;
}
