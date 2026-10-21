import { registerDialog } from '../../dialogs/registry';
import { registerRecentDialog } from '../../dialogs/recent';
import { AboutDialog } from './AboutDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { NewProjectDialog } from './NewProjectDialog';
import { SettingsDialog } from './SettingsDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

/** Register the dialogs the shell owns (new-project, confirm, settings, shortcuts, about). Idempotent. */
export function registerShellDialogs(): () => void {
  const offs = [
    registerDialog('new-project', NewProjectDialog),
    registerDialog('confirm', ConfirmDialog),
    registerDialog('settings', SettingsDialog),
    registerDialog('shortcuts', ShortcutsDialog),
    registerDialog('about', AboutDialog),
  ];
  offs.push(registerRecentDialog());
  return () => offs.forEach((o) => o());
}

export { ConfirmDialog, AboutDialog, NewProjectDialog, SettingsDialog, ShortcutsDialog };
