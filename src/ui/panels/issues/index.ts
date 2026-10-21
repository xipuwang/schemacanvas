import { registerDock } from '../../shell/slots';
import { lazyDock } from '../../dialogs/content/lazy';

registerDock('issues', lazyDock(() => import('./IssuesDock').then((m) => ({ default: m.IssuesDock }))));
