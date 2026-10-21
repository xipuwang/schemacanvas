import { useRef } from 'react';

export interface ResizerProps {
  /** `vertical` = a vertical divider that resizes a width; `horizontal` = a horizontal divider that resizes a height. */
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  /** The dock grows when the divider moves toward the START (right dock / bottom dock). */
  invert?: boolean;
  onReset?: () => void;
  className?: string;
}

/** Draggable + keyboard-operable splitter (WAI-ARIA window splitter): arrows ±16px (Shift ±48), Home/End, double-click resets. */
export function Resizer({ orientation, value, min, max, onChange, label, invert, onReset, className }: ResizerProps) {
  const drag = useRef<{ start: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)));
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`shell-resizer shell-resizer-${orientation}${className ? ` ${className}` : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: vertical ? e.clientX : e.clientY, value };
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const delta = (vertical ? e.clientX : e.clientY) - d.start;
        onChange(clamp(d.value + (invert ? -delta : delta)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => onReset?.()}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        const growKey = vertical ? (invert ? 'ArrowLeft' : 'ArrowRight') : invert ? 'ArrowUp' : 'ArrowDown';
        const shrinkKey = vertical ? (invert ? 'ArrowRight' : 'ArrowLeft') : invert ? 'ArrowDown' : 'ArrowUp';
        if (e.key === growKey) onChange(clamp(value + step));
        else if (e.key === shrinkKey) onChange(clamp(value - step));
        else if (e.key === 'Home') onChange(min);
        else if (e.key === 'End') onChange(max);
        else return;
        e.preventDefault();
      }}
    />
  );
}
