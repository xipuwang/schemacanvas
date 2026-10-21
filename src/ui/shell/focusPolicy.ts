/**
 * Central focus-return policy. Dialogs / the palette restore focus to their opener (`useReturnFocus`); this watchdog
 * covers everything else: when the focused control disappears or becomes disabled (a panel link whose target selection
 * changed, a button disabled by the action it just ran) browsers drop focus to <body>, so the next Tab restarts at the
 * skip link. We move focus to a sensible fallback instead: the dock the control lived in, else the canvas.
 * Pointer interactions clear the memory, so clicking on empty space never makes focus jump.
 */
import { focusCanvasSoon } from '../components';

const MODAL = '[role="dialog"],[role="menu"],[role="alertdialog"],.sc-dialog-backdrop';

interface Remembered {
  el: HTMLElement;
  /** The dock / drawer the element was inside (stays mounted when the panel content changes). */
  region: HTMLElement | null;
}

/** How long focus must stay on <body> before the fallback moves it. */
export const SETTLE_MS = 350;

export function fallbackFocusTarget(r: Remembered | null): HTMLElement | null {
  if (r?.region && r.region.isConnected) return r.region;
  return null;
}

export function startFocusPolicy(root: Document = document): () => void {
  let last: Remembered | null = null;
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  const onFocusIn = (e: FocusEvent): void => {
    const el = e.target as HTMLElement | null;
    if (!el || el === root.body || el.closest(MODAL)) {
      last = null;
      return;
    }
    last = { el, region: el.closest<HTMLElement>('[data-testid^="dock-"],.shell-drawer') };
  };
  const onPointerDown = (): void => {
    last = null; // a following focusin (the clicked control) re-arms it
  };
  const check = (): void => {
    scheduled = undefined;
    const r = last;
    if (!r) return;
    const a = root.activeElement;
    if (a && a !== root.body) return;
    const gone = !r.el.isConnected || (r.el as HTMLButtonElement).disabled || r.el.getAttribute('aria-disabled') === 'true';
    if (!gone) return;
    if (root.querySelector(MODAL)) return;
    last = null;
    const region = fallbackFocusTarget(r);
    if (region) {
      if (region.getAttribute('tabindex') === null) region.setAttribute('tabindex', '-1');
      region.focus({ preventScroll: true });
    } else focusCanvasSoon();
  };
  const schedule = (): void => {
    if (scheduled !== undefined || !last) return;
    // wait out the follow-up UI the action may start (an inline rename field mounts a few frames later and takes focus itself)
    scheduled = setTimeout(check, SETTLE_MS);
  };
  const mo = new MutationObserver(schedule);
  mo.observe(root.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', schedule);
  root.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    mo.disconnect();
    root.removeEventListener('focusin', onFocusIn);
    root.removeEventListener('focusout', schedule);
    root.removeEventListener('pointerdown', onPointerDown, true);
    if (scheduled !== undefined) clearTimeout(scheduled);
  };
}
