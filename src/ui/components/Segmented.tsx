import { useRef, type ReactNode } from 'react';
import { cssEscape } from './focus';
import { Icon } from '../icons';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: string;
  ariaLabel?: string;
  /** BCP-47 language of this option's text when it differs from the UI language (e.g. a language picker). */
  lang?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice radiogroup with roving tabindex (arrows move + select). */
export function SegmentedControl<T extends string>({ options, value, onChange, label, size = 'md', className }: SegmentedControlProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const i = enabled.findIndex((o) => o.value === value);
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    const v = enabled[next]!.value;
    onChange(v);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-value="${cssEscape(v)}"]`)?.focus());
  };
  return (
    <div ref={root} role="radiogroup" aria-label={label} className={`sc-seg sc-seg-${size}${className ? ` ${className}` : ''}`} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          lang={o.lang}
          disabled={o.disabled}
          tabIndex={o.value === value ? 0 : -1}
          className={`sc-seg-item${o.value === value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Icon name={o.icon} /> : null}
          {o.label !== undefined && o.label !== null ? <span>{o.label}</span> : null}
        </button>
      ))}
    </div>
  );
}
