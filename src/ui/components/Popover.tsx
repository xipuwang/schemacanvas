import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Layer, type Placement } from './Layer';
import { trapTab, useOutsidePress, focusableIn } from './focus';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<Element | null>;
  placement?: Placement;
  /** Accessible name of the popover region. */
  label: string;
  children: ReactNode;
  className?: string;
  /** Focus the first control on open (default true). */
  autoFocus?: boolean;
}

/** Non-modal anchored panel: Escape / outside press closes and focus returns to the anchor. */
export function Popover({ open, onClose, anchorRef, placement = 'bottom-start', label, children, className, autoFocus = true }: PopoverProps) {
  const layer = useRef<HTMLDivElement | null>(null);
  useOutsidePress([layer, anchorRef], onClose, open);
  useEffect(() => {
    if (!open || !autoFocus) return;
    const el = layer.current;
    if (el) focusableIn(el)[0]?.focus();
  }, [open, autoFocus]);
  if (!open) return null;
  return (
    <Layer
      anchorRef={anchorRef}
      placement={placement}
      layerRef={layer}
      role="dialog"
      aria-label={label}
      className={`sc-popover${className ? ` ${className}` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          (anchorRef.current as HTMLElement | null)?.focus();
        } else if (layer.current) trapTab(e, layer.current);
      }}
    >
      {children}
    </Layer>
  );
}
