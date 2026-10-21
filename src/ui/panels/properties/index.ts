/** Registration entry point of the properties panel and the diagram-options dialog (imported by `src/ui/register.ts`); both load lazily. */
import { registerDialog } from '../../dialogs/registry';
import { registerPanel } from '../../shell/slots';
import { lazyDialog, lazyPanel } from '../../dialogs/content/lazy';

registerPanel('properties', lazyPanel(() => import('./PropertiesPanel').then((m) => ({ default: m.PropertiesPanel }))));
registerDialog('diagram-options', lazyDialog(() => import('./DiagramForm').then((m) => ({ default: m.DiagramOptionsDialog })), { titleKey: 'properties.diagram.dialogTitle', size: 'md' }));
