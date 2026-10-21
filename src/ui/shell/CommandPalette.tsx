import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { commandContext, formatShortcut, isCommandEnabled, listCommands, runCommand, type Command } from '@/editor';
import { t, useT } from '@/i18n';
import { Icon } from '../icons';
import { Kbd, trapTab, useReturnFocus, useScrollLock } from '../components';
import { shellStore, useShell } from './shellStore';
import { fuzzyScore } from './fuzzy';
import { FILE_MENU } from './Toolbar';

const firstShortcut = (c: Command): string | undefined => (c.shortcut === undefined ? undefined : Array.isArray(c.shortcut) ? c.shortcut[0] : c.shortcut);

export function searchCommands(query: string): Command[] {
  const scored = listCommands()
    .filter((c) => c.id !== 'palette.open' && isCommandEnabled(c.id))
    .map((c) => ({ c, label: t(c.labelKey), score: 0 }));
  // the File menu words some commands differently ("Import SQL or DBML…"): those wordings find the command too
  const menuWording = new Map(FILE_MENU.flatMap((e) => (e === 'separator' ? [] : [[e.command, t(e.label)] as const])));
  for (const item of scored) {
    const alias = menuWording.get(item.c.id);
    item.score = Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.c.id) - 20, alias ? fuzzyScore(query, alias) - 5 : -1);
  }
  return scored
    .filter((x) => x.score >= 0 && (query.trim() === '' || x.score > 0))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .map((x) => x.c);
}

export function CommandPalette() {
  const open = useShell((s) => s.paletteOpen);
  return open ? <PaletteBody /> : null;
}

function PaletteBody() {
  const tr = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useScrollLock();
  useReturnFocus();
  useEffect(() => input.current?.focus(), []);
  const results = useMemo(() => searchCommands(query), [query]);
  const close = (): void => shellStore.getState().setPalette(false);
  const run = (c: Command | undefined): void => {
    if (!c) return;
    close();
    setTimeout(() => void runCommand(c.id), 0);
  };
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [index, results]);
  const active = results[Math.min(index, results.length - 1)];
  const ctx = commandContext();
  return createPortal(
    <div className="sc-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={tr('shell.palette.label')}
        className="shell-palette"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          } else if (root.current) trapTab(e, root.current);
        }}
      >
        <div className="shell-palette-input">
          <Icon name="search" />
          <input
            ref={input}
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={results.length ? 'palette-list' : undefined}
            aria-autocomplete="list"
            aria-activedescendant={active ? `palette-${active.id}` : undefined}
            aria-label={tr('shell.palette.input')}
            placeholder={tr('shell.palette.placeholder')}
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                run(active);
              }
            }}
          />
        </div>
        {results.length === 0 ? (
          <p className="shell-palette-empty" role="status">
            {tr('shell.palette.none')}
          </p>
        ) : null}
        <div ref={listRef} id="palette-list" role="listbox" aria-label={tr('shell.palette.results')} className="shell-palette-list" hidden={results.length === 0}>
          {results.map((c, i) => {
            const sc = firstShortcut(c);
            return (
              <div key={c.id} id={`palette-${c.id}`} role="option" aria-selected={i === Math.min(index, results.length - 1)} className="shell-palette-item" onPointerMove={() => setIndex(i)} onClick={() => run(c)}>
                <span className="sc-menu-icon">{c.icon ? <Icon name={c.icon} /> : null}</span>
                <span className="sc-menu-text">{t(c.labelKey)}</span>
                <span className="shell-palette-group">{tr(`shell.group.${c.group}`)}</span>
                {sc ? <Kbd>{formatShortcut(sc)}</Kbd> : null}
                {c.isChecked?.(ctx) ? <Icon name="check" size={14} /> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
