import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { displayDiagramName, t } from '@/i18n';
import { snapRect, type SnapGuide } from '@/layout';
import { resolveRefsInDiagram } from '@/model/diagramSync';
import * as ops from '@/model/ops';
import { refKey } from '@/model/queries';
import type { Id, Point, SemanticRef, Severity, Viewport } from '@/model/types';
import { SceneSvg } from '@/render';
import { darkPalette, lightPalette, type Palette } from '@/render/palette';
import type { Rect } from '@/scene/base';
import { unionRects } from '@/scene/geometry';
import { buildScene } from '@/scene/registry';
import type { Scene } from '@/scene/types';
import type { SceneBaseline } from '@/scene/base';
import { editorStore, resolveTheme, useEditorStore, useSettings } from '@/store';
import { uiStore, useUi } from '@/ui/uiStore';
import { describeFocus, describeSelection } from './announce';
import { canvasUiStore, viewportInfoStore, useArmedItem } from './canvasState';
import type { DiagramCanvasHandle } from './canvasHandle';
import { findCommandForEvent, isCommandEnabled, runCommand, setCanvasHandle } from './commands/registry';
import { matchesShortcut } from './commands/shortcuts';
import { guarded } from './commands/util';
import './commands';
import { ContextMenu } from './ContextMenu';
import { builtinMenuEntries, tidyEntries } from './contextMenuModel';
import { createFromLibraryItem, GHOST_SIZES, reportCreation, type CreationResult } from './creation';
import { LIBRARY_MIME, decodeLibraryItem, type LibraryItem } from './dnd';
import { hitTest, marqueeSelect, rectFromPoints, type HitResult } from './hit';
import { InlineEdit } from './InlineEdit';
import { neighbourColumn, resolveEditSpec, type EditSpec, type EditTarget } from './editSpec';
import { PluginDispatcher, collectContextMenuEntries, usePluginsVersion, listCanvasPlugins, type CanvasContext, type CanvasPointerEvent, type MenuEntry } from './plugins';
import { autoPanStep, autoPanVelocity } from './autoPan';
import { sharedNudger } from './nudge';
import { kbAnnounce, kbClearLive, kbStore, resetKb } from './keyboard/keyboardState';
import { announce as announceTool, toolUi } from './tools/toolState';
import { explainHit, explainNode, explainEdge, explainPort } from './explain';
import { Outline, summarizeDiagram, OUTLINE_ID_ATTR } from './Outline';
import { focusNextRegion, focusProperties } from './commands/focus';
import { nodeName } from './tools/names';
import { useStore } from 'zustand';
import { VIEW_ANIM_MS, clampZoom, easeOutCubic, fitRect, interpolateView, originCentered, panBy, screenToWorld, visibleWorldRect, worldToScreen, zoomAround } from './viewport';
import './editor.css';

export interface DiagramCanvasProps {
  diagramId: Id;
  className?: string;
}

const DRAG_THRESHOLD_PX = 3;
const PERSIST_DELAY_MS = 300;

type Gesture =
  | { type: 'pan'; pointerId: number; startClient: Point; startView: Viewport }
  | {
      type: 'move';
      pointerId: number;
      startClient: Point;
      startWorld: Point;
      ids: Id[];
      start: Record<Id, Point>;
      group: Rect;
      targets: Rect[];
      began: boolean;
      last?: Point;
      afterUp?: () => void;
    }
  | { type: 'marquee'; pointerId: number; startClient: Point; startWorld: Point; base: Id[]; scene: Scene; began: boolean }
  | { type: 'plugin'; pointerId: number }
  | { type: 'pinch'; startView: Viewport; startMid: Point; startDist: number };

interface MoveSnapshot {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  detail: number;
}

const snapshotOf = (e: { clientX: number; clientY: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; pointerId: number; pointerType: string; button: number; buttons: number; detail: number }): MoveSnapshot => ({
  clientX: e.clientX,
  clientY: e.clientY,
  shiftKey: e.shiftKey,
  altKey: e.altKey,
  ctrlKey: e.ctrlKey,
  metaKey: e.metaKey,
  pointerId: e.pointerId,
  pointerType: e.pointerType,
  button: e.button,
  buttons: e.buttons,
  detail: e.detail,
});

const isEditable = (el: EventTarget | null): boolean => {
  const n = el as HTMLElement | null;
  if (!n || typeof n.closest !== 'function') return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable || !!n.closest('[contenteditable="true"]');
};

/** Measurement hook for the perf specs: `window.__scPerf = []` makes the canvas record one sample per scene build. */
const perfSample = (mode: 'draft' | 'full', t0: number): void => {
  const buf = (globalThis as { __scPerf?: Array<{ mode: string; buildMs: number; at: number }> }).__scPerf;
  if (buf && typeof performance !== 'undefined') buf.push({ mode, buildMs: performance.now() - t0, at: performance.now() });
};

const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Eased zoom / fit is skipped under prefers-reduced-motion, and under browser automation (`navigator.webdriver`) unless a test opts in
 * with `window.__scForceAnimate = true`: end-to-end tests read geometry right after a fit and must not race a 150 ms tween.
 */
const animationsEnabled = (): boolean => {
  if (prefersReducedMotion()) return false;
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return !nav?.webdriver || !!(globalThis as { __scForceAnimate?: boolean }).__scForceAnimate;
};

const handledKeys = new WeakSet<Event>();
let lastMountedDiagram: Id | null = null;
const raf = (fn: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number));
const caf = (id: number): void => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
const safeId = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_');
const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** The interactive canvas. See README.md for the interaction model and the plugin API. */
export const DiagramCanvas = forwardRef<DiagramCanvasHandle, DiagramCanvasProps>(function DiagramCanvas({ diagramId, className }, ref) {
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const themePref = useSettings((s) => s.theme);
  const issues = useUi((s) => s.issues);
  const focusedIssueId = useUi((s) => s.focusedIssueId);
  const armed = useArmedItem();
  usePluginsVersion();

  const patternId = safeId(useId());
  const diagram = Object.hasOwn(project.diagrams, diagramId) ? project.diagrams[diagramId] : undefined;
  const palette: Palette = resolveTheme(themePref) === 'dark' ? darkPalette : lightPalette;

  // ---- derived scene (memoised by the parts of the project that affect geometry, NOT by viewport writes) ------------------
  // While a drag / resize / handle transaction is open the scene is built in DRAFT quality against the last FULL build
  // (untouched connectors are reused, touched ones get cheap provisional routes); the moment the transaction ends the memo
  // runs again and builds FULL quality, which is therefore always what is left on screen (src/scene/draft.ts).
  const inTransaction = useEditorStore((s) => s.inTransaction);
  const fullBaseline = useRef<SceneBaseline | null>(null);
  const built = useMemo(() => {
    if (!diagram || !Object.hasOwn(project.models, diagram.modelId)) return undefined;
    try {
      const t0 = typeof performance === 'undefined' ? 0 : performance.now();
      const model = project.models[diagram.modelId]!;
      const base = fullBaseline.current;
      const usable = inTransaction && !(globalThis as { __scForceFull?: boolean }).__scForceFull && base && base.diagram.id === diagram.id && base.diagram.type === diagram.type && base.diagram.options === diagram.options && base.model === model;
      let scene: Scene;
      if (usable) scene = buildScene(project, diagramId, undefined, { quality: 'draft', previous: base });
      else {
        scene = buildScene(project, diagramId);
        fullBaseline.current = { scene, diagram, model };
      }
      perfSample(usable ? 'draft' : 'full', t0);
      return { scene, project, diagram };
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId, project.models, diagram?.nodes, diagram?.edges, diagram?.options, diagram?.modelId, diagram?.type, inTransaction]);

  // ---- state ---------------------------------------------------------------------------------------------------------
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [edit, setEdit] = useState<EditSpec | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [cursor, setCursor] = useState<string>('default');
  const [ghost, setGhost] = useState<Point | null>(null);
  const [focused, setFocused] = useState(false);
  const [kbFocus, setKbFocus] = useState<Id | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const symbolHints = useStore(canvasUiStore, (u) => u.symbolHints);
  const [, setTick] = useState(0);

  // ---- refs (event handlers read the latest values through these) ----------------------------------------------------------
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef(view);
  const sizeRef = useRef(size);
  const builtRef = useRef(built);
  builtRef.current = built;
  const diagramIdRef = useRef(diagramId);
  diagramIdRef.current = diagramId;
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const gestureRef = useRef<Gesture | null>(null);
  const dispatcher = useRef(new PluginDispatcher()).current;
  const spaceRef = useRef(false);
  const keepEditFocus = useRef(false);
  const touches = useRef(new Map<number, Point>());
  const pendingMove = useRef<MoveSnapshot | null>(null);
  const rafRef = useRef(0);
  const persist = useRef<{ timer: ReturnType<typeof setTimeout> | null; diagramId: Id; view: Viewport } | null>(null);
  const cursorOverride = useRef<string | undefined>(undefined);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const handleRef = useRef<DiagramCanvasHandle>(null as unknown as DiagramCanvasHandle);

  // ---- viewport -------------------------------------------------------------------------------------------------------
  const flushPersist = useCallback(() => {
    const p = persist.current;
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    persist.current = null;
    editorStore.getState().setViewState(p.diagramId, p.view);
  }, []);

  // `view` is what is DRAWN; `viewRef` is the logical (target) viewport everything else reads. They differ only during the
  // 150 ms eased zoom / fit animation (instant under prefers-reduced-motion); any pointer press, wheel or pan snaps to the target.
  const shownRef = useRef(view);
  const animRef = useRef<number | null>(null);
  const showView = useCallback((v: Viewport) => {
    shownRef.current = v;
    setView(v);
  }, []);
  const cancelAnim = useCallback(() => {
    if (animRef.current !== null) {
      caf(animRef.current);
      animRef.current = null;
    }
  }, []);
  const finishAnim = useCallback(() => {
    if (animRef.current === null) return;
    cancelAnim();
    showView(viewRef.current);
  }, [cancelAnim, showView]);

  const applyView = useCallback(
    (v: Viewport, save = true, animate = false) => {
      const nv: Viewport = { x: Number.isFinite(v.x) ? v.x : 0, y: Number.isFinite(v.y) ? v.y : 0, zoom: clampZoom(v.zoom) };
      viewRef.current = nv;
      cancelAnim();
      const from = shownRef.current;
      if (animate && animationsEnabled() && (from.x !== nv.x || from.y !== nv.y || from.zoom !== nv.zoom)) {
        const t0 = typeof performance === 'undefined' ? Date.now() : performance.now();
        const step = (): void => {
          const now = typeof performance === 'undefined' ? Date.now() : performance.now();
          const t = (now - t0) / VIEW_ANIM_MS;
          if (t >= 1) {
            animRef.current = null;
            showView(viewRef.current);
            return;
          }
          showView(interpolateView(from, viewRef.current, easeOutCubic(t)));
          animRef.current = raf(step);
        };
        animRef.current = raf(step);
        setTick((n) => n + 1);
      } else showView(nv);
      viewportInfoStore.setState({ diagramId: diagramIdRef.current, zoom: nv.zoom, x: nv.x, y: nv.y });
      if (save) {
        const prev = persist.current;
        if (prev?.timer) clearTimeout(prev.timer);
        const id = diagramIdRef.current;
        persist.current = { diagramId: id, view: nv, timer: setTimeout(flushPersist, PERSIST_DELAY_MS) };
      }
    },
    [flushPersist, cancelAnim, showView],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width) || (typeof ResizeObserver === 'undefined' ? 800 : 0), h: Math.round(r.height) || (typeof ResizeObserver === 'undefined' ? 600 : 0) };
      if (next.w !== sizeRef.current.w || next.h !== sizeRef.current.h) {
        sizeRef.current = next;
        setSize(next);
        viewportInfoStore.setState({ width: next.w, height: next.h });
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // first open of a diagram: restore the stored viewport, else fit (empty: origin centred)
  const initialised = useRef<Id | null>(null);
  useLayoutEffect(() => {
    if (!size.w || !size.h || initialised.current === diagramId) return;
    initialised.current = diagramId;
    const d = editorStore.getState().project.diagrams[diagramId];
    if (!d) return;
    if (d.viewport) applyView(d.viewport, false);
    else {
      const sc = builtRef.current?.scene;
      applyView(sc && sc.nodeOrder.length > 0 ? fitRect(sc.bounds, size, { maxZoom: 1 }) : originCentered(size), false);
    }
  }, [diagramId, size, applyView]);

  // switching diagram / unmounting: flush the viewport, drop transient state
  useEffect(() => {
    const id = diagramId;
    return () => {
      flushPersist();
      nudger.flush();
      stopAutoPanRef.current();
      cancelAnim();
      const g = gestureRef.current;
      if (g?.type === 'move' && g.began) editorStore.getState().cancelTransaction();
      gestureRef.current = null;
      if (initialised.current === id) initialised.current = null;
      {
        const cx = makeCx();
        if (cx) dispatcher.cancel(cx);
        else dispatcher.reset();
      }
      setMenu(null);
      setEdit(null);
      setMarquee(null);
      setGuides([]);
      setKbFocus(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramId]);

  const clientRect = (): DOMRect | { left: number; top: number } => svgRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const screenOf = (clientX: number, clientY: number): Point => {
    const r = clientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const worldOf = (clientX: number, clientY: number): Point => screenToWorld(viewRef.current, screenOf(clientX, clientY));

  function makeCx(): CanvasContext | null {
    const b = builtRef.current;
    if (!b) return null;
    const st = editorStore.getState();
    const v = viewRef.current;
    return {
      project: st.project,
      diagramId: diagramIdRef.current,
      diagram: st.project.diagrams[diagramIdRef.current] ?? b.diagram,
      scene: b.scene,
      viewport: v,
      zoom: v.zoom,
      palette: paletteRef.current,
      store: editorStore,
      handle: handleRef.current,
      worldFromClient: worldOf,
      hit: (w, o) => hitTest(b.scene, w, viewRef.current.zoom, o),
      setCursor: (c) => {
        cursorOverride.current = c;
        setCursor(c ?? 'default');
      },
      requestRender: () => setTick((n) => n + 1),
    };
  }

  const eventOf = (m: MoveSnapshot, cx: CanvasContext, native?: PointerEvent | MouseEvent): CanvasPointerEvent => {
    const screen = screenOf(m.clientX, m.clientY);
    const world = screenToWorld(viewRef.current, screen);
    return { world, screen, clientX: m.clientX, clientY: m.clientY, button: m.button, buttons: m.buttons, pointerId: m.pointerId, pointerType: m.pointerType, shiftKey: m.shiftKey, altKey: m.altKey, ctrlKey: m.ctrlKey, metaKey: m.metaKey, detail: m.detail, hit: cx.hit(world), native };
  };

  // ---- inline edit -----------------------------------------------------------------------------------------------------------
  const startEdit = useCallback((target: EditTarget): void => {
    const st = editorStore.getState();
    const id = diagramIdRef.current;
    if (!st.project.diagrams[id]) return;
    let scene: Scene;
    try {
      scene = buildScene(st.project, id);
    } catch {
      return;
    }
    const spec = resolveEditSpec(st.project, id, scene, target);
    if (spec) setEdit(spec);
  }, []);

  const focusCanvas = useCallback((): void => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  /** A "type its name" hint is only true while the rename is open: drop it from every live channel. */
  const clearCreationHints = (): void => {
    kbClearLive();
    announceTool('');
  };

  const finishEdit = (spec: EditSpec, text: string, nav: 'next' | 'prev' | null): void => {
    setEdit(null);
    focusCanvas();
    clearCreationHints();
    const trimmed = text.trim();
    const st = editorStore.getState();
    if ((trimmed !== '' || spec.allowEmpty) && trimmed !== spec.value) {
      const ok = guarded(() => st.commit('Rename', (d) => spec.commit(d, trimmed)));
      if (ok) kbAnnounce(t('editor.live.renamed', { name: trimmed }));
    }
    if (nav && spec.columnId && spec.nodeId) {
      const next = neighbourColumn(editorStore.getState().project, diagramIdRef.current, spec, nav === 'next' ? 1 : -1);
      const node = editorStore.getState().project.diagrams[diagramIdRef.current]?.nodes[spec.nodeId];
      if (next && node?.ref.kind === 'relation') {
        editorStore.getState().setSelection([spec.nodeId], { kind: 'column', relationId: node.ref.id, id: next });
        startEdit({ nodeId: spec.nodeId, columnId: next });
      }
    }
  };

  // an edit whose target vanished (undo, diagram switch) is dropped
  useEffect(() => {
    if (!edit) return;
    const d = project.diagrams[diagramId];
    if (!d || (edit.nodeId && !d.nodes[edit.nodeId]) || (edit.edgeId && !d.edges[edit.edgeId])) setEdit(null);
  }, [edit, project, diagramId]);

  // ---- creation ----------------------------------------------------------------------------------------------------------------
  const afterCreate = (res: CreationResult): void => {
    reportCreation(res);
    if (res.ok && res.rename) startEdit(res.rename);
    if (res.ok && res.selectIds[0]) {
      const st = editorStore.getState();
      const dg = st.project.diagrams[diagramIdRef.current];
      const name = dg ? nodeName(st.project, dg, res.selectIds[0]) : '';
      if (name) kbAnnounce(t(res.rename ? 'editor.live.placed' : 'editor.live.created', { name }));
    }
  };
  const place = (item: LibraryItem, at: Point): CreationResult => {
    const res = createFromLibraryItem(editorStore, diagramIdRef.current, item, at, { zoom: viewRef.current.zoom });
    afterCreate(res);
    return res;
  };

  // ---- symbol hints (tooltips) ---------------------------------------------------------------------------------------------------
  // Hover (delayed, mouse only) and keyboard focus explain database symbols in plain language, built from the scene hit and the
  // semantic model. The tooltip never takes pointer events, closes on Escape / movement / any press, and is exposed through
  // aria-describedby for screen readers.
  const tipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tipAnchor = useRef<Point | null>(null);
  const tipOpen = useRef(false);
  const overlayOpen = useRef(false);
  overlayOpen.current = !!menu || !!edit;
  const hideTip = useCallback((): void => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = undefined;
    tipAnchor.current = null;
    if (tipOpen.current) {
      tipOpen.current = false;
      setTip(null);
    }
  }, []);
  const showTip = (clientX: number, clientY: number): void => {
    tipTimer.current = undefined;
    const b = builtRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!b || !box || gestureRef.current || overlayOpen.current || !canvasUiStore.getState().symbolHints) return;
    const st = editorStore.getState();
    const diagram = st.project.diagrams[diagramIdRef.current];
    if (!diagram) return;
    const port = toolUi.getState().hoverPort;
    let text: string | null = null;
    if (port) {
      const kind = port.split(':')[1];
      text = explainPort(kind === 'add' ? 'add-attribute' : (kind ?? ''));
    } else text = explainHit(st.project, diagram, hitTest(b.scene, worldOf(clientX, clientY), viewRef.current.zoom));
    if (!text) return;
    tipAnchor.current = { x: clientX, y: clientY };
    tipOpen.current = true;
    setTip({ x: clientX - box.left, y: clientY - box.top, text });
  };
  const hoverTip = (e: ReactPointerEvent): void => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0 || !canvasUiStore.getState().symbolHints) return;
    const a = tipAnchor.current;
    if (a && Math.hypot(e.clientX - a.x, e.clientY - a.y) < 10) return;
    hideTip();
    const x = e.clientX;
    const y = e.clientY;
    tipTimer.current = setTimeout(() => showTip(x, y), 550);
  };
  useEffect(() => () => hideTip(), [hideTip]);
  useEffect(() => {
    if (!symbolHints) hideTip();
  }, [symbolHints, hideTip]);

  // ---- pointer: helpers ------------------------------------------------------------------------------------------------------
  const subFor = (nodeId: Id, hit: Extract<HitResult, { kind: 'node' }>): SemanticRef | undefined => {
    const node = editorStore.getState().project.diagrams[diagramIdRef.current]?.nodes[nodeId];
    return hit.columnId && node?.ref.kind === 'relation' ? { kind: 'column', relationId: node.ref.id, id: hit.columnId } : undefined;
  };

  const beginPan = (e: ReactPointerEvent): void => {
    gestureRef.current = { type: 'pan', pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current };
    setCursor('grabbing');
  };

  const startPinch = (): void => {
    const pts = [...touches.current.values()];
    if (pts.length < 2) return;
    cancelGesture();
    const a = pts[0]!;
    const b = pts[1]!;
    gestureRef.current = { type: 'pinch', startView: viewRef.current, startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, startDist: Math.max(1, dist(a, b)) };
  };

  /** Abandon the running gesture without committing anything. Returns whether there was one. */
  const cancelGesture = (): boolean => {
    stopAutoPan();
    const g = gestureRef.current;
    const cx = makeCx();
    let did = false;
    if (g) {
      if (g.type === 'move' && g.began) editorStore.getState().cancelTransaction();
      if (g.type === 'marquee') editorStore.getState().setSelection(g.base);
      if (g.type === 'plugin' && cx) dispatcher.cancel(cx);
      if (g.type === 'pan') setCursor('default');
      gestureRef.current = null;
      did = true;
    } else if (cx && dispatcher.cancel(cx)) did = true;
    if (pendingMove.current) pendingMove.current = null;
    setMarquee(null);
    setGuides([]);
    return did;
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    hideTip();
    finishAnim();
    focusCanvas();
    setMenu(null);
    setKbFocus(null);
    canvasUiStore.setState({ focusNodeId: null });
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, screenOf(e.clientX, e.clientY));
      if (touches.current.size === 2) {
        e.preventDefault();
        startPinch();
        return;
      }
      if (touches.current.size > 2) return;
    }
    if (e.button === 2) return; // handled by onContextMenu
    const b = builtRef.current;
    const capture = (): void => {
      try {
        svgRef.current?.setPointerCapture?.(e.pointerId);
      } catch {
        // pointer already gone
      }
    };
    if (e.button === 1 || (e.button === 0 && (spaceRef.current || toolRef.current === 'hand'))) {
      e.preventDefault();
      capture();
      beginPan(e);
      return;
    }
    if (e.button !== 0 || !b) return;
    const cx = makeCx();
    if (!cx) return;
    const snap = snapshotOf(e);
    const ce = eventOf(snap, cx, e.nativeEvent);

    // plugins run before the default select behaviour
    if (dispatcher.down(cx, ce)) {
      if (dispatcher.capturing) {
        gestureRef.current = { type: 'plugin', pointerId: e.pointerId };
        capture();
      }
      return;
    }

    // armed library item: click places it
    const item = armedRef.current;
    if (item) {
      const res = place(item, ce.world);
      if (res.ok && !e.shiftKey) canvasUiStore.setState({ armedItem: null });
      // the browser's default mousedown focus move would blur the rename input `place` just opened (typing the name would then
      // fire single-key shortcuts): the mousedown that follows this pointerdown must not move focus
      if (res.ok && res.rename) {
        keepEditFocus.current = true;
        setTimeout(() => (keepEditFocus.current = false), 500);
      }
      return;
    }

    const st = editorStore.getState();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const cur = st.selection.ids;
    const hit = ce.hit;

    if (hit.kind === 'node') {
      capture();
      const isSel = cur.includes(hit.nodeId);
      const colSub = subFor(hit.nodeId, hit);
      let afterUp: (() => void) | undefined;
      if (additive) {
        if (isSel) afterUp = () => st.toggleSelection(hit.nodeId);
        else st.setSelection([...cur, hit.nodeId]);
      } else if (!isSel) st.setSelection([hit.nodeId], colSub);
      else if (cur.length > 1) afterUp = () => st.setSelection([hit.nodeId], colSub);
      else st.setSubSelection(colSub);

      // dragging moves the whole (possibly just updated) selection
      const sel = editorStore.getState().selection.ids;
      const dg = editorStore.getState().project.diagrams[diagramIdRef.current];
      const ids = sel.filter((id) => dg?.nodes[id] && !dg.nodes[id]!.locked && b.scene.nodes[id]);
      const start: Record<Id, Point> = {};
      for (const id of ids) start[id] = { x: dg!.nodes[id]!.x, y: dg!.nodes[id]!.y };
      const idSet = new Set(ids);
      const group = unionRects(ids.map((id) => b.scene.nodes[id]!.bounds));
      gestureRef.current = {
        type: 'move',
        pointerId: e.pointerId,
        startClient: { x: e.clientX, y: e.clientY },
        startWorld: ce.world,
        ids,
        start,
        group: group ?? { x: 0, y: 0, w: 0, h: 0 },
        targets: b.scene.nodeOrder.filter((id) => !idSet.has(id)).map((id) => b.scene.nodes[id]!.bounds),
        began: false,
        afterUp,
      };
      return;
    }

    if (hit.kind === 'edge' || hit.kind === 'edge-label') {
      const edge = st.project.diagrams[diagramIdRef.current]?.edges[hit.edgeId];
      if (additive) st.toggleSelection(hit.edgeId);
      else if (edge?.ref.kind === 'foreignKey') st.setSelection([hit.edgeId], { kind: 'foreignKey', id: edge.ref.foreignKeyId });
      else st.setSelection([hit.edgeId]);
      return;
    }

    // empty space: marquee (a plain click clears the selection)
    capture();
    if (!additive) st.clearSelection();
    gestureRef.current = { type: 'marquee', pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startWorld: ce.world, base: additive ? [...cur] : [], scene: b.scene, began: false };
  };

  const processMove = (m: MoveSnapshot): void => {
    if (m.pointerType === 'touch' && touches.current.has(m.pointerId)) touches.current.set(m.pointerId, screenOf(m.clientX, m.clientY));
    const g = gestureRef.current;
    const cx = makeCx();
    if (!cx) return;
    if (g?.type === 'pinch') {
      const pts = [...touches.current.values()];
      if (pts.length >= 2) {
        const a = pts[0]!;
        const b = pts[1]!;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = g.startView.zoom * (dist(a, b) / g.startDist);
        const v = zoomAround(g.startView, z, g.startMid);
        applyView({ ...v, x: v.x + (mid.x - g.startMid.x), y: v.y + (mid.y - g.startMid.y) });
      }
      return;
    }
    if (!g) {
      const ce = eventOf(m, cx);
      if (dispatcher.move(cx, ce)) {
        const c = cursorOverride.current ?? dispatcher.cursor(cx, ce);
        if (c) setCursor(c);
        return;
      }
      cursorOverride.current = undefined;
      if (armedRef.current) {
        setGhost(ce.world);
        setCursor('crosshair');
        return;
      }
      const plugged = dispatcher.cursor(cx, ce);
      setCursor(spaceRef.current || toolRef.current === 'hand' ? 'grab' : (plugged ?? (ce.hit.kind === 'node' ? 'move' : ce.hit.kind === 'none' ? 'default' : 'pointer')));
      return;
    }
    if ('pointerId' in g && g.pointerId !== m.pointerId) return;
    const ce = eventOf(m, cx);
    switch (g.type) {
      case 'plugin':
        dispatcher.move(cx, ce);
        return;
      case 'pan': {
        applyView(panBy(g.startView, m.clientX - g.startClient.x, m.clientY - g.startClient.y));
        return;
      }
      case 'move': {
        const st = editorStore.getState();
        if (!g.began) {
          if (dist({ x: m.clientX, y: m.clientY }, g.startClient) < DRAG_THRESHOLD_PX || g.ids.length === 0 || st.inTransaction) return;
          st.beginTransaction('Move');
          g.began = true;
          g.afterUp = undefined;
        }
        let dx = ce.world.x - g.startWorld.x;
        let dy = ce.world.y - g.startWorld.y;
        const axisX = m.shiftKey && Math.abs(dx) >= Math.abs(dy);
        const axisY = m.shiftKey && !axisX;
        const grid = cx.diagram.options.grid;
        let gs: SnapGuide[] = [];
        if (grid.snap && !m.altKey) {
          const r = snapRect({ x: g.group.x + dx, y: g.group.y + dy, w: g.group.w, h: g.group.h }, { grid: grid.size, targets: g.targets, threshold: 6 / cx.zoom });
          dx = r.x - g.group.x;
          dy = r.y - g.group.y;
          gs = r.guides;
        }
        if (axisX) {
          dy = 0;
          gs = gs.filter((q) => q.axis === 'x');
        } else if (axisY) {
          dx = 0;
          gs = gs.filter((q) => q.axis === 'y');
        }
        setGuides(gs);
        if (g.last && g.last.x === dx && g.last.y === dy) return;
        g.last = { x: dx, y: dy };
        const positions: Record<Id, Point> = {};
        for (const id of g.ids) positions[id] = { x: g.start[id]!.x + dx, y: g.start[id]!.y + dy };
        st.updateTransaction((d) => void ops.setNodePositions(d, diagramIdRef.current, positions));
        return;
      }
      case 'marquee': {
        if (!g.began) {
          if (dist({ x: m.clientX, y: m.clientY }, g.startClient) < DRAG_THRESHOLD_PX) return;
          g.began = true;
        }
        const rect = rectFromPoints(g.startWorld, ce.world);
        setMarquee(rect);
        const res = marqueeSelect(g.scene, rect, { mode: m.altKey ? 'contain' : 'intersect', edges: 'contain' });
        const ids = [...new Set([...g.base, ...res.nodeIds, ...res.edgeIds])];
        const cur = editorStore.getState().selection;
        if (cur.ids.length !== ids.length || cur.ids.some((id, i) => id !== ids[i]) || cur.sub) editorStore.getState().setSelection(ids);
        return;
      }
    }
  };

  // ---- auto-pan: dragging a node / marquee / connector near the canvas edge scrolls the view (autoPan.ts) ---------------------
  const lastPtr = useRef<MoveSnapshot | null>(null);
  const autoPan = useRef<{ raf: number; last: number } | null>(null);
  const stopAutoPan = (): void => {
    if (autoPan.current) caf(autoPan.current.raf);
    autoPan.current = null;
  };
  const stopAutoPanRef = useRef(stopAutoPan);
  stopAutoPanRef.current = stopAutoPan;
  const autoPanActive = (): boolean => {
    const g = gestureRef.current;
    return !!g && ((g.type === 'move' && g.began) || (g.type === 'marquee' && g.began) || g.type === 'plugin');
  };
  const panVelocity = (): Point => {
    const m = lastPtr.current;
    if (!m || !autoPanActive()) return { x: 0, y: 0 };
    return autoPanVelocity(screenOf(m.clientX, m.clientY), sizeRef.current, { reducedMotion: prefersReducedMotion() });
  };
  const panTick = (): void => {
    const st = autoPan.current;
    if (!st) return;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    const v = panVelocity();
    if (v.x === 0 && v.y === 0) {
      autoPan.current = null; // the next pointer move restarts it
      return;
    }
    const dt = now - st.last;
    st.last = now;
    finishAnim();
    applyView(autoPanStep(viewRef.current, v, dt));
    // the pointer did not move but the world under it did: re-run the gesture so the dragged thing follows
    if (lastPtr.current) processMoveRef.current(lastPtr.current);
    if (autoPan.current === st) st.raf = raf(() => panTickRef.current());
  };
  const panTickRef = useRef(panTick);
  panTickRef.current = panTick;
  const processMoveRef = useRef(processMove);
  processMoveRef.current = processMove;
  const ensureAutoPan = (): void => {
    if (autoPan.current || !autoPanActive()) return;
    const v = panVelocity();
    if (v.x === 0 && v.y === 0) return;
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    autoPan.current = { raf: raf(() => panTickRef.current()), last: now };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    lastPtr.current = snapshotOf(e);
    hoverTip(e);
    if (gestureRef.current) ensureAutoPan();
    // every touch point is tracked immediately: rAF coalescing keeps only the LAST move and would drop the other finger's
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, screenOf(e.clientX, e.clientY));
    pendingMove.current = snapshotOf(e);
    if (!rafRef.current) {
      rafRef.current = raf(() => {
        rafRef.current = 0;
        const m = pendingMove.current;
        pendingMove.current = null;
        if (m) processMove(m);
      });
    }
  };

  const flushMove = (): void => {
    if (rafRef.current) {
      caf(rafRef.current);
      rafRef.current = 0;
    }
    const m = pendingMove.current;
    pendingMove.current = null;
    if (m) processMove(m);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    flushMove();
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId);
    try {
      svgRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      // not captured
    }
    stopAutoPan();
    const g = gestureRef.current;
    if (!g) return;
    if (g.type === 'pinch') {
      if (touches.current.size < 2) gestureRef.current = null;
      return;
    }
    if ('pointerId' in g && g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    const st = editorStore.getState();
    switch (g.type) {
      case 'plugin': {
        const cx = makeCx();
        if (cx) dispatcher.up(cx, eventOf(snapshotOf(e), cx, e.nativeEvent));
        break;
      }
      case 'move':
        if (g.began) st.endTransaction();
        else g.afterUp?.();
        setGuides([]);
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'pan':
        setCursor(spaceRef.current || toolRef.current === 'hand' ? 'grab' : 'default');
        break;
    }
  };

  const onPointerCancel = (e: ReactPointerEvent<SVGSVGElement>): void => {
    touches.current.delete(e.pointerId);
    cancelGesture();
  };

  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const cx = makeCx();
    if (!cx || e.button !== 0) return;
    const ce = eventOf(snapshotOf({ ...e, pointerId: 1, pointerType: 'mouse', buttons: e.buttons } as never), cx, e.nativeEvent);
    if (dispatcher.doubleClick(cx, ce)) return;
    const hit = ce.hit;
    hideTip();
    if (hit.kind === 'node') startEdit({ nodeId: hit.nodeId, columnId: hit.columnId });
    else if (hit.kind === 'edge-label' && hit.labelId === 'cardinality') {
      // the cardinality is a property of the participant, not a text: select its line and take the user to the Properties panel
      // (an empty role box here edited something else entirely)
      editorStore.getState().setSelection([hit.edgeId]);
      void focusProperties();
    } else if (hit.kind === 'edge' || hit.kind === 'edge-label') startEdit({ edgeId: hit.edgeId });
  };

  const openMenuAt = (clientX: number, clientY: number, ce: CanvasPointerEvent, cx: CanvasContext): void => {
    const st = editorStore.getState();
    const hit = ce.hit;
    if (hit.kind === 'node' && !st.selection.ids.includes(hit.nodeId)) st.setSelection([hit.nodeId], subFor(hit.nodeId, hit));
    else if ((hit.kind === 'edge' || hit.kind === 'edge-label') && !st.selection.ids.includes(hit.edgeId)) st.setSelection([hit.edgeId]);
    else if (hit.kind === 'none' && !ce.shiftKey) st.clearSelection();
    const now = editorStore.getState();
    const dg = now.project.diagrams[diagramIdRef.current];
    const nodeIds = now.selection.ids.filter((id) => dg?.nodes[id]);
    const entries = tidyEntries([
      ...builtinMenuEntries(hit, { nodeCount: nodeIds.length, lockedCount: nodeIds.filter((id) => dg!.nodes[id]!.locked).length }),
      { kind: 'separator' },
      ...collectContextMenuEntries({ ...cx, project: now.project }, hit),
    ]);
    if (entries.length) setMenu({ x: clientX, y: clientY, entries });
  };

  const onContextMenu = (e: React.MouseEvent<SVGSVGElement>): void => {
    e.preventDefault();
    const cx = makeCx();
    if (!cx) return;
    cancelGesture();
    focusCanvas();
    const ce = eventOf(snapshotOf({ ...e, pointerId: 1, pointerType: 'mouse', buttons: e.buttons } as never), cx, e.nativeEvent);
    openMenuAt(e.clientX, e.clientY, ce, cx);
  };

  // ---- wheel (non-passive: we must preventDefault to stop page scroll / browser zoom) ----------------------------------------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      hideTip();
      finishAnim();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
      let dx = ev.deltaX * unit;
      let dy = ev.deltaY * unit;
      const v = viewRef.current;
      if (ev.ctrlKey || ev.metaKey) {
        const r = el.getBoundingClientRect();
        const k = Math.abs(dy) >= 50 ? 0.0022 : 0.01; // mouse-wheel notch vs trackpad pinch
        applyView(zoomAround(v, v.zoom * Math.exp(-dy * k), { x: ev.clientX - r.left, y: ev.clientY - r.top }));
      } else {
        if (ev.shiftKey && dx === 0) {
          dx = dy;
          dy = 0;
        }
        applyView(panBy(v, -dx, -dy));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView, finishAnim, hideTip]);

  // ---- keyboard ----------------------------------------------------------------------------------------------------------------
  // A burst of arrow presses is ONE undo step (400 ms idle window, see nudge.ts); any other key, a pointer press, blur, a
  // diagram switch or unmount closes the burst first, so no other edit ever meets an open transaction.
  const nudger = sharedNudger;
  const nudge = (dx: number, dy: number): void => {
    const st = editorStore.getState();
    const dg = st.project.diagrams[diagramIdRef.current];
    if (!dg) return;
    const ids = st.selection.ids.filter((id) => dg.nodes[id] && !dg.nodes[id]!.locked);
    if (ids.length === 0) return;
    guarded(() => void nudger.nudge(diagramIdRef.current, ids, dx, dy));
  };

  const readingOrder = (): Id[] => {
    const sc = builtRef.current?.scene;
    if (!sc) return [];
    return [...sc.nodeOrder].sort((a, b) => sc.nodes[a]!.bounds.y - sc.nodes[b]!.bounds.y || sc.nodes[a]!.bounds.x - sc.nodes[b]!.bounds.x || (a < b ? -1 : 1));
  };

  /** Returns true when the event was consumed. `local`: the canvas itself has focus (enables canvas-only keys). */
  const handleKey = (ev: KeyboardEvent, local: boolean): boolean => {
    if (handledKeys.has(ev)) return false;
    // F6 / Shift+F6 cycle the landmark regions (canvas, properties, library) from ANYWHERE, text fields included; they never
    // change the selection
    if (ev.key === 'F6' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !uiStore.getState().dialog) {
      handledKeys.add(ev);
      ev.preventDefault();
      focusNextRegion(ev.shiftKey ? -1 : 1);
      return true;
    }
    if (isEditable(ev.target)) return false;
    const target = ev.target as HTMLElement | null;
    // keys typed in the context menu belong to the menu (it is a portal child of the canvas, so they bubble here)
    if (target?.closest?.('[role="menu"]')) return false;
    if (!local && (uiStore.getState().dialog || target?.closest?.('[role="dialog"],[role="menu"],[role="listbox"]'))) return false;
    const cx = makeCx();
    // roving focus is not selection: Space / Enter on the focused (but unselected) shape selects it; Shift or Ctrl+Space adds it
    if (local && (ev.key === ' ' || ev.key === 'Enter') && !ev.altKey && !ev.metaKey && (ev.key === ' ' || (!ev.shiftKey && !ev.ctrlKey))) {
      const fid = canvasUiStore.getState().focusNodeId;
      const cur = editorStore.getState();
      const dgf = cur.project.diagrams[diagramIdRef.current];
      const exists = !!fid && !!dgf && (!!dgf.nodes[fid] || !!dgf.edges[fid]);
      const additive = ev.shiftKey || ev.ctrlKey;
      if (fid && exists && (additive || !(cur.selection.ids.length === 1 && cur.selection.ids[0] === fid))) {
        if (additive) cur.toggleSelection(fid);
        else {
          const edge = dgf!.edges[fid];
          cur.setSelection([fid], edge?.ref.kind === 'foreignKey' ? { kind: 'foreignKey', id: edge.ref.foreignKeyId } : undefined);
        }
        kbClearLive();
        ev.preventDefault();
        handledKeys.add(ev);
        return true;
      }
    }
    if (local && cx && dispatcher.key(cx, ev)) {
      ev.preventDefault();
      handledKeys.add(ev);
      return true;
    }
    const noMods = !ev.ctrlKey && !ev.metaKey && !ev.altKey;
    if (ev.key === ' ' && noMods && (local || target === document.body)) {
      if (!spaceRef.current) {
        spaceRef.current = true;
        if (!gestureRef.current) setCursor('grab');
      }
      ev.preventDefault();
      handledKeys.add(ev);
      return true;
    }
    const cmd = findCommandForEvent(ev, matchesShortcut);
    // bare-key shortcuts (V, H, Delete, Shift+1 ...) must not hijack keys meant for a focused toolbar button or list
    if (cmd && !local && noMods && target !== document.body && target !== document.documentElement) return false;
    if (cmd) {
      handledKeys.add(ev);
      if (isCommandEnabled(cmd.id)) {
        ev.preventDefault();
        void runCommand(cmd.id);
        return true;
      }
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        return false;
      }
      // a bare key whose command does not apply right now (Enter / Home / Escape of the keyboard layer ...) falls through to the
      // canvas' own keys below
      if (!local) return false;
      handledKeys.delete(ev);
    } else if (!local) return false;

    const st = editorStore.getState();
    const dg = st.project.diagrams[diagramIdRef.current];
    const done = (): true => {
      ev.preventDefault();
      handledKeys.add(ev);
      return true;
    };
    switch (ev.key) {
      case 'Escape': {
        if (tipOpen.current) {
          hideTip();
          return done();
        }
        if (menu) {
          setMenu(null);
          return done();
        }
        if (cancelGesture()) return done();
        if (armedRef.current) {
          canvasUiStore.setState({ armedItem: null });
          return done();
        }
        if (toolRef.current !== 'select') {
          st.setTool('select');
          return done();
        }
        if (st.selection.ids.length || st.selection.sub) {
          st.clearSelection();
          setKbFocus(null);
          return done();
        }
        return false;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (ev.ctrlKey || ev.metaKey) return false;
        const sx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
        const sy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;
        const hasNodes = !!dg && st.selection.ids.some((id) => dg.nodes[id]);
        if (!hasNodes) {
          applyView(panBy(viewRef.current, -sx * 48, -sy * 48));
          return done();
        }
        const grid = dg!.options.grid.size > 0 ? dg!.options.grid.size : 10;
        const step = ev.altKey ? 1 : ev.shiftKey ? grid * 10 : grid;
        nudge(sx * step, sy * step);
        return done();
      }
      case 'Tab': {
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
        // roving focus: nodes in reading order, then connectors (paint order)
        const sc = builtRef.current?.scene;
        const order = [...readingOrder(), ...(sc ? sc.edgeOrder.filter((id) => dg?.edges[id]) : [])];
        if (order.length === 0) return false;
        const cur = canvasUiStore.getState().focusNodeId ?? (st.selection.ids.length === 1 ? st.selection.ids[0]! : null);
        const i = cur ? order.indexOf(cur) : -1;
        const next = i < 0 ? (ev.shiftKey ? order.length - 1 : 0) : i + (ev.shiftKey ? -1 : 1);
        if (next < 0 || next >= order.length) {
          canvasUiStore.setState({ focusNodeId: null });
          setKbFocus(null);
          return false; // let the browser move focus out of the canvas
        }
        const id = order[next]!;
        // focus is not selection: only the focus ring moves (and is announced); Space / Enter selects, so the Properties
        // panel keeps describing the real selection while the keyboard user walks the shapes
        canvasUiStore.setState({ focusNodeId: id });
        setKbFocus(id);
        kbAnnounce(describeFocus(st.project, diagramIdRef.current)(id));
        return done();
      }
      case 'Enter':
      case 'F2': {
        const id = st.selection.ids[0];
        if (!dg || st.selection.ids.length !== 1 || !id) return false;
        if (dg.nodes[id]) startEdit({ nodeId: id, columnId: st.selection.sub?.kind === 'column' ? st.selection.sub.id : undefined });
        else if (dg.edges[id]) startEdit({ edgeId: id });
        return done();
      }
      case 'ContextMenu':
      case 'F10': {
        if (ev.key === 'F10' && !ev.shiftKey) return false;
        const sc = builtRef.current?.scene;
        const ids = st.selection.ids.filter((id) => sc?.nodes[id]);
        const rect = ids.length && sc ? unionRects(ids.map((id) => sc.nodes[id]!.bounds)) : undefined;
        const r = containerRef.current?.getBoundingClientRect();
        const wp = rect ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } : screenToWorld(viewRef.current, { x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 });
        const sp = worldToScreen(viewRef.current, wp);
        const clientX = (r?.left ?? 0) + sp.x;
        const clientY = (r?.top ?? 0) + sp.y;
        if (cx) {
          const hit = ids[0] ? ({ kind: 'node', nodeId: ids[0] } as HitResult) : cx.hit(wp);
          openMenuAt(clientX, clientY, { world: wp, screen: sp, clientX, clientY, button: 2, buttons: 0, pointerId: 1, pointerType: 'keyboard', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, detail: 0, hit }, cx);
        }
        return done();
      }
      default:
        return false;
    }
  };

  const keyRef = useRef(handleKey);
  keyRef.current = handleKey;
  useEffect(() => {
    const onDocKey = (ev: KeyboardEvent): void => void keyRef.current(ev, false);
    const isNudgeKey = (ev: KeyboardEvent): boolean => ev.key.startsWith('Arrow') && !ev.ctrlKey && !ev.metaKey;
    const closeBurst = (ev: Event): void => {
      if (ev instanceof KeyboardEvent && (isNudgeKey(ev) || ev.key === 'Shift' || ev.key === 'Alt')) return;
      nudger.flush();
    };
    const onKeyUp = (ev: KeyboardEvent): void => {
      if (ev.key === ' ' && spaceRef.current) {
        spaceRef.current = false;
        if (!gestureRef.current) setCursor(toolRef.current === 'hand' ? 'grab' : 'default');
      }
    };
    const onBlur = (): void => {
      spaceRef.current = false;
      nudger.flush();
      cancelGestureRef.current();
    };
    document.addEventListener('keydown', onDocKey);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', closeBurst, true);
    window.addEventListener('pointerdown', closeBurst, true);
    return () => {
      document.removeEventListener('keydown', onDocKey);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('keydown', closeBurst, true);
      window.removeEventListener('pointerdown', closeBurst, true);
      nudger.flush();
    };
  }, []);
  const cancelGestureRef = useRef(cancelGesture);
  cancelGestureRef.current = cancelGesture;

  // ---- drag & drop from the library --------------------------------------------------------------------------------------------
  const onDragOver = (e: React.DragEvent): void => {
    if (Array.from(e.dataTransfer?.types ?? []).includes(LIBRARY_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: React.DragEvent): void => {
    const item = decodeLibraryItem(e.dataTransfer?.getData(LIBRARY_MIME));
    if (!item) return;
    e.preventDefault();
    focusCanvas();
    place(item, worldOf(e.clientX, e.clientY));
  };

  // ---- imperative handle -----------------------------------------------------------------------------------------------------
  const latest = useRef({ applyView, startEdit, focusCanvas });
  latest.current = { applyView, startEdit, focusCanvas };
  const handle = useMemo<DiagramCanvasHandle>(() => {
    const centreScreen = (): Point => ({ x: sizeRef.current.w / 2, y: sizeRef.current.h / 2 });
    const fitTo = (rect: Rect | undefined): void => {
      const s = sizeRef.current;
      if (!s.w || !s.h) return;
      latest.current.applyView(rect && (rect.w > 0 || rect.h > 0) ? fitRect(rect, s, { maxZoom: 2 }) : originCentered(s), true, true);
    };
    return {
      getViewport: () => viewRef.current,
      setViewport: (v) => latest.current.applyView(v),
      zoomBy: (factor, around) => latest.current.applyView(zoomAround(viewRef.current, viewRef.current.zoom * factor, around ?? centreScreen()), true, true),
      zoomTo: (zoom, around) => latest.current.applyView(zoomAround(viewRef.current, zoom, around ?? centreScreen()), true, true),
      fitToContent: () => fitTo(builtRef.current?.scene.nodeOrder.length ? builtRef.current.scene.bounds : undefined),
      fitToNodes: (ids) => {
        const sc = builtRef.current?.scene;
        const rects = ids.map((id) => sc?.nodes[id]?.paintBounds).filter((r): r is Rect => !!r);
        fitTo(unionRects(rects));
      },
      clientToWorld: (x, y) => worldOf(x, y),
      worldToClient: (p) => {
        const r = clientRect();
        const s = worldToScreen(viewRef.current, p);
        return { x: s.x + r.left, y: s.y + r.top };
      },
      visibleCenter: () => screenToWorld(viewRef.current, centreScreen()),
      visibleRect: () => visibleWorldRect(viewRef.current, sizeRef.current),
      armItem: (item) => {
        canvasUiStore.setState({ armedItem: item });
        if (!item) setGhost(null);
        if (item) latest.current.focusCanvas();
      },
      startInlineEdit: (target) => latest.current.startEdit(target),
      focus: () => latest.current.focusCanvas(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  handleRef.current = handle;
  useImperativeHandle(ref, () => handle, [handle]);
  useEffect(() => {
    setCanvasHandle(handle);
    return () => setCanvasHandle(null);
  }, [handle]);

  useEffect(() => {
    if (!armed) setGhost(null);
  }, [armed]);

  // ---- render -------------------------------------------------------------------------------------------------------------------
  const selectedRefs = useMemo(() => new Set<string>(selection.sub ? [refKey(selection.sub)] : []), [selection.sub]);
  const selectionSet = useMemo(() => new Set(selection.ids), [selection.ids]);

  const highlight = useMemo(() => {
    const nodes: Record<Id, Severity> = {};
    const byRef: Record<string, Severity> = {};
    const issue = focusedIssueId ? issues.find((i) => i.id === focusedIssueId) : undefined;
    if (issue && built) {
      const r = resolveRefsInDiagram(built.project, built.diagram, issue.affected);
      for (const id of [...r.nodeIds, ...r.edgeIds]) nodes[id] = issue.severity;
      for (const id of r.columnIds) byRef[`column:${id}`] = issue.severity;
      for (const ref of issue.affected) byRef[refKey(ref)] = issue.severity;
    }
    return { nodes, byRef };
  }, [focusedIssueId, issues, built]);

  const sceneEl = useMemo(
    () =>
      built ? (
        <SceneSvg
          scene={built.scene}
          project={built.project}
          diagram={built.diagram}
          ctx={{ palette, interactive: true, selection: selectionSet, highlights: highlight.nodes, selectedRefs, highlightsByRef: highlight.byRef }}
        />
      ) : null,
    [built, palette, selectionSet, selectedRefs, highlight],
  );

  const kb = useStore(kbStore, (k) => k);
  const kbOwnsSelectionText = !!kb.cell || (!!kb.edgeId && !!kb.edgeFocus);
  const announcement = useMemo(() => describeSelection(project, diagramId, selection), [project, diagramId, selection]);

  // the keyboard layer's modes end with the selection they belong to, and with the diagram
  useEffect(() => {
    const k = kbStore.getState();
    const only = selection.ids.length === 1 ? selection.ids[0] : undefined;
    if (k.cell && only !== k.cell.nodeId) kbStore.setState({ cell: null });
    if (k.edgeId && only !== k.edgeId) kbStore.setState({ edgeId: null, edgeFocus: null });
    // a selection made some other way (click, create, command) takes the focus ring with it
    const fid = canvasUiStore.getState().focusNodeId;
    if (fid && only !== fid && selection.ids.length > 0) {
      canvasUiStore.setState({ focusNodeId: null });
      setKbFocus(null);
    }
  }, [selection]);

  // switching sheets remounts the canvas (keyed by diagram): the new sheet is announced, the first open is not
  useEffect(() => {
    const prev = lastMountedDiagram;
    lastMountedDiagram = diagramId;
    if (prev && prev !== diagramId) {
      const diagram = editorStore.getState().project.diagrams[diagramId];
      if (diagram?.name) kbAnnounce(t('editor.live.sheet', { name: displayDiagramName(diagram) }));
    }
  }, [diagramId]);
  useEffect(() => () => resetKb(), [diagramId]);

  // keyboard focus explains its shape too (the same text a mouse user gets by hovering), after a short rest
  useEffect(() => {
    hideTip();
    if (!kbFocus || !focused || !symbolHints) return;
    const timer = setTimeout(() => {
      const b = builtRef.current;
      const st = editorStore.getState();
      const d = st.project.diagrams[diagramIdRef.current];
      if (!b || !d || overlayOpen.current) return;
      const text = d.nodes[kbFocus] ? explainNode(st.project, d, kbFocus) : explainEdge(st.project, d, kbFocus);
      const r = b.scene.nodes[kbFocus]?.paintBounds ?? b.scene.edges[kbFocus]?.bounds;
      if (!text || !r) return;
      const sp = worldToScreen(viewRef.current, { x: r.x + r.w / 2, y: r.y + r.h });
      tipOpen.current = true;
      setTip({ x: sp.x, y: sp.y - 8, text });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbFocus, focused, symbolHints]);

  const summary = useMemo(() => summarizeDiagram(project, diagramId), [project, diagramId]);
  const summaryLabel = summary.empty
    ? t('editor.canvas.summary.empty', { name: summary.name, kind: t(`editor.canvas.kind.${summary.kind}`) })
    : t('editor.canvas.summary', { name: summary.name, kind: t(`editor.canvas.kind.${summary.kind}`), summary: summary.summary });
  const tipId = `${patternId}-tip`;
  const activateFromOutline = (id: Id, sub?: SemanticRef): void => {
    const st = editorStore.getState();
    st.setSelection([id], sub);
    canvasUiStore.setState({ focusNodeId: id });
    setKbFocus(id);
    focusCanvas();
    // bring the shape into view when it is off screen (panning only: the zoom stays as the user set it)
    const b = builtRef.current;
    const r = b?.scene.nodes[id]?.paintBounds ?? b?.scene.edges[id]?.bounds;
    if (r) {
      const vis = visibleWorldRect(viewRef.current, sizeRef.current);
      const inside = r.x >= vis.x && r.y >= vis.y && r.x + r.w <= vis.x + vis.w && r.y + r.h <= vis.y + vis.h;
      if (!inside) {
        const v = viewRef.current;
        applyView({ x: sizeRef.current.w / 2 - (r.x + r.w / 2) * v.zoom, y: sizeRef.current.h / 2 - (r.y + r.h / 2) * v.zoom, zoom: v.zoom }, true, true);
      }
    }
  };

  const cx = built ? makeCx() : null;
  const pluginOverlays: ReactNode[] = [];
  if (cx) {
    for (const p of listCanvasPlugins()) {
      const o = p.overlay?.(cx);
      if (o) pluginOverlays.push(<g key={p.id} data-plugin-overlay={p.id}>{o}</g>);
    }
  }

  const grid = diagram?.options.grid;
  const cell = grid ? grid.size * view.zoom : 0;
  const showMinor = !!grid?.visible && cell >= 5;
  const showMajor = !!grid?.visible && cell * 5 >= 12;
  const px = (n: number): number => n;

  const selRects = built ? selection.ids.map((id) => built.scene.nodes[id]?.bounds).filter((r): r is Rect => !!r) : [];
  const group = selRects.length >= 2 ? unionRects(selRects) : undefined;
  const kbRect = kbFocus && focused && built ? (built.scene.nodes[kbFocus]?.paintBounds ?? built.scene.edges[kbFocus]?.bounds) : undefined;
  const ghostSize = armed && armed.kind !== 'template' ? GHOST_SIZES[armed.kind === 'relation' ? 'relation' : armed.kind] : undefined;
  const nonScaling = { vectorEffect: 'non-scaling-stroke' as const };
  const emptyKey = built && Object.keys(built.diagram.nodes).length === 0 ? (built.diagram.type === 'chen' ? 'editor.empty.hint' : 'editor.empty.hintTable') : null;
  const hintId = `${patternId}-hint`;

  return (
    <>
    <button
      type="button"
      className="sc-skip"
      onClick={() => {
        const first = document.querySelector<HTMLElement>(`[${OUTLINE_ID_ATTR}] a`);
        (first ?? document.querySelector<HTMLElement>(`[${OUTLINE_ID_ATTR}]`))?.focus();
      }}
    >
      {t('editor.canvas.skipOutline')}
    </button>
    <div
      ref={containerRef}
      className={['sc-canvas', className].filter(Boolean).join(' ')}
      role="application"
      aria-label={t('editor.canvas.label')}
      aria-describedby={tip ? `${hintId} ${tipId}` : hintId}
      tabIndex={0}
      data-zoom={viewRef.current.zoom.toFixed(4)}
      data-animating={animRef.current !== null ? 'true' : undefined}
      data-tool={tool}
      data-armed={armed ? armed.kind : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt' && e.key !== 'Meta') hideTip();
        void handleKey(e.nativeEvent, true);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
          // leaving the canvas ends cell mode (it is a keyboard mode of the focused canvas)
          if (kbStore.getState().cell) kbStore.setState({ cell: null });
        }
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <svg
        ref={svgRef}
        className="sc-canvas__svg"
        role="img"
        aria-label={summaryLabel}
        style={{ cursor, background: palette.background }}
        onPointerDown={onPointerDown}
        onMouseDown={(e) => {
          if (keepEditFocus.current) {
            keepEditFocus.current = false;
            e.preventDefault();
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          hideTip();
          if (!gestureRef.current) setGhost(null);
        }}
      >
        <defs>
          {showMinor && (
            <pattern id={`${patternId}-minor`} patternUnits="userSpaceOnUse" x={view.x - 0.5} y={view.y - 0.5} width={cell} height={cell}>
              <path d={`M0.5 0V${cell}M0 0.5H${cell}`} fill="none" stroke={palette.gridMinor} strokeWidth={1} shapeRendering="crispEdges" />
            </pattern>
          )}
          {showMajor && (
            <pattern id={`${patternId}-major`} patternUnits="userSpaceOnUse" x={view.x - 0.5} y={view.y - 0.5} width={cell * 5} height={cell * 5}>
              <path d={`M0.5 0V${cell * 5}M0 0.5H${cell * 5}`} fill="none" stroke={palette.gridMajor} strokeWidth={1} shapeRendering="crispEdges" />
            </pattern>
          )}
        </defs>
        <g data-layer="grid" pointerEvents="none">
          {showMinor && <rect width="100%" height="100%" fill={`url(#${patternId}-minor)`} />}
          {showMajor && <rect width="100%" height="100%" fill={`url(#${patternId}-major)`} />}
        </g>
        <g data-layer="world" transform={`translate(${px(view.x)} ${px(view.y)}) scale(${view.zoom})`}>
          {sceneEl}
          <g data-layer="overlay">
            {group && <rect x={group.x - 6} y={group.y - 6} width={group.w + 12} height={group.h + 12} fill="none" stroke={palette.accent} strokeWidth={1} strokeDasharray="5 4" {...nonScaling} pointerEvents="none" data-overlay="group" />}
            {kbRect && <rect x={kbRect.x - 5} y={kbRect.y - 5} width={kbRect.w + 10} height={kbRect.h + 10} rx={3} fill="none" stroke={palette.accent} strokeWidth={2} strokeDasharray="6 3" {...nonScaling} pointerEvents="none" data-overlay="focus" />}
            {guides.map((gd, i) =>
              gd.axis === 'x' ? (
                <line key={i} x1={gd.at} x2={gd.at} y1={gd.from - 12} y2={gd.to + 12} stroke={palette.info} strokeWidth={1.25} strokeDasharray="4 3" {...nonScaling} pointerEvents="none" data-overlay="guide" />
              ) : (
                <line key={i} y1={gd.at} y2={gd.at} x1={gd.from - 12} x2={gd.to + 12} stroke={palette.info} strokeWidth={1.25} strokeDasharray="4 3" {...nonScaling} pointerEvents="none" data-overlay="guide" />
              ),
            )}
            {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill={palette.accent} fillOpacity={0.1} stroke={palette.accent} strokeWidth={1} {...nonScaling} pointerEvents="none" data-overlay="marquee" />}
            {ghost && ghostSize && armed && (
              <g pointerEvents="none" opacity={0.65} data-overlay="ghost">
                {armed.kind === 'relationship' ? (
                  <polygon points={`${ghost.x},${ghost.y - ghostSize.h / 2} ${ghost.x + ghostSize.w / 2},${ghost.y} ${ghost.x},${ghost.y + ghostSize.h / 2} ${ghost.x - ghostSize.w / 2},${ghost.y}`} fill="none" stroke={palette.accent} strokeWidth={1.5} strokeDasharray="5 3" {...nonScaling} />
                ) : armed.kind === 'attribute' ? (
                  <ellipse cx={ghost.x} cy={ghost.y} rx={ghostSize.w / 2} ry={ghostSize.h / 2} fill="none" stroke={palette.accent} strokeWidth={1.5} strokeDasharray="5 3" {...nonScaling} />
                ) : (
                  <rect x={ghost.x - ghostSize.w / 2} y={ghost.y - ghostSize.h / 2} width={ghostSize.w} height={ghostSize.h} fill="none" stroke={palette.accent} strokeWidth={1.5} strokeDasharray="5 3" {...nonScaling} />
                )}
              </g>
            )}
            {pluginOverlays}
          </g>
        </g>
      </svg>
      {emptyKey && <div className="sc-canvas__empty" data-testid="canvas-empty">{t(emptyKey)}</div>}
      {edit && (
        <InlineEdit
          key={`${edit.kind}:${edit.nodeId ?? ''}:${edit.columnId ?? ''}:${edit.edgeId ?? ''}`}
          spec={edit}
          viewport={view}
          onDone={(text, nav) => finishEdit(edit, text, nav)}
          onCancel={() => {
            setEdit(null);
            focusCanvas();
            clearCreationHints();
          }}
        />
      )}
      <div className="sc-canvas__sr" role="status" aria-live="polite" aria-atomic="false" data-testid="canvas-live">
        <span>{kbOwnsSelectionText ? '' : announcement}</span>
        <span data-testid="canvas-live-kb">{kb.live}</span>
      </div>
      <span id={hintId} className="sc-canvas__sr">
        {t('editor.canvas.hint')}
      </span>
      {tip && symbolHints && (
        <div
          id={tipId}
          role="tooltip"
          className="sc-tip"
          data-testid="canvas-tip"
          data-above={tip.y + 110 > size.h ? '' : undefined}
          style={{ left: Math.max(130, Math.min(tip.x, Math.max(130, size.w - 130))), top: tip.y }}
        >
          {tip.text}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          entries={menu.entries}
          onClose={() => {
            setMenu(null);
            focusCanvas();
          }}
        />
      )}
    </div>
    <Outline
      project={project}
      diagramId={diagramId}
      onActivate={activateFromOutline}
      onClose={focusCanvas}
    />
    </>
  );
});
