/**
 * Registration entry of the content dialogs (convert, export, import, examples, sql) and the SQL dock.
 * Imported by `src/ui/register.ts`; nothing else registers these kinds.
 *
 * The dialog/dock modules are loaded on first use (`lazy.tsx`), so the SQL/DBML parsers, the converter, the example
 * catalogue and the export pipeline stay out of the entry bundle. Registration itself is still synchronous.
 */
import { registerCommand } from '@/editor';
import { uiStore } from '../../uiStore';
import { registerDialog } from '../registry';
import { registerDock } from '../../shell/slots';
import { lazyDialog, lazyDock } from './lazy';
// The dialogs' stylesheet is part of the entry so the loading frame (lazy.tsx) already has its final size and look.
import './dialogs.css';

registerDialog('convert', lazyDialog(() => import('./convert/ConvertDialog').then((m) => ({ default: m.ConvertDialog })), { titleKey: 'dialogs.convert.title', size: 'xl', className: 'dlg-convert' }));
registerDialog('export', lazyDialog(() => import('./export/ExportDialog').then((m) => ({ default: m.ExportDialog })), { titleKey: 'dialogs.export.title', size: 'xl', className: 'dlg-export' }));
registerDialog('import', lazyDialog(() => import('./import/ImportDialog').then((m) => ({ default: m.ImportDialog })), { titleKey: 'dialogs.import.title', size: 'lg', className: 'dlg-import' }));
registerDialog('examples', lazyDialog(() => import('./examples/ExamplesDialog').then((m) => ({ default: m.ExamplesDialog })), { titleKey: 'dialogs.examples.title', size: 'xl', className: 'dlg-examples' }));
registerDialog('sql', lazyDialog(() => import('./sql/SqlDialog').then((m) => ({ default: m.SqlDialog })), { titleKey: 'dialogs.sql.title', size: 'xl', className: 'dlg-sql', bodyClassName: 'dlg-body-flush' }));
registerDock('sql', lazyDock(() => import('./sql/SqlDock').then((m) => ({ default: m.SqlDock }))));

// Reachable from the View menu / command palette (the SQL tab of the bottom dock and the full dialog).
registerCommand({ id: 'view.showSql', labelKey: 'commands.view.showSql', group: 'view', icon: 'sql', run: () => uiStore.getState().setDock('sql') });
registerCommand({ id: 'file.sqlDialog', labelKey: 'commands.file.sqlDialog', group: 'file', icon: 'sql', run: () => uiStore.getState().openDialog('sql') });
