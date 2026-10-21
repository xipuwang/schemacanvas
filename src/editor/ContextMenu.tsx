import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@/i18n';
import { getCommand, runCommand, commandContext } from './commands/registry';
import { formatShortcut } from './commands/shortcuts';
import type { MenuEntry } from './plugins';

export interface ContextMenuProps {
  /** Client coordinates of the pointer. */
  x: number;
  y: number;
  entries: readonly MenuEntry[];
  onClose(): void;
}

interface Row {
  key: string;
  label: string;
  shortcut?: string;
  disabled: boolean;
  checked?: boolean;
  run(): void;
}

/** Accessible context menu: roving focus, arrows/Home/End, type-ahead, Escape/Tab/outside-click close. */
export function ContextMenu({ x, y, entries, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  const rows = useMemo(() => {
    const ctx = commandContext();
    const out: Array<Row | 'sep'> = [];
    for (const e of entries) {
      if (e.kind === 'separator') out.push('sep');
      else if (e.kind === 'item') out.push({ key: e.id, label: e.label, shortcut: e.shortcut, disabled: !!e.disabled, checked: e.checked, run: e.run });
      else {
        const c = getCommand(e.commandId);
        if (!c) continue;
        const sc = Array.isArray(c.shortcut) ? c.shortcut[0] : c.shortcut;
        out.push({
          key: c.id,
          label: t(c.labelKey),
          shortcut: sc ? formatShortcut(sc) : undefined,
          disabled: c.isEnabled ? !c.isEnabled(ctx) : false,
          checked: c.isChecked ? c.isChecked(ctx) : undefined,
          run: () => void runCommand(c.id),
        });
      }
    }
    return out;
  }, [entries]);

  const buttons = (): HTMLButtonElement[] => Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role^="menuitem"]:not(:disabled)') ?? []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const ny = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    setPos({ x: nx, y: ny });
    buttons()[0]?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  useEffect(() => {
    const onDown = (ev: PointerEvent): void => {
      if (!ref.current?.contains(ev.target as Node)) onClose();
    };
    const onBlur = (): void => onClose();
    const onScroll = (ev: Event): void => {
      if (!ref.current?.contains(ev.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('resize', onBlur);
    window.addEventListener('wheel', onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
      window.removeEventListener('wheel', onScroll, { capture: true });
    };
  }, [onClose]);

  const onKeyDown = (ev: ReactKeyEvent<HTMLDivElement>): void => {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    let handled = true;
    const focus = (n: number): void => list[(n + list.length) % list.length]?.focus({ preventScroll: true });
    switch (ev.key) {
      case 'ArrowDown':
        focus(i + 1);
        break;
      case 'ArrowUp':
        focus(i < 0 ? -1 : i - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(-1);
        break;
      case 'Escape':
      case 'Tab':
        onClose();
        break;
      case 'Enter':
      case ' ': {
        // the menu owns these keys: run the focused item (the canvas must never see them: Enter there means "rename")
        const active = document.activeElement as HTMLButtonElement | null;
        const row = active && ref.current?.contains(active) ? rows.find((r) => r !== 'sep' && r.key === active.dataset.command) : undefined;
        if (row && row !== 'sep' && !row.disabled) {
          onClose();
          row.run();
        }
        break;
      }
      default: {
        // type-ahead: first letter jumps to the next matching enabled item
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
          const ch = ev.key.toLowerCase();
          const start = i + 1;
          for (let k = 0; k < list.length; k++) {
            const b = list[(start + k) % list.length]!;
            if ((b.dataset.label ?? '').toLowerCase().startsWith(ch)) {
              b.focus({ preventScroll: true });
              break;
            }
          }
          break;
        }
        handled = false;
        break;
      }
    }
    // every key typed inside the menu stays inside it: React bubbles portal events to the canvas that owns the menu
    ev.stopPropagation();
    if (ev.ctrlKey || ev.metaKey) return;
    if (handled || ev.key === 'Enter' || ev.key === ' ') ev.preventDefault();
  };

  return createPortal(
    <div ref={ref} className="sc-menu" role="menu" aria-label={t('editor.menu.label')} style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {rows.map((r, i) =>
        r === 'sep' ? (
          <hr key={`sep${i}`} className="sc-menu__sep" role="separator" />
        ) : (
          <button
            key={r.key}
            type="button"
            className="sc-menu__item"
            role={r.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={r.checked === undefined ? undefined : r.checked}
            disabled={r.disabled}
            data-label={r.label}
            data-command={r.key}
            tabIndex={-1}
            onClick={() => {
              onClose();
              r.run();
            }}
          >
            <span className="sc-menu__check" aria-hidden="true">
              {r.checked ? '✓' : ''}
            </span>
            <span className="sc-menu__label">{r.label}</span>
            {r.shortcut && <span className="sc-menu__shortcut">{r.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
