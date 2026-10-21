import { cloneElement, useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Layer, type Placement } from './Layer';
import { Kbd } from './Kbd';
import { formatShortcut } from '@/editor/commands/shortcuts';

export interface TooltipProps {
  label: string;
  /** Platform-neutral shortcut string (`Mod+S`); shown formatted for this platform. */
  shortcut?: string | undefined;
  placement?: Placement;
  delay?: number;
  /** Link the tooltip with `aria-describedby` (off for icon buttons whose label already names them). */
  describe?: boolean;
  children: ReactElement<Record<string, unknown>>;
}

/** Hover/focus tooltip. The first tooltip waits `delay` ms; moving between tooltips within 300ms is instant. */
let lastHiddenAt = 0;

export function Tooltip({ label, shortcut, placement = 'bottom', delay = 450, describe = true, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = (immediate: boolean): void => {
    clearTimeout(timer.current);
    const wait = immediate || Date.now() - lastHiddenAt < 300 ? 0 : delay;
    timer.current = setTimeout(() => setOpen(true), wait);
  };
  const hide = (): void => {
    clearTimeout(timer.current);
    setOpen((o) => {
      if (o) lastHiddenAt = Date.now();
      return false;
    });
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const child = children;
  const props = child.props as Record<string, ((e: unknown) => void) | undefined>;
  const chain =
    (name: string, fn: () => void) =>
    (e: unknown): void => {
      props[name]?.(e);
      fn();
    };
  const el = cloneElement(child, {
    ref: (node: Element | null) => {
      anchor.current = node;
      const r = (child.props as { ref?: unknown }).ref;
      if (typeof r === 'function') r(node);
      else if (r && typeof r === 'object') (r as { current: Element | null }).current = node;
    },
    onPointerEnter: chain('onPointerEnter', () => show(false)),
    onPointerLeave: chain('onPointerLeave', hide),
    onPointerDown: chain('onPointerDown', hide),
    onFocus: chain('onFocus', () => show(false)),
    onBlur: chain('onBlur', hide),
    ...(describe && open ? { 'aria-describedby': id } : {}),
  } as never);

  return (
    <>
      {el}
      {open ? (
        <Layer anchorRef={anchor} placement={placement} className="sc-tooltip" role="tooltip" id={id}>
          <span>{label}</span>
          {shortcut ? <Kbd>{formatShortcut(shortcut)}</Kbd> : null}
        </Layer>
      ) : null}
    </>
  );
}
