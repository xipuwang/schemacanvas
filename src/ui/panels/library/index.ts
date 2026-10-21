/**
 * Registration entry point of the parts library (imported by `src/ui/register.ts`).
 * The panel (previews render through react-dom/server, templates pull in the example builders) is its own chunk, loaded
 * right away but off the entry bundle; the template inserter is registered when that chunk arrives (the user can only
 * drop a template from the panel, so it is always registered by then).
 */
import { registerTemplateInserter } from '@/editor';
import { registerPanel } from '../../shell/slots';
import { lazyPanel } from '../../dialogs/content/lazy';

const load = (): Promise<{ default: React.ComponentType<Record<string, never>> }> =>
  Promise.all([import('./LibraryPanel'), import('./templateInserter')]).then(([panel, inserter]) => {
    registerTemplateInserter(inserter.insertTemplateAt);
    return { default: panel.LibraryPanel as React.ComponentType<Record<string, never>> };
  });

registerPanel('library', lazyPanel(load));
void load().catch(() => undefined); // start downloading now; the panel's Suspense picks the same module promise up
