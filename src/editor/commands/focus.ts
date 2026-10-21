/**
 * Landmark focus: `focus.properties` jumps straight to the Properties panel of the CURRENT selection, F6 / Shift+F6 cycle
 * canvas -> properties -> library. None of them touches the selection (focus is not selection), so a keyboard user can
 * edit what they selected in one key instead of Tab-walking every shape.
 */
import { commandContext, runCommand } from './registry';

type Region = 'canvas' | 'properties' | 'library';

const FOCUSABLE = 'input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';

const regionEl = (r: Region): HTMLElement | null => {
  if (typeof document === 'undefined') return null;
  if (r === 'canvas') return document.querySelector<HTMLElement>('[role="application"].sc-canvas');
  return document.querySelector<HTMLElement>(`[data-testid="dock-${r}"],[data-testid="drawer-${r}"]`);
};

const visible = (el: HTMLElement): boolean => {
  if (el.hidden || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
};

function focusIn(el: HTMLElement): boolean {
  const first = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).find(visible);
  const target = first ?? el;
  if (target === el && el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: false });
  return document.activeElement === target;
}

function currentRegion(): Region {
  const a = document.activeElement;
  for (const r of ['properties', 'library'] as const) if (a && regionEl(r)?.contains(a)) return r;
  return 'canvas';
}

/** Move focus to the next (`1`) / previous (`-1`) region that exists on screen. */
export function focusNextRegion(dir: 1 | -1): boolean {
  const order = (['canvas', 'properties', 'library'] as const).filter((r) => regionEl(r));
  if (order.length === 0) return false;
  const i = order.indexOf(currentRegion());
  const next = order[(i + dir + order.length) % order.length]!;
  if (next === 'canvas') {
    commandContext().canvas?.focus();
    return true;
  }
  return focusIn(regionEl(next)!);
}

/** Focus the first field of the Properties panel, opening the panel first when it is hidden. */
export async function focusProperties(): Promise<void> {
  if (!regionEl('properties')) {
    await runCommand('view.togglePanel.properties');
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
  const el = regionEl('properties');
  if (el) focusIn(el);
}
