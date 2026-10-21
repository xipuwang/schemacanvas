import { cloneElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Icon } from '../icons';
import { Layer, type Placement } from './Layer';
import { Kbd } from './Kbd';
import { cssEscape, useOutsidePress } from './focus';
import { formatShortcut } from '@/editor/commands/shortcuts';

export type MenuEntry =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: string;
      /** Platform-neutral shortcut string; displayed formatted. */
      shortcut?: string | undefined;
      disabled?: boolean;
      /** Defined = checkable item (`menuitemcheckbox`). */
      checked?: boolean | undefined;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator'; id?: string }
  | { type: 'label'; id?: string; label: string };

type ItemEntry = Extract<MenuEntry, { onSelect: () => void }>;
const isItem = (e: MenuEntry): e is ItemEntry => e.type === undefined || e.type === 'item';

export interface MenuListProps {
  entries: MenuEntry[];
  /** Called after an item ran (the popup closes), or on Escape/Tab. `restoreFocus` is false for Tab. */
  onClose: (restoreFocus: boolean) => void;
  'aria-label': string;
  /** Focus the first (or last) item on mount. Default first. */
  initialFocus?: 'first' | 'last';
}

/** The `role=menu` list: roving tabindex, arrows, Home/End, type-ahead. Rendered inside a Layer by MenuButton/ContextMenu. */
export function MenuList({ entries, onClose, initialFocus = 'first', ...aria }: MenuListProps) {
  const root = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const items = entries.filter(isItem);
  const enabled = items.filter((i) => !i.disabled);
  const [active, setActive] = useState<string | undefined>(() => (initialFocus === 'last' ? enabled[enabled.length - 1]?.id : enabled[0]?.id));

  useEffect(() => {
    (root.current?.querySelector<HTMLElement>('[tabindex="0"]') ?? root.current)?.focus();
  }, []);

  const move = (id: string | undefined): void => {
    if (!id) return;
    setActive(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-item-id="${cssEscape(id)}"]`)?.focus());
    // synchronous attempt as well (rAF is only a fallback after the tabindex re-render)
    root.current?.querySelector<HTMLElement>(`[data-item-id="${cssEscape(id)}"]`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const idx = enabled.findIndex((i) => i.id === active);
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(enabled[(idx + 1) % enabled.length]?.id);
        return;
      case 'ArrowUp':
        e.preventDefault();
        move(enabled[(idx - 1 + enabled.length) % enabled.length]?.id);
        return;
      case 'Home':
        e.preventDefault();
        move(enabled[0]?.id);
        return;
      case 'End':
        e.preventDefault();
        move(enabled[enabled.length - 1]?.id);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onClose(true);
        return;
      case 'Tab':
        e.preventDefault();
        onClose(false);
        return;
      default:
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + e.key.toLowerCase(), at: now };
      const start = typed.current.text.length > 1 ? idx : idx + 1;
      const order = [...enabled.slice(Math.max(start, 0)), ...enabled.slice(0, Math.max(start, 0))];
      const hit = order.find((i) => i.label.toLowerCase().startsWith(typed.current.text));
      if (hit) move(hit.id);
    }
  };

  const run = (item: ItemEntry): void => {
    if (item.disabled) return;
    onClose(true);
    // run after the menu unmounted & focus returned so dialogs opened by the item capture the right return target
    setTimeout(() => item.onSelect(), 0);
  };

  return (
    <div ref={root} role="menu" tabIndex={-1} className="sc-menu" onKeyDown={onKeyDown} {...aria}>
      {entries.map((entry, i) => {
        if (entry.type === 'separator') return <div key={entry.id ?? `sep${i}`} role="separator" className="sc-menu-sep" />;
        if (entry.type === 'label') return <div key={entry.id ?? `lbl${i}`} role="presentation" className="sc-menu-label">{entry.label}</div>;
        const checkable = entry.checked !== undefined;
        return (
          <div
            key={entry.id}
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? entry.checked : undefined}
            aria-disabled={entry.disabled || undefined}
            tabIndex={entry.id === active && !entry.disabled ? 0 : -1}
            data-item-id={entry.id}
            className={`sc-menu-item${entry.danger ? ' is-danger' : ''}${entry.disabled ? ' is-disabled' : ''}`}
            onPointerMove={() => !entry.disabled && active !== entry.id && move(entry.id)}
            onClick={() => run(entry)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                run(entry);
              }
            }}
          >
            <span className="sc-menu-icon">{checkable ? (entry.checked ? <Icon name="check" /> : null) : entry.icon ? <Icon name={entry.icon} /> : null}</span>
            <span className="sc-menu-text">{entry.label}</span>
            {entry.shortcut ? <Kbd>{formatShortcut(entry.shortcut)}</Kbd> : null}
          </div>
        );
      })}
    </div>
  );
}

export interface MenuButtonProps {
  /** The trigger element; receives ref, aria-haspopup, aria-expanded and click/keyboard handlers. */
  trigger: ReactElement<Record<string, unknown>>;
  /** Entries, or a function evaluated each time the menu opens/re-renders (for live enabled state). */
  entries: MenuEntry[] | (() => MenuEntry[]);
  label: string;
  placement?: Placement;
}

export function MenuButton({ trigger, entries, label, placement = 'bottom-start' }: MenuButtonProps) {
  const [open, setOpen] = useState<null | 'first' | 'last'>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const layer = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const close = useCallback((restore: boolean) => {
    setOpen(null);
    if (restore) requestAnimationFrame(() => anchor.current?.focus());
  }, []);
  useOutsidePress([anchor, layer], () => setOpen(null), open !== null);

  const props = trigger.props as Record<string, ((e: unknown) => void) | undefined>;
  const el = cloneElement(trigger, {
    ref: (n: HTMLElement | null) => {
      anchor.current = n;
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open !== null,
    'aria-controls': open !== null ? menuId : undefined,
    onClick: (e: unknown) => {
      props.onClick?.(e);
      setOpen((o) => (o ? null : 'first'));
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      props.onKeyDown?.(e);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen('first');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen('last');
      }
    },
  } as never);
  const list = typeof entries === 'function' ? entries() : entries;
  return (
    <>
      {el}
      {open !== null ? (
        <Layer anchorRef={anchor} placement={placement} layerRef={layer} className="sc-menu-layer" id={menuId}>
          <MenuList entries={list} onClose={close} aria-label={label} initialFocus={open} />
        </Layer>
      ) : null}
    </>
  );
}

export interface ContextMenuProps {
  /** Viewport point where the menu opens. */
  point: { x: number; y: number };
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
}

/** Controlled context menu: render it while open; it closes on item run, Escape, Tab or an outside press. */
export function ContextMenu({ point, entries, label, onClose }: ContextMenuProps) {
  const layer = useRef<HTMLDivElement | null>(null);
  const previous = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  useOutsidePress([layer], onClose);
  useEffect(() => {
    const prev = previous.current;
    return () => {
      if (prev?.isConnected) prev.focus();
    };
  }, []);
  return (
    <Layer point={point} layerRef={layer} className="sc-menu-layer">
      <MenuList entries={entries} onClose={() => onClose()} aria-label={label} />
    </Layer>
  );
}

/** Convenience: `{ open(e), element }` for components that show one context menu. */
export function useContextMenu(entries: MenuEntry[] | (() => MenuEntry[]), label: string): { onContextMenu: (e: React.MouseEvent) => void; element: ReactNode; openAt: (x: number, y: number) => void } {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      const target = e.currentTarget as HTMLElement;
      if (e.clientX === 0 && e.clientY === 0) {
        const r = target.getBoundingClientRect();
        setPoint({ x: r.left + 8, y: r.bottom });
      } else setPoint({ x: e.clientX, y: e.clientY });
    },
    openAt: (x, y) => setPoint({ x, y }),
    element: point ? <ContextMenu point={point} entries={typeof entries === 'function' ? entries() : entries} label={label} onClose={() => setPoint(null)} /> : null,
  };
}

export type { RefObject };
