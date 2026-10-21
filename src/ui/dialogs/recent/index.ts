import { registerDialog } from '../registry';
import { lazyDialog } from '../content/lazy';

/**
 * Register the Recent projects dialog (kind `recent`, command `file.recent`). Idempotent. The dialog module (and its
 * thumbnail renderer) loads on first open so it stays out of the entry bundle.
 */
export function registerRecentDialog(): () => void {
  return registerDialog(
    'recent',
    lazyDialog(() => import('./RecentDialog').then((m) => ({ default: m.RecentDialog })), { titleKey: 'shell.recent.title', size: 'lg' }),
  );
}
