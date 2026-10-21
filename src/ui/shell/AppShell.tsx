import { useEffect, useRef } from 'react';
import { DiagramCanvas, type DiagramCanvasHandle } from '@/editor';
import { editorStore, useEditorStore } from '@/store';
import { buildScene } from '@/scene/registry';
import { useT } from '@/i18n';
import { Spinner, ToastHost, VisuallyHidden } from '../components';
import { useApplyTheme } from '../theme/useResolvedTheme';
import { BottomDock, Drawer, SideDock, useDockVisibility } from './Docks';
import { CommandPalette } from './CommandPalette';
import { DialogHost } from './DialogHost';
import { FileDrop } from './FileDrop';
import { SheetTabs } from './SheetTabs';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';
import { Welcome } from './Welcome';
import { startFocusPolicy } from './focusPolicy';
import { useGlobalShortcuts } from './keyboard';
import { useLayoutMode } from './layout';
import { useShell } from './shellStore';

/**
 * Narrow layout: when the properties / library bottom sheet is open, pan the canvas (never zoom) so the selection sits in
 * the part of the sheet that is still visible above the sheet.
 */
export function revealSelectionAboveSheet(canvas: DiagramCanvasHandle, wrap: HTMLElement, sheet: HTMLElement): boolean {
  const st = editorStore.getState();
  const id = st.activeDiagramId;
  if (!id || st.selection.ids.length === 0) return false;
  let scene;
  try {
    scene = buildScene(st.project, id);
  } catch {
    return false;
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const sel of st.selection.ids) {
    const r = scene.nodes[sel]?.paintBounds ?? scene.edges[sel]?.bounds;
    if (!r) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!Number.isFinite(x0)) return false;
  const box = wrap.getBoundingClientRect();
  const visibleH = sheet.getBoundingClientRect().top - box.top;
  if (visibleH < 40) return false;
  const v = canvas.getViewport();
  const margin = 12;
  const top = y0 * v.zoom + v.y;
  const bottom = y1 * v.zoom + v.y;
  const left = x0 * v.zoom + v.x;
  const right = x1 * v.zoom + v.x;
  let dy = 0;
  let dx = 0;
  if (bottom > visibleH - margin || top < margin) dy = bottom - top > visibleH - 2 * margin ? margin - top : visibleH / 2 - (top + bottom) / 2;
  if (right > box.width - margin || left < margin) dx = right - left > box.width - 2 * margin ? margin - left : box.width / 2 - (left + right) / 2;
  if (dx === 0 && dy === 0) return false;
  canvas.setViewport({ ...v, x: v.x + dx, y: v.y + dy });
  return true;
}

function Workspace() {
  const t = useT();
  const mode = useLayoutMode();
  const vis = useDockVisibility(mode);
  const drawer = useShell((s) => s.drawer);
  const diagramId = useEditorStore((s) => s.activeDiagramId);
  const isEmpty = useEditorStore((s) => {
    const d = s.activeDiagramId ? s.project.diagrams[s.activeDiagramId] : undefined;
    return !!d && Object.keys(d.nodes).length === 0;
  });
  const canvas = useRef<DiagramCanvasHandle>(null);
  const wide = mode === 'wide';
  const wrap = useRef<HTMLDivElement>(null);
  const selectionKey = useEditorStore((s) => s.selection.ids.join(','));
  const sheetOpen = mode === 'narrow' && !!drawer;
  useEffect(() => {
    if (!sheetOpen) return;
    const h = requestAnimationFrame(() => {
      const sheet = document.querySelector<HTMLElement>('.shell-drawer-sheet');
      if (canvas.current && wrap.current && sheet) revealSelectionAboveSheet(canvas.current, wrap.current, sheet);
    });
    return () => cancelAnimationFrame(h);
  }, [sheetOpen, selectionKey, diagramId]);
  return (
    <div className={`shell-workspace is-${mode}`}>
      {wide && vis.library ? <SideDock slot="library" /> : null}
      <main className="shell-center" aria-label={t('shell.canvas.label')} id="sheet-main">
        <SheetTabs />
        <div className="shell-canvas-wrap" ref={wrap}>
          {diagramId ? <DiagramCanvas key={diagramId} ref={canvas} diagramId={diagramId} className="shell-canvas" /> : null}
          {isEmpty && diagramId ? <Welcome canvas={canvas} diagramId={diagramId} /> : null}
        </div>
        <BottomDock />
      </main>
      {wide && vis.properties ? <SideDock slot="properties" /> : null}
      {!wide && drawer ? <Drawer key={drawer} slot={drawer} mode={mode} /> : null}
    </div>
  );
}

export function AppShell() {
  const t = useT();
  useApplyTheme();
  useGlobalShortcuts();
  const ready = useShell((s) => s.ready);
  const narrow = useLayoutMode() === 'narrow';
  const drawerOpen = useShell((s) => s.drawer !== null);
  const sheetOpen = narrow && drawerOpen;
  const name = useEditorStore((s) => s.project.name);
  const dirty = useEditorStore((s) => s.dirty);
  useEffect(() => startFocusPolicy(), []);
  // "<name> - SchemaCanvas"; a leading bullet marks changes that are not saved yet (browser autosave or file)
  useEffect(() => {
    document.title = `${dirty ? '\u2022 ' : ''}${name} - SchemaCanvas`;
  }, [name, dirty]);
  return (
    <div className="shell" data-sheet-open={sheetOpen ? '' : undefined}>
      <a
        className="shell-skip"
        href="#sheet-main"
        onClick={(e) => {
          e.preventDefault();
          // the canvas itself (the application region), else the active tab - never an inactive tab
          (document.querySelector<HTMLElement>('#sheet-main [role="application"]') ?? document.querySelector<HTMLElement>('#sheet-main [role="tab"][aria-selected="true"]'))?.focus();
        }}
      >
        {t('shell.skip')}
      </a>
      <header className="shell-header">
        <VisuallyHidden as="h1">{`SchemaCanvas - ${name}`}</VisuallyHidden>
        <Toolbar />
      </header>
      {ready ? (
        <Workspace />
      ) : (
        <div className="shell-loading">
          <Spinner size={24} />
        </div>
      )}
      <StatusBar />
      <DialogHost />
      <CommandPalette />
      <FileDrop />
      <ToastHost />
    </div>
  );
}
