import { useEffect, useRef, useState } from 'react';
import { useEditorStore, editorStore } from '@/store';
import * as ops from '@/model/ops';
import type { DiagramType, Id } from '@/model/types';
import { displayDiagramName, t, useT } from '@/i18n';
import { Icon } from '../icons';
import { ContextMenu, IconButton, MenuButton, VisuallyHidden, cssEscape, type MenuEntry } from '../components';
import { uiStore } from '../uiStore';
import { confirmDialog } from './confirm';

export const TYPE_ICON: Record<DiagramType, string> = { chen: 'entity', 'relational-schema': 'table', 'crows-foot': 'link', physical: 'sql' };

export const diagramTypeLabel = (type: DiagramType): string => t(`shell.diagramType.${type}`);

/** Create a diagram (optionally a view of `modelId`) and activate it. */
export function createDiagramAndActivate(type: DiagramType, modelId?: Id): Id | undefined {
  const store = editorStore.getState();
  let created: Id | undefined;
  try {
    store.commit(t('shell.tabs.newDiagramLabel'), (d) => {
      created = ops.createDiagram(d, { type, ...(modelId ? { modelId } : {}) }).diagramId;
    });
  } catch (e) {
    uiStore.getState().pushToast({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
  if (created) store.setActiveDiagram(created);
  return created;
}

export function duplicateDiagram(id: Id): void {
  const store = editorStore.getState();
  const src = store.project.diagrams[id];
  if (!src) return;
  let created: Id | undefined;
  store.commit(t('shell.tabs.duplicateLabel'), (d) => {
    created = ops.createDiagram(d, { type: src.type, modelId: src.modelId, name: t('shell.tabs.copyName', { name: displayDiagramName(src) }), copyLayoutFrom: id }).diagramId;
  });
  if (created) {
    const v = src.viewport;
    if (v) store.setViewState(created, v);
    store.setActiveDiagram(created);
  }
}

export async function deleteDiagramWithConfirm(id: Id): Promise<void> {
  const store = editorStore.getState();
  const d = store.project.diagrams[id];
  if (!d || store.project.diagramOrder.length <= 1) return;
  const ok = await confirmDialog({
    title: t('shell.tabs.deleteTitle', { name: displayDiagramName(d) }),
    message: t('shell.tabs.deleteMessage'),
    confirmLabel: t('common.delete'),
    danger: true,
  });
  if (ok) store.commit(t('shell.tabs.deleteLabel'), (draft) => ops.removeDiagram(draft, id));
}

export function newDiagramEntries(): MenuEntry[] {
  const { project, activeDiagramId } = editorStore.getState();
  const active = activeDiagramId ? project.diagrams[activeDiagramId] : undefined;
  const activeModel = active ? project.models[active.modelId] : undefined;
  const entries: MenuEntry[] = [
    { id: 'new-chen', label: t('shell.tabs.newEmptyModel'), icon: 'entity', onSelect: () => void createDiagramAndActivate('chen') },
  ];
  if (activeModel?.kind === 'er')
    entries.push({ id: 'view-chen', label: t('shell.tabs.viewOf', { name: activeModel.name }), icon: 'entity', onSelect: () => void createDiagramAndActivate('chen', activeModel.id) });
  const relTypes: DiagramType[] = ['relational-schema', 'crows-foot', 'physical'];
  // headers: the chen entry above is its own section
  entries.unshift({ type: 'label', id: 'h-chen', label: diagramTypeLabel('chen') });
  for (const type of relTypes) {
    entries.push({ type: 'separator', id: `sep-${type}` }, { type: 'label', id: `h-${type}`, label: diagramTypeLabel(type) });
    if (activeModel?.kind === 'relational')
      entries.push({ id: `view-${type}`, label: t('shell.tabs.viewOf', { name: activeModel.name }), icon: TYPE_ICON[type], onSelect: () => void createDiagramAndActivate(type, activeModel.id) });
    entries.push({ id: `new-${type}`, label: t('shell.tabs.newEmptyModel'), icon: TYPE_ICON[type], onSelect: () => void createDiagramAndActivate(type) });
  }
  return entries;
}

export function SheetTabs() {
  const tr = useT();
  const order = useEditorStore((s) => s.project.diagramOrder);
  const diagrams = useEditorStore((s) => s.project.diagrams);
  const active = useEditorStore((s) => s.activeDiagramId);
  const [renaming, setRenaming] = useState<Id | null>(null);
  const [menu, setMenu] = useState<{ id: Id; x: number; y: number } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const [announce, setAnnounce] = useState('');
  const [drag, setDrag] = useState<{ id: Id; dx: number; target: number } | null>(null);
  const press = useRef<{ id: Id; pointerId: number; startX: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);

  /** Move a tab to `to` in ONE undo step; announces the result for screen readers. */
  const moveTab = (id: Id, to: number): void => {
    const from = order.indexOf(id);
    const target = Math.max(0, Math.min(order.length - 1, to));
    if (from < 0 || target === from) return;
    editorStore.getState().commit(t('shell.tabs.reorderLabel'), (d) => ops.reorderDiagrams(d, id, target));
    setAnnounce(t('shell.tabs.moved', { name: diagrams[id] ? displayDiagramName(diagrams[id]) : '', position: target + 1, total: order.length }));
  };

  /** Drop slot for a pointer x: how many OTHER tabs have their centre left of it. */
  const slotAt = (id: Id, clientX: number): number => {
    let n = 0;
    for (const other of order) {
      if (other === id) continue;
      const el = list.current?.querySelector<HTMLElement>(`[data-diagram-id="${cssEscape(other)}"]`);
      const r = el?.getBoundingClientRect();
      if (r && r.left + r.width / 2 < clientX) n++;
    }
    return n;
  };

  const onPointerDown = (e: React.PointerEvent, id: Id): void => {
    if (e.button !== 0 || e.pointerType === 'touch' || order.length < 2) return;
    press.current = { id, pointerId: e.pointerId, startX: e.clientX, active: false };
  };
  const onPointerMove = (e: React.PointerEvent, id: Id): void => {
    const p = press.current;
    if (!p || p.id !== id || p.pointerId !== e.pointerId) return;
    const dx = e.clientX - p.startX;
    if (!p.active) {
      if (Math.abs(dx) < 5) return;
      p.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setDrag({ id, dx, target: slotAt(id, e.clientX) });
  };
  const endPress = (e: React.PointerEvent, id: Id, commit: boolean): void => {
    const p = press.current;
    if (!p || p.id !== id || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (!p.active) return;
    suppressClick.current = true; // the click that follows the release must not activate / rename
    setTimeout(() => (suppressClick.current = false), 0);
    const target = commit ? slotAt(id, e.clientX) : order.indexOf(id);
    setDrag(null);
    if (commit) moveTab(id, target);
  };

  const focusTab = (id: Id): void => {
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-diagram-id="${cssEscape(id)}"]`)?.focus());
  };

  const activate = (id: Id): void => editorStore.getState().setActiveDiagram(id);

  const onKeyDown = (e: React.KeyboardEvent, id: Id): void => {
    const i = order.indexOf(id);
    if (e.key === 'Escape' && press.current?.active) {
      press.current = null;
      setDrag(null);
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveTab(id, i + (e.key === 'ArrowRight' ? 1 : -1));
      focusTab(id);
      return;
    }
    let next: number | undefined;
    if (e.key === 'ArrowRight') next = (i + 1) % order.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + order.length) % order.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = order.length - 1;
    else if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(id);
      return;
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenu({ id, x: r.left, y: r.bottom });
      return;
    }
    if (next === undefined) return;
    e.preventDefault();
    const target = order[next]!;
    activate(target);
    focusTab(target);
  };

  const commitRename = (id: Id, value: string): void => {
    setRenaming(null);
    focusTab(id);
    const name = value.trim();
    const current = diagrams[id] ? displayDiagramName(diagrams[id]) : undefined;
    if (!name || name === current) return;
    editorStore.getState().commit(t('shell.tabs.renameLabel'), (d) => ops.renameDiagram(d, id, name));
  };

  const menuEntries = (id: Id): MenuEntry[] => [
    { id: 'rename', label: tr('common.rename'), icon: 'rename', shortcut: 'F2', onSelect: () => setRenaming(id) },
    { id: 'duplicate', label: tr('shell.tabs.duplicate'), icon: 'duplicate', onSelect: () => duplicateDiagram(id) },
    { type: 'separator', id: 'sep' },
    { id: 'delete', label: tr('common.delete'), icon: 'trash', danger: true, disabled: order.length <= 1, onSelect: () => void deleteDiagramWithConfirm(id) },
  ];

  const others = drag ? order.filter((o) => o !== drag.id) : [];
  const dropBefore = drag ? others[drag.target] : undefined;
  const dropAfter = drag && drag.target >= others.length ? others[others.length - 1] : undefined;

  return (
    <div className="shell-tabs">
      <div ref={list} role="tablist" aria-label={tr('shell.tabs.label')} className="shell-tablist">
        {order.map((id) => {
          const d = diagrams[id];
          if (!d) return null;
          const isActive = id === active;
          return renaming === id ? (
            <RenameInput key={id} initial={displayDiagramName(d)} onCommit={(v) => commitRename(id, v)} onCancel={() => { setRenaming(null); focusTab(id); }} />
          ) : (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-diagram-id={id}
              tabIndex={isActive ? 0 : -1}
              className={`shell-tab${isActive ? ' is-active' : ''}${drag?.id === id ? ' is-dragging' : ''}${id === dropBefore ? ' is-drop-before' : ''}${id === dropAfter ? ' is-drop-after' : ''}`}
              style={drag?.id === id ? { transform: `translateX(${drag.dx}px)` } : undefined}
              title={`${diagramTypeLabel(d.type)} - ${tr('shell.tabs.renameHint')}`}
              aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
              onPointerDown={(e) => onPointerDown(e, id)}
              onPointerMove={(e) => onPointerMove(e, id)}
              onPointerUp={(e) => endPress(e, id, true)}
              onPointerCancel={(e) => endPress(e, id, false)}
              onClick={() => {
                if (!suppressClick.current) activate(id);
              }}
              onDoubleClick={() => setRenaming(id)}
              onKeyDown={(e) => onKeyDown(e, id)}
              onContextMenu={(e) => {
                e.preventDefault();
                activate(id);
                setMenu({ id, x: e.clientX, y: e.clientY });
              }}
            >
              <Icon name={TYPE_ICON[d.type]} size={14} />
              <span className="shell-tab-name">{displayDiagramName(d)}</span>
            </button>
          );
        })}
      </div>
      <MenuButton
        label={tr('shell.tabs.add')}
        entries={newDiagramEntries}
        trigger={<IconButton label={tr('shell.tabs.add')} icon="plus" size="sm" className="shell-tab-add" />}
      />
      <VisuallyHidden role="status" aria-live="polite">
        {announce}
      </VisuallyHidden>
      {menu ? <ContextMenu point={{ x: menu.x, y: menu.y }} entries={menuEntries(menu.id)} label={tr('shell.tabs.menuLabel')} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const tr = useT();
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="shell-tab-input"
      aria-label={tr('shell.tabs.renameField')}
      defaultValue={initial}
      maxLength={80}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          done.current = true;
          onCommit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          done.current = true;
          onCancel();
        }
      }}
      onBlur={(e) => {
        if (!done.current) onCommit(e.currentTarget.value);
      }}
    />
  );
}
