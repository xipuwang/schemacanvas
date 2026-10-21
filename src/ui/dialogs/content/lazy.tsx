/**
 * Lazy registration helpers (PERF-BUILD). The content dialogs and the SQL dock pull in the SQL/DBML parsers, the
 * converter, the example catalogue and the export pipeline; none of that is needed to draw the empty app, so each
 * kind is registered as a thin wrapper that loads its module on first use (`React.lazy` + `Suspense`).
 *
 * Loading shows the real `<Dialog>` frame (same title and size as the loaded dialog, so nothing jumps) with a spinner;
 * a failed chunk load (offline, stale deploy) shows the same frame with an error and a Retry that re-imports.
 */
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { useT } from '@/i18n';
import { Button, Dialog, EmptyState, Spinner } from '../../components';
import type { DialogComponentProps } from '../registry';

type Loader<P> = () => Promise<{ default: ComponentType<P> }>;

/** `React.lazy` that can be retried: every attempt re-runs the loader (a rejected dynamic import is not cached by the browser). */
function retryable<P>(load: Loader<P>): { make: () => ComponentType<P> } {
  return { make: () => lazy(load) as unknown as ComponentType<P> };
}

class Boundary extends Component<{ fallback: (retry: () => void) => ReactNode; onRetry: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return this.props.fallback(() => {
      this.props.onRetry();
      this.setState({ failed: false });
    });
  }
}

type Size = 'sm' | 'md' | 'lg' | 'xl';
/** What the loading frame needs to look exactly like the loaded dialog (same title, size and CSS classes). */
export interface FrameSpec {
  titleKey: string;
  size: Size;
  className?: string;
  bodyClassName?: string;
}

function Frame({ spec, onClose, state, onRetry }: { spec: FrameSpec; onClose: () => void; state: 'loading' | 'error'; onRetry?: () => void }) {
  const { titleKey, size, className, bodyClassName } = spec;
  const t = useT();
  return (
    <Dialog
      title={t(titleKey)}
      size={size}
      className={className}
      bodyClassName={bodyClassName}
      onClose={onClose}
      footer={
        state === 'error' ? (
          <>
            <Button onClick={onClose}>{t('common.close')}</Button>
            <Button variant="primary" onClick={onRetry}>{t('lazyload.retry')}</Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('common.cancel')}</Button>
        )
      }
    >
      <div style={{ minHeight: size === 'xl' ? 360 : 160, display: 'grid', placeItems: 'center' }} data-testid={`lazy-${state}`}>
        {state === 'error' ? <EmptyState icon="warning" title={t('lazyload.failedTitle')} description={t('lazyload.failedDesc')} /> : <Spinner size={24} />}
      </div>
    </Dialog>
  );
}

/** A dialog component whose module loads on first render. `spec` describes the frame shown meanwhile. */
export function lazyDialog(load: Loader<DialogComponentProps>, spec: FrameSpec): ComponentType<DialogComponentProps> {
  const r = retryable(load);
  let Loaded = r.make();
  return function LazyDialog(p: DialogComponentProps) {
    const [, bump] = useState(0);
    const L = Loaded;
    return (
      <Boundary
        onRetry={() => {
          Loaded = r.make();
          bump((n) => n + 1);
        }}
        fallback={(retry) => <Frame spec={spec} onClose={p.onClose} state="error" onRetry={retry} />}
      >
        <Suspense fallback={<Frame spec={spec} onClose={p.onClose} state="loading" />}>
          <L {...p} />
        </Suspense>
      </Boundary>
    );
  };
}

/** The bottom-dock variant: a spinner (or error + Retry) in the dock body. */
export function lazyDock(load: Loader<Record<string, never>>): ComponentType {
  const r = retryable(load);
  let Loaded = r.make();
  return function LazyDock() {
    const [, bump] = useState(0);
    const t = useT();
    const L = Loaded;
    return (
      <Boundary
        onRetry={() => {
          Loaded = r.make();
          bump((n) => n + 1);
        }}
        fallback={(retry) => (
          <EmptyState icon="warning" title={t('lazyload.failedTitle')} description={t('lazyload.failedDesc')} actions={<Button variant="primary" onClick={retry}>{t('lazyload.retry')}</Button>} />
        )}
      >
        <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', height: '100%' }} data-testid="lazy-loading"><Spinner size={20} /></div>}>
          <L />
        </Suspense>
      </Boundary>
    );
  };
}

/** Same as `lazyDock`, for the side panels (library / properties). */
export const lazyPanel = lazyDock;
