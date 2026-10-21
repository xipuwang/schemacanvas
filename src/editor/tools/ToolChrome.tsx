/**
 * Chrome the tools add to the canvas: the tool hint chip, the aria-live region, the FK mapping popover and the
 * add-attribute flavour menu. Rendered from a plugin overlay; the DOM parts are portalled into the canvas container /
 * document body, so the SVG overlay stays pure SVG.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { t, useT } from '@/i18n';
import { relationalModelOf } from '@/model/queries';
import type { Id, Project } from '@/model/types';
import { editorStore, useEditorStore } from '@/store';
import { Button, ContextMenu, Popover, Select } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { uiStore } from '@/ui/uiStore';
import { commandContext } from '../commands/registry';
import { addAttributeTo, flavorsFor, ownerOfNode, type AttrFlavor } from './attributes';
import { createForeignKey } from './fkCommit';
import { describePairs, pairTypeNote, pairsOf, remapTarget, type KeyCandidate } from './fkLogic';
import { nodeName } from './names';
import { announce, setToolUi, useToolUi, type FkPopoverState } from './toolState';
import './tools.css';

const keyLabel = (tt: (k: string, p?: Record<string, string | number>) => string, project: Project, relationId: Id, key: KeyCandidate, modelId: Id): string => {
  const model = project.models[modelId];
  const rel = model?.kind === 'relational' ? model.relations[relationId] : undefined;
  const cols = key.columnIds.map((id) => rel?.columns.find((c) => c.id === id)?.name ?? '?').join(', ');
  if (key.kind === 'primary') return tt('editorTools.fk.key.primary', { columns: cols });
  return tt(key.kind === 'unique' ? 'editorTools.fk.key.unique' : 'editorTools.fk.key.index', { columns: cols });
};

/**
 * The overlay is rendered INSIDE the canvas `<svg>`, and React synthetic events bubble through portals to React ancestors:
 * without this guard a pointer press on the popover / menu would reach the canvas' own handlers (which capture the pointer,
 * swallowing the click, and clear the selection) and Tab / Enter would be taken by the canvas keyboard handling.
 */
function EventGuard({ children }: { children: ReactNode }): ReactNode {
  const stop = (e: SyntheticEvent): void => e.stopPropagation();
  return createPortal(
    <div style={{ display: 'contents' }} onPointerDown={stop} onPointerUp={stop} onPointerMove={stop} onMouseDown={stop} onMouseUp={stop} onClick={stop} onDoubleClick={stop} onContextMenu={stop} onKeyDown={stop} onKeyUp={stop}>
      {children}
    </div>,
    document.body,
  );
}

// ---- FK mapping popover --------------------------------------------------------------------------------------------

function FkPopover({ state, anchorRef }: { state: FkPopoverState; anchorRef: RefObject<Element | null> }) {
  const tt = useT();
  const project = useEditorStore((s) => s.project);
  const [keyIndex, setKeyIndex] = useState(state.keyIndex);
  const [targets, setTargets] = useState<Id[]>(state.targetColumnIds);
  const confirm = useRef<HTMLButtonElement>(null);
  const model = relationalModelOf(project, project.diagrams[state.diagramId]!);
  const source = model?.relations[state.source.relationId];
  const target = model?.relations[state.targetRelationId];

  useEffect(() => {
    // Enter confirms right away: the mapping is already the best guess, the popover is the safety net
    confirm.current?.focus();
  }, []);

  if (!model || !source || !target) return null;
  const key = state.keys[keyIndex]!;
  const pairs = pairsOf(state.source.columnIds, targets);
  const text = describePairs(model, source.id, target.id, pairs);

  const close = (): void => {
    setToolUi({ fkPopover: null, fkPending: null });
    commandContext().canvas?.focus();
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const out = createForeignKey(editorStore, state.diagramId, source.id, target.id, pairs);
    setToolUi({ fkPopover: null, fkPending: null });
    if (out.ok) {
      announce(t('editorTools.announce.fkCreated', { text: out.text }));
      uiStore.getState().pushToast({ kind: 'success', message: t('editorTools.toast.fkCreated', { text: out.text }) });
    } else uiStore.getState().pushToast({ kind: 'error', message: t('editorTools.toast.fkFailed', { message: out.message }) });
    commandContext().canvas?.focus();
  };
  const colName = (rel: typeof source, id: Id): string => rel.columns.find((c) => c.id === id)?.name ?? '?';

  return (
    <Popover open onClose={close} anchorRef={anchorRef} placement="bottom-start" label={tt('editorTools.fk.popover.title')} className="sct-fk-popover" autoFocus={false}>
      <form className="sct-fk" onSubmit={submit} data-testid="fk-popover">
        <h3 className="sct-fk__title">{tt('editorTools.fk.popover.title')}</h3>
        <p className="sct-fk__text" data-testid="fk-text" aria-live="polite">
          {text}
        </p>
        {state.keys.length > 1 && (
          <Select
            label={tt('editorTools.fk.popover.references', { relation: target.name })}
            value={String(keyIndex)}
            options={state.keys.map((k, i) => ({ value: String(i), label: keyLabel(tt, project, target.id, k, state.modelId) }))}
            onChange={(v) => {
              const i = Number(v);
              setKeyIndex(i);
              const next = state.keys[i]!;
              // a different key: map in order again (the user can reorder below)
              setTargets(next.columnIds.slice());
            }}
          />
        )}
        <ul className="sct-fk__pairs" aria-label={tt('editorTools.fk.popover.pairs')}>
          {state.source.columnIds.map((sid, i) => {
            const note = pairTypeNote(source, target, pairs[i]!);
            return (
              <li key={sid} className="sct-fk__pair" data-testid="fk-pair">
                <span className="sct-fk__col" title={`${source.name}.${colName(source, sid)}`}>
                  {colName(source, sid)}
                </span>
                <Icon name="chevron-right" size={14} className="sct-fk__arrow" />
                <Select
                  hideLabel
                  label={tt('editorTools.fk.popover.refColumn', { column: `${source.name}.${colName(source, sid)}` })}
                  value={targets[i]!}
                  options={key.columnIds.map((id) => ({ value: id, label: colName(target, id) }))}
                  onChange={(v) => setTargets((cur) => remapTarget(cur, i, v))}
                />
                {note && (
                  <span className="sct-fk__warn" role="note">
                    <Icon name="warning" size={14} />
                    {tt('editorTools.fk.popover.typeMismatch', { source: note.source || '?', target: note.target || '?' })}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="sct-fk__actions">
          <Button variant="ghost" onClick={close}>
            {tt('editorTools.fk.popover.cancel')}
          </Button>
          <Button ref={confirm} variant="primary" type="submit" data-testid="fk-create">
            {tt('editorTools.fk.popover.create')}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

// ---- add-attribute flavour menu ----------------------------------------------------------------------------------

const FLAVOR_KEY: Record<AttrFlavor, string> = {
  simple: 'editorTools.attr.simple',
  key: 'editorTools.attr.key',
  'partial-key': 'editorTools.attr.partialKey',
  multivalued: 'editorTools.attr.multivalued',
  derived: 'editorTools.attr.derived',
  composite: 'editorTools.attr.composite',
};

export interface AddEnv {
  store: typeof editorStore;
  diagramId?: Id | null;
  handle: { startInlineEdit(t: { nodeId?: Id }): void } | null;
}

const defaultEnv = (): AddEnv => ({ store: editorStore, handle: commandContext().canvas });

/** Run the add + select + inline-rename flow used by the port, the menu, the command and the context menu. */
export function runAddAttribute(ownerNodeId: Id, flavor: AttrFlavor, env: AddEnv = defaultEnv()): boolean {
  const st = env.store.getState();
  const diagramId = env.diagramId ?? st.activeDiagramId;
  if (!diagramId) return false;
  const out = addAttributeTo(env.store, diagramId, ownerNodeId, flavor);
  if (!out.ok) {
    uiStore.getState().pushToast({ kind: 'error', message: t('editorTools.toast.attributeFailed', { message: out.message }) });
    return false;
  }
  const project = env.store.getState().project;
  const d = project.diagrams[diagramId]!;
  announce(t('editorTools.announce.attributeAdded', { name: nodeName(project, d, out.nodeId), owner: nodeName(project, d, ownerNodeId) }));
  env.handle?.startInlineEdit({ nodeId: out.nodeId });
  return true;
}

function AttrMenu() {
  const menu = useToolUi((s) => s.attrMenu);
  const tt = useT();
  const project = useEditorStore((s) => s.project);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const entries = useMemo(() => {
    if (!menu || !diagramId) return [];
    const d = project.diagrams[diagramId];
    const owner = d ? ownerOfNode(d, menu.ownerNodeId) : undefined;
    if (!owner) return [];
    const flavors = flavorsFor(owner.kind);
    return flavors.map((f) => ({
      id: `attr-${f}`,
      label: owner.kind === 'attribute' && f === 'simple' ? tt('editorTools.attr.sub') : tt(FLAVOR_KEY[f]),
      onSelect: () => void runAddAttribute(menu.ownerNodeId, f),
    }));
  }, [menu, project, diagramId, tt]);
  if (!menu || entries.length === 0) return null;
  return (
    <ContextMenu
      point={{ x: menu.clientX, y: menu.clientY }}
      entries={entries}
      label={tt('editorTools.attr.menuLabel')}
      onClose={() => {
        setToolUi({ attrMenu: null });
        commandContext().canvas?.focus();
      }}
    />
  );
}

// ---- hint chip + live region -------------------------------------------------------------------------------------

function Hint({ host }: { host: HTMLElement }) {
  const tool = useEditorStore((s) => s.tool);
  const gesture = useToolUi((s) => s.gestureHint);
  const pending = useToolUi((s) => s.fkPending);
  const project = useEditorStore((s) => s.project);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const announcement = useToolUi((s) => s.announcement);
  const tt = useT();
  let text: string | undefined;
  let tone: 'ok' | 'bad' | 'neutral' = 'neutral';
  if (gesture) {
    text = gesture.text;
    tone = gesture.tone;
  } else if (tool === 'connect') text = tt('editorTools.hint.connect');
  else if (tool === 'fk') {
    if (pending) {
      const d = diagramId ? project.diagrams[diagramId] : undefined;
      const m = d ? relationalModelOf(project, d) : undefined;
      const rel = m?.relations[pending.relationId];
      const cols = pending.columnIds.map((id) => rel?.columns.find((c) => c.id === id)?.name ?? '?').join(', ');
      text = tt('editorTools.hint.fkPending', { columns: cols, table: rel?.name ?? '?' });
    } else text = tt('editorTools.hint.fk');
  } else if (pending) {
    const d = diagramId ? project.diagrams[diagramId] : undefined;
    const m = d ? relationalModelOf(project, d) : undefined;
    const rel = m?.relations[pending.relationId];
    text = tt('editorTools.hint.fkPending', { columns: pending.columnIds.map((id) => rel?.columns.find((c) => c.id === id)?.name ?? '?').join(', '), table: rel?.name ?? '?' });
  }
  return createPortal(
    <>
      {text && (
        <div className={`sct-hint sct-hint--${tone}`} data-testid="tool-hint" data-tone={tone} aria-hidden="true">
          <Icon name={tone === 'bad' ? 'warning' : tone === 'ok' ? 'check' : tool === 'fk' ? 'key' : 'link'} size={14} />
          <span>{text}</span>
        </div>
      )}
      <div className="sc-canvas__sr" role="status" aria-live="polite" aria-atomic="true" data-testid="tools-live">
        {announcement}
      </div>
    </>,
    host,
  );
}

/** Mounted by the tools plugin overlay (SVG context): an invisible anchor rect for the popover + portalled chrome. */
export function ToolChrome({ anchorAt }: { anchorAt: { x: number; y: number } | null }): ReactNode {
  const anchor = useRef<SVGRectElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const popover = useToolUi((s) => s.fkPopover);
  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;
    setHost((svg?.parentElement as HTMLElement | null) ?? null);
  }, []);
  const at = anchorAt ?? { x: 0, y: 0 };
  const r = popover?.anchor ?? { x: at.x, y: at.y, w: 1, h: 1 };
  return (
    <>
      <rect ref={anchor} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" pointerEvents="none" data-overlay="tool-anchor" />
      {host && <Hint host={host} />}
      {popover && (
        <EventGuard>
          <FkPopover key={`${popover.targetNodeId}:${popover.source.columnIds.join(',')}`} state={popover} anchorRef={anchor} />
        </EventGuard>
      )}
      <EventGuard>
        <AttrMenu />
      </EventGuard>
    </>
  );
}
