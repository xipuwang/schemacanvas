import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useT } from '@/i18n';
import { uiStore, useUi, type ToastMessage } from '../uiStore';
import { Icon } from '../icons';
import { Button, IconButton } from './Button';

const ICON: Record<ToastMessage['kind'], string> = { info: 'info', success: 'check', warning: 'warning', error: 'error' };

function Toast({ toast }: { toast: ToastMessage }) {
  const t = useT();
  // hovering or focusing inside the toast (its action button) pauses the auto-dismiss timer
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.ttl <= 0 || paused) return;
    const h = setTimeout(() => uiStore.getState().dismissToast(toast.id), toast.ttl);
    return () => clearTimeout(h);
  }, [toast.id, toast.ttl, paused]);
  return (
    <div
      className={`sc-toast sc-toast-${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={ICON[toast.kind]} />
      <span className="sc-toast-text">{toast.message}</span>
      {toast.action ? (
        <Button
          size="sm"
          variant="ghost"
          className="sc-toast-action"
          onClick={() => {
            uiStore.getState().dismissToast(toast.id);
            toast.action?.onSelect();
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton label={t('ui.dismiss')} icon="close" size="sm" noTooltip onClick={() => uiStore.getState().dismissToast(toast.id)} />
    </div>
  );
}

/**
 * While a dialog is open the toasts must not sit on its footer actions: use the bottom edge when the space below the
 * dialog fits the stack, else the top edge when the space above does, else the top edge (covering the title, never the actions).
 */
function useToastPlacement(host: RefObject<HTMLDivElement | null>, active: boolean, count: number): 'bottom' | 'top' {
  const [placement, setPlacement] = useState<'bottom' | 'top'>('bottom');
  useLayoutEffect(() => {
    if (!active) {
      setPlacement('bottom');
      return;
    }
    const measure = (): void => {
      const dialog = document.querySelector('.sc-dialog');
      const el = host.current;
      if (!dialog || !el) return;
      const d = dialog.getBoundingClientRect();
      const h = el.getBoundingClientRect().height + 8;
      const status = parseFloat(getComputedStyle(el).getPropertyValue('--status-h')) || 26;
      const below = window.innerHeight - d.bottom - (status + 12);
      const above = d.top - 8;
      setPlacement(below >= h ? 'bottom' : above >= h ? 'top' : 'top');
    };
    measure();
    const timer = setTimeout(measure, 200); // after the dialog's entrance animation
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, [host, active, count]);
  return placement;
}

/** Renders `uiStore.toasts` in a polite live region (errors use role=alert, which is assertive). */
export function ToastHost() {
  const toasts = useUi((s) => s.toasts);
  const dialogOpen = useUi((s) => s.dialog !== null);
  const host = useRef<HTMLDivElement>(null);
  const placement = useToastPlacement(host, dialogOpen && toasts.length > 0, toasts.length);
  return (
    <div ref={host} className={`sc-toasts${placement === 'top' ? ' is-top' : ''}`} aria-live="polite" aria-relevant="additions">
      {toasts.map((x) => (
        <Toast key={x.id} toast={x} />
      ))}
    </div>
  );
}
