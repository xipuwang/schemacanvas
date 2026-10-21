import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

/** Tab / Shift+Tab wrap inside `root`. Returns true when the event was handled. */
export function trapTab(e: { key: string; shiftKey: boolean; preventDefault(): void }, root: HTMLElement): boolean {
  if (e.key !== 'Tab') return false;
  const items = focusableIn(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus();
    return true;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

let lockCount = 0;
let previousOverflow = '';

/** Reference-counted body scroll lock. */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}

const canUseFocus = (el: HTMLElement | null | undefined): el is HTMLElement =>
  !!el && el.isConnected && typeof el.focus === 'function' && !(el as HTMLButtonElement).disabled && el.getAttribute('aria-disabled') !== 'true' && el !== document.body;

/**
 * Focus the active sheet's canvas (the application region). The canvas remounts when the sheet changes, so retry for a
 * few frames; gives up silently when focus has meanwhile moved somewhere deliberate.
 */
export function focusCanvasSoon(attempts = 8): void {
  const tryFocus = (left: number): void => {
    const canvas = document.querySelector<HTMLElement>('#sheet-main [role="application"]');
    if (canvas) {
      canvas.focus({ preventScroll: true });
      if (document.activeElement === canvas) return;
    }
    if (left > 0) requestAnimationFrame(() => tryFocus(left - 1));
  };
  requestAnimationFrame(() => tryFocus(attempts));
}

/** Focus-return policy: back to the invoking element; if it vanished or is disabled, to the canvas. */
export function restoreFocusTo(previous: HTMLElement | null | undefined): void {
  if (canUseFocus(previous)) previous.focus();
  else {
    const a = document.activeElement;
    if (!a || a === document.body) focusCanvasSoon();
  }
}

/**
 * Remember the element that had focus when the component FIRST RENDERED (before any autofocus inside it moves focus) and
 * restore it on unmount, with the canvas as the fallback when it is gone or disabled.
 */
export function useReturnFocus(): void {
  const previous = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  useEffect(() => {
    const el = previous.current;
    return () => restoreFocusTo(el);
  }, []);
}

/** Calls `onOutside` for a pointerdown outside every given element. */
export function useOutsidePress(refs: Array<RefObject<Element | null>>, onOutside: (e: PointerEvent) => void, active = true): void {
  const cb = useRef(onOutside);
  cb.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent): void => {
      const target = e.target as Node | null;
      if (target && refs.some((r) => r.current?.contains(target))) return;
      cb.current(e);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** `CSS.escape` with a fallback for environments without it (jsdom). */
export const cssEscape = (value: string): string =>
  typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
