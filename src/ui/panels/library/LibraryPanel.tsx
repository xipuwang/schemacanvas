import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { LIBRARY_MIME, canvasUiStore, commandContext, encodeLibraryItem, useArmedItem, useCommand, type LibraryItem } from '@/editor';
import { useEditorStore } from '@/store';
import { useSettings } from '@/store/settings';
import { useT } from '@/i18n';
import { Icon } from '../../icons';
import { Tooltip } from '../../components';
import { useResolvedTheme } from '../../theme/useResolvedTheme';
import { collapseStore, useCollapsed } from './collapse';
import { librarySections, partMatches, sameItem, type PartDef, type SectionDef } from './items';
import { previewFor } from './previews';
import type { DiagramType } from '@/model/types';
import './library.css';

function PartPreview({ part, type }: { part: PartDef; type: DiagramType }) {
  const theme = useResolvedTheme();
  const locale = useSettings((s) => s.locale);
  const preview = useMemo(() => previewFor(part.preview, type, theme, locale), [part.preview, type, theme, locale]);
  if (!preview) return <div className="lib-preview lib-preview-missing" aria-hidden="true" />;
  return <div className="lib-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: preview.svg }} />;
}

const TOOLS: Array<{ id: 'select' | 'hand' | 'connect' | 'fk'; icon: string; labelKey: string; descKey: string; only?: 'er' | 'relational'; shortcut?: string }> = [
  { id: 'select', icon: 'pointer', labelKey: 'library.tool.select', descKey: 'library.tool.select.desc', shortcut: 'V' },
  { id: 'hand', icon: 'hand', labelKey: 'library.tool.hand', descKey: 'library.tool.hand.desc', shortcut: 'H' },
  { id: 'connect', icon: 'link', labelKey: 'library.tool.connect', descKey: 'library.tool.connect.desc', only: 'er' },
  { id: 'fk', icon: 'key', labelKey: 'library.tool.fk', descKey: 'library.tool.fk.desc', only: 'relational' },
];

function ToolButton({ tool }: { tool: (typeof TOOLS)[number] }) {
  const t = useT();
  const cmd = useCommand(`tool.${tool.id}`);
  const active = useEditorStore((s) => s.tool) === tool.id;
  const missing = !cmd.command;
  const label = t(tool.labelKey);
  const button = (
    <button
      type="button"
      className={`lib-tool${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-disabled={missing || !cmd.enabled || undefined}
      data-tool={tool.id}
      onClick={() => {
        if (!missing && cmd.enabled) cmd.run();
      }}
    >
      <Icon name={tool.icon} />
      <span>{label}</span>
    </button>
  );
  return (
    <Tooltip label={missing ? t('library.tool.unavailable', { name: label }) : `${label}. ${t(tool.descKey)}`} shortcut={missing ? undefined : tool.shortcut} placement="right-start" describe={false}>
      {button}
    </Tooltip>
  );
}

function nextFocusTarget(items: HTMLElement[], from: HTMLElement, key: string): HTMLElement | undefined {
  const i = items.indexOf(from);
  if (i < 0) return items[0];
  if (key === 'Home') return items[0];
  if (key === 'End') return items[items.length - 1];
  if (key === 'ArrowRight') return items[Math.min(items.length - 1, i + 1)];
  if (key === 'ArrowLeft') return items[Math.max(0, i - 1)];
  // vertical: nearest item in the next/previous visual row, else the neighbour in reading order
  const top = from.offsetTop;
  const left = from.offsetLeft;
  const down = key === 'ArrowDown';
  const rows = items.filter((el) => (down ? el.offsetTop > top + 2 : el.offsetTop < top - 2));
  if (rows.length === 0) return down ? items[Math.min(items.length - 1, i + 1)] : items[Math.max(0, i - 1)];
  const rowTop = down ? Math.min(...rows.map((el) => el.offsetTop)) : Math.max(...rows.map((el) => el.offsetTop));
  const row = rows.filter((el) => el.offsetTop === rowTop);
  return row.reduce((best, el) => (Math.abs(el.offsetLeft - left) < Math.abs(best.offsetLeft - left) ? el : best), row[0]!);
}

function Section({ section, type, query, armed, focusId, setFocusId }: { section: SectionDef; type: DiagramType; query: string; armed: LibraryItem | null; focusId: string | undefined; setFocusId: (id: string) => void }) {
  const t = useT();
  const collapsed = useCollapsed();
  const parts = section.parts.filter((p) => partMatches(p, t(p.labelKey), query));
  if (parts.length === 0) return null;
  const searching = query.trim() !== '';
  const open = searching || !collapsed.includes(section.id);
  const bodyId = `lib-section-${section.id}`;
  return (
    <section className="lib-section" data-section={section.id}>
      <h3 className="lib-section-title">
        <button type="button" className="lib-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => !searching && collapseStore.getState().toggle(section.id)}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          <span>{t(section.titleKey)}</span>
          <span className="lib-section-count">{parts.length}</span>
        </button>
      </h3>
      {open ? (
        <div id={bodyId} className="lib-grid">
          {parts.map((p) => (
            <PartButton key={p.id} part={p} type={type} armed={sameItem(armed, p.item)} tabbable={focusId === p.id} onFocusItem={() => setFocusId(p.id)} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function arm(item: LibraryItem | null): void {
  commandContext().canvas?.armItem(item);
  // keep the store in step even when no canvas handle is mounted (tests, drawers while the canvas is hidden)
  if (!commandContext().canvas) canvasUiStore.setState({ armedItem: item });
}

/**
 * Commit an open inline name editor on pointerdown, before the mousedown that may start a drag. Letting the input's
 * blur fire during the mousedown re-renders mid-gesture and Chromium then never dispatches `dragstart`.
 */
function commitPendingInlineEdit(): void {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement && el.classList.contains('sc-inline-input')) el.blur();
}

function PartButton({ part, type, armed, tabbable, onFocusItem }: { part: PartDef; type: DiagramType; armed: boolean; tabbable: boolean; onFocusItem: () => void }) {
  const t = useT();
  const label = t(part.labelKey);
  const onDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(LIBRARY_MIME, encodeLibraryItem(part.item));
    e.dataTransfer.setData('text/plain', label);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <Tooltip label={t(part.descKey)} placement="right-start" describe={false} delay={700}>
      <button
        type="button"
        draggable
        data-lib-item
        data-part-id={part.id}
        className={`lib-item${part.wide ? ' is-wide' : ''}${armed ? ' is-armed' : ''}`}
        aria-pressed={armed}
        tabIndex={tabbable ? 0 : -1}
        onFocus={onFocusItem}
        onPointerDownCapture={commitPendingInlineEdit}
        onDragStart={onDragStart}
        onClick={() => arm(armed ? null : part.item)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && armed) {
            e.stopPropagation();
            arm(null);
          }
        }}
      >
        <PartPreview part={part} type={type} />
        <span className="lib-item-label">{label}</span>
      </button>
    </Tooltip>
  );
}

export function LibraryPanel() {
  const t = useT();
  const diagramType = useEditorStore((s) => (s.activeDiagramId ? s.project.diagrams[s.activeDiagramId]?.type : undefined));
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const armed = useArmedItem();
  const [query, setQuery] = useState('');
  const [focusId, setFocusId] = useState<string | undefined>(undefined);
  const root = useRef<HTMLDivElement>(null);

  // an armed item belongs to one diagram type: drop it when the sheet changes
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    arm(null);
  }, [diagramId]);

  const sections = useMemo(() => (diagramType ? librarySections(diagramType) : []), [diagramType]);
  const visibleIds = sections.flatMap((s) => s.parts.filter((p) => partMatches(p, t(p.labelKey), query)).map((p) => p.id));
  const tabbableId = focusId && visibleIds.includes(focusId) ? focusId : visibleIds[0];
  const armedPart = armed ? sections.flatMap((s) => s.parts).find((p) => sameItem(p.item, armed)) : undefined;

  if (!diagramType) {
    return (
      <div className="lib">
        <p className="lib-hint">{t('library.noDiagram')}</p>
      </div>
    );
  }
  const kind = diagramType === 'chen' ? 'er' : 'relational';
  const tools = TOOLS.filter((x) => !x.only || x.only === kind);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (!target.matches('[data-lib-item]')) return;
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-lib-item]') ?? []);
    const next = nextFocusTarget(items, target, e.key);
    if (!next) return;
    e.preventDefault();
    setFocusId(next.dataset.partId);
    next.focus();
  };

  return (
    <div className="lib" ref={root} onKeyDown={onKeyDown}>
      <div className="lib-head">
        <div className="lib-search">
          <Icon name="search" size={14} />
          <input
            type="search"
            className="lib-search-input"
            aria-label={t('library.search')}
            placeholder={t('library.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
          />
        </div>
        <p className="lib-hint" role="status" data-testid="library-hint">
          {armedPart ? t('library.hint.armed', { name: t(armedPart.labelKey) }) : t('library.hint')}
        </p>
      </div>

      <section className="lib-section" data-section="tools">
        <h3 className="lib-section-title lib-section-title-static">{t('library.section.tools')}</h3>
        <div className="lib-tools" role="group" aria-label={t('library.section.tools')}>
          {tools.map((tool) => (
            <ToolButton key={tool.id} tool={tool} />
          ))}
        </div>
      </section>

      {sections.map((s) => (
        <Section key={s.id} section={s} type={diagramType} query={query} armed={armed} focusId={tabbableId} setFocusId={setFocusId} />
      ))}
      {query.trim() && visibleIds.length === 0 ? <p className="lib-empty">{t('library.noMatches', { query: query.trim() })}</p> : null}
    </div>
  );
}
