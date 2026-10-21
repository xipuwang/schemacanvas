import { useId, useRef, type ReactNode } from 'react';
import { cssEscape } from './focus';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Plain-text name when `label` is not a string. */
  ariaLabel?: string;
  disabled?: boolean;
  panel?: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
  /** Render panels (default true). Only the active one is mounted. */
  renderPanels?: boolean;
}

/** Roving-tabindex tabs (automatic activation): arrows move + select, Home/End jump. */
export function Tabs({ items, value, onChange, label, className, renderPanels = true }: TabsProps) {
  const base = useId();
  const list = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);
  const onKeyDown = (e: React.KeyboardEvent): void => {
    const i = enabled.findIndex((t) => t.id === value);
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    const id = enabled[next]!.id;
    onChange(id);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab-id="${cssEscape(id)}"]`)?.focus());
  };
  const active = items.find((i) => i.id === value);
  return (
    <div className={`sc-tabs${className ? ` ${className}` : ''}`}>
      <div ref={list} role="tablist" aria-label={label} className="sc-tablist" onKeyDown={onKeyDown}>
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            data-tab-id={t.id}
            aria-selected={t.id === value}
            aria-controls={renderPanels && t.id === value ? `${base}-panel-${t.id}` : undefined}
            aria-label={t.ariaLabel}
            tabIndex={t.id === value ? 0 : -1}
            disabled={t.disabled}
            className={`sc-tab${t.id === value ? ' is-active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {renderPanels && active ? (
        <div role="tabpanel" id={`${base}-panel-${active.id}`} aria-labelledby={`${base}-tab-${active.id}`} tabIndex={0} className="sc-tabpanel">
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
