import { registerCommand, type Command } from './registry';

export const toolCommands: Command[] = [
  { id: 'tool.select', labelKey: 'commands.tool.select', group: 'tools', shortcut: 'V', icon: 'pointer', isChecked: (c) => c.store.getState().tool === 'select', run: (c) => c.store.getState().setTool('select') },
  { id: 'tool.hand', labelKey: 'commands.tool.hand', group: 'tools', shortcut: 'H', icon: 'hand', isChecked: (c) => c.store.getState().tool === 'hand', run: (c) => c.store.getState().setTool('hand') },
];

toolCommands.forEach(registerCommand);
