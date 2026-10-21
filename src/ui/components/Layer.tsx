import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start' | 'top' | 'bottom';

interface Pos {
  left: number;
  top: number;
  maxHeight?: number;
}

const GAP = 4;
const MARGIN = 8;

/** Compute a fixed position next to `anchor` (or at a point), flipping and clamping to the viewport. */
export function computePosition(
  anchor: { left: number; top: number; right: number; bottom: number },
  size: { width: number; height: number },
  placement: Placement,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): Pos {
  let left: number;
  let top: number;
  const [side, align] = placement.split('-') as [string, string | undefined];
  if (side === 'right' || side === 'left') {
    left = side === 'right' ? anchor.right + GAP : anchor.left - size.width - GAP;
    top = anchor.top;
    if (side === 'right' && left + size.width > viewport.width - MARGIN) left = anchor.left - size.width - GAP;
    if (side === 'left' && left < MARGIN) left = anchor.right + GAP;
  } else {
    left = align === 'end' ? anchor.right - size.width : align === 'start' ? anchor.left : (anchor.left + anchor.right) / 2 - size.width / 2;
    top = side === 'top' ? anchor.top - size.height - GAP : anchor.bottom + GAP;
    if (side === 'bottom' && top + size.height > viewport.height - MARGIN && anchor.top - size.height - GAP > MARGIN) top = anchor.top - size.height - GAP;
    if (side === 'top' && top < MARGIN && anchor.bottom + size.height + GAP < viewport.height - MARGIN) top = anchor.bottom + GAP;
  }
  left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN));
  const maxTop = viewport.height - Math.min(size.height, viewport.height - 2 * MARGIN) - MARGIN;
  top = Math.max(MARGIN, Math.min(top, maxTop));
  return { left, top, maxHeight: viewport.height - 2 * MARGIN };
}

export interface LayerProps {
  /** Element (or rect source) the layer is positioned against. */
  anchorRef?: RefObject<Element | null>;
  /** Alternative to `anchorRef`: a viewport point (context menus). */
  point?: { x: number; y: number };
  placement?: Placement;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** Receives the layer element (for focus management / outside-click checks). */
  layerRef?: RefObject<HTMLDivElement | null>;
  role?: string;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  sameWidth?: boolean;
}

/** A body-level portal positioned in fixed coordinates; measures itself, then places itself without flicker. */
export function Layer({ anchorRef, point, placement = 'bottom-start', className, style, children, layerRef, sameWidth, ...aria }: LayerProps) {
  const inner = useRef<HTMLDivElement | null>(null);
  const ref = layerRef ?? inner;
  const [pos, setPos] = useState<Pos | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = (): void => {
      const rect = point
        ? { left: point.x, top: point.y, right: point.x, bottom: point.y }
        : anchorRef?.current?.getBoundingClientRect();
      if (!rect) return;
      const r = el.getBoundingClientRect();
      setPos(computePosition(rect, { width: r.width, height: r.height }, point ? 'bottom-start' : placement));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, point, placement, ref]);

  const width = sameWidth ? anchorRef?.current?.getBoundingClientRect().width : undefined;
  return createPortal(
    <div
      ref={ref}
      className={className}
      style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, maxHeight: pos?.maxHeight, minWidth: width, opacity: pos ? 1 : 0, pointerEvents: pos ? undefined : 'none', zIndex: 60, ...style }}
      {...aria}
    >
      {children}
    </div>,
    document.body,
  );
}
