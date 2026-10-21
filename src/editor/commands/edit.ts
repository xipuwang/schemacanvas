import { extractClipboard, duplicateNodes, pasteClipboard } from '@/model/ops';
import * as ops from '@/model/ops';
import type { Id, Point } from '@/model/types';
import type { Rect } from '@/scene/base';
import { rectCenter, rectsIntersect } from '@/scene/geometry';
import { buildScene } from '@/scene/registry';
import { clearClipboard, getClipboardRecord, payloadOrigin, readSystemClipboard, setClipboardRecord, type ClipboardRecord } from '../clipboardStore';
import { t } from '@/i18n';
import { uiStore } from '@/ui/uiStore';
import { kbAnnounce } from '../keyboard/keyboardState';
import { removeRefs, selectionRefs, summarizeDelete } from '../semanticDelete';
import { registerCommand, type Command } from './registry';
import { activeInfo, guarded } from './util';

const gridOf = (grid: { snap: boolean; size: number } | undefined): number => (grid && grid.size > 0 ? grid.size : 20);

/** Paste/duplicate offset: grows with each paste; when the source is off screen the copy lands at the visible centre. */
export function computePasteOffset(bounds: Rect, pasteCount: number, grid: number, visible?: Rect): Point {
  const step = Math.ceil(24 / grid) * grid;
  const n = pasteCount + 1;
  if (visible && !rectsIntersect(visible, { x: bounds.x, y: bounds.y, w: Math.max(bounds.w, 1), h: Math.max(bounds.h, 1) })) {
    const vc = rectCenter(visible);
    const bc = rectCenter(bounds);
    const base = { x: Math.round((vc.x - bc.x) / grid) * grid, y: Math.round((vc.y - bc.y) / grid) * grid };
    return { x: base.x + step * pasteCount, y: base.y + step * pasteCount };
  }
  return { x: step * n, y: step * n };
}

function copySelection(ctx: Parameters<NonNullable<Command['run']>>[0]): boolean {
  const info = activeInfo(ctx);
  if (!info || info.nodeIds.length === 0) return false;
  const payload = extractClipboard(info.project, info.diagramId, info.nodeIds);
  const scene = buildScene(info.project, info.diagramId);
  const rects = info.nodeIds.map((id) => scene.nodes[id]?.bounds).filter((r): r is Rect => !!r);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  setClipboardRecord({ payload, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, sourceDiagramId: info.diagramId });
  return true;
}

function deleteSelection(ctx: Parameters<NonNullable<Command['run']>>[0], label: string): void {
  const info = activeInfo(ctx);
  if (!info) return;
  const s = ctx.store.getState();
  const refs = selectionRefs(info.project, info.diagramId, s.selection);
  if (refs.length === 0) return;
  const finish = summarizeDelete(info.project, info.diagram.modelId, refs);
  const ok = guarded(() => s.commit(label, (d) => void removeRefs(d, info.diagram.modelId, refs)));
  if (!ok) return;
  // say what went: the live region always, and a toast with Undo when the delete took other elements with it (a deleted
  // entity silently drops its attributes and participation lines, which changes the relationships it was part of)
  const { what, also } = finish(ctx.store.getState().project);
  kbAnnounce(also ? t('editor.toast.deleted.also', { what, also }) : t('editor.live.deleted', { what }));
  if (also && label === 'Delete') {
    uiStore.getState().pushToast({
      kind: 'info',
      message: t('editor.toast.deleted.also', { what, also }),
      ttl: 8000,
      action: { label: t('editor.toast.undo'), onSelect: () => ctx.store.getState().undo() },
    });
  }
}

const has = (ctx: Parameters<NonNullable<Command['run']>>[0]): boolean => {
  const i = activeInfo(ctx);
  return !!i && i.nodeIds.length > 0;
};

export const editCommands: Command[] = [
  {
    id: 'edit.undo',
    labelKey: 'commands.edit.undo',
    group: 'edit',
    shortcut: 'Mod+Z',
    icon: 'undo',
    isEnabled: (c) => c.store.getState().canUndo && !c.store.getState().inTransaction,
    run: (c) => {
      const st = c.store.getState();
      const label = st.undoStack[st.undoStack.length - 1]?.label;
      st.undo();
      kbAnnounce(label ? t('editor.live.undone', { label }) : t('editor.live.nothingToUndo'));
    },
  },
  {
    id: 'edit.redo',
    labelKey: 'commands.edit.redo',
    group: 'edit',
    shortcut: ['Mod+Shift+Z', 'Mod+Y'],
    icon: 'redo',
    isEnabled: (c) => c.store.getState().canRedo && !c.store.getState().inTransaction,
    run: (c) => {
      const st = c.store.getState();
      const label = st.redoStack[st.redoStack.length - 1]?.label;
      st.redo();
      kbAnnounce(label ? t('editor.live.redone', { label }) : t('editor.live.nothingToRedo'));
    },
  },
  { id: 'edit.copy', labelKey: 'commands.edit.copy', group: 'edit', shortcut: 'Mod+C', icon: 'copy', isEnabled: has, run: (c) => void copySelection(c) },
  {
    id: 'edit.cut',
    labelKey: 'commands.edit.cut',
    group: 'edit',
    shortcut: 'Mod+X',
    icon: 'cut',
    isEnabled: has,
    run: (c) => {
      if (copySelection(c)) deleteSelection(c, 'Cut');
    },
  },
  {
    id: 'edit.paste',
    labelKey: 'commands.edit.paste',
    group: 'edit',
    shortcut: 'Mod+V',
    icon: 'paste',
    isEnabled: (c) => !!activeInfo(c) && !c.store.getState().inTransaction,
    run: async (c) => {
      const info = activeInfo(c);
      if (!info) return;
      let rec: ClipboardRecord | null = getClipboardRecord();
      if (!rec) {
        const payload = await readSystemClipboard();
        if (!payload) return;
        setClipboardRecord({ payload, bounds: payloadOrigin(payload), sourceDiagramId: null });
        rec = getClipboardRecord();
      }
      if (!rec) return;
      // the active diagram may have changed while we awaited the system clipboard
      const now = activeInfo(c);
      if (!now) return;
      const visible = c.canvas?.visibleRect?.();
      const offset = computePasteOffset(rec.bounds, rec.pasteCount, gridOf(now.diagram.options.grid), visible);
      let created: Id[] | undefined;
      const record = rec;
      const ok = guarded(() =>
        c.store.getState().commit(
          'Paste',
          (d) => {
            created = pasteClipboard(d, now.diagramId, record.payload, offset).nodeIds;
          },
          { get select() { return created; } },
        ),
      );
      if (ok) record.pasteCount += 1;
    },
  },
  {
    id: 'edit.duplicate',
    labelKey: 'commands.edit.duplicate',
    group: 'edit',
    shortcut: 'Mod+D',
    icon: 'duplicate',
    isEnabled: has,
    run: (c) => {
      const info = activeInfo(c);
      if (!info || info.nodeIds.length === 0) return;
      const step = Math.ceil(24 / gridOf(info.diagram.options.grid)) * gridOf(info.diagram.options.grid);
      let created: Id[] | undefined;
      guarded(() =>
        c.store.getState().commit(
          'Duplicate',
          (d) => {
            created = duplicateNodes(d, info.diagramId, info.nodeIds, { x: step, y: step }).nodeIds;
          },
          { get select() { return created; } },
        ),
      );
    },
  },
  {
    id: 'edit.delete',
    labelKey: 'commands.edit.delete',
    group: 'edit',
    shortcut: ['Delete', 'Backspace'],
    icon: 'trash',
    isEnabled: (c) => {
      const s = c.store.getState();
      return !s.inTransaction && (s.selection.ids.length > 0 || !!s.selection.sub);
    },
    run: (c) => deleteSelection(c, 'Delete'),
  },
  {
    id: 'edit.removeFromDiagram',
    labelKey: 'commands.edit.removeFromDiagram',
    group: 'edit',
    isEnabled: has,
    run: (c) => {
      const info = activeInfo(c);
      if (!info || info.nodeIds.length === 0) return;
      guarded(() => c.store.getState().commit('Remove from diagram', (d) => ops.removeFromDiagram(d, info.diagramId, info.nodeIds)));
    },
  },
  {
    id: 'edit.selectAll',
    labelKey: 'commands.edit.selectAll',
    group: 'edit',
    shortcut: 'Mod+A',
    isEnabled: (c) => {
      const i = activeInfo(c);
      return !!i && Object.keys(i.diagram.nodes).length > 0;
    },
    run: (c) => {
      const i = activeInfo(c);
      if (i) c.store.getState().setSelection(Object.keys(i.diagram.nodes));
    },
  },
  {
    id: 'edit.deselect',
    labelKey: 'commands.edit.deselect',
    group: 'edit',
    shortcut: 'Mod+Shift+A',
    isEnabled: (c) => c.store.getState().selection.ids.length > 0,
    run: (c) => c.store.getState().clearSelection(),
  },
];

editCommands.forEach(registerCommand);
export { clearClipboard };
