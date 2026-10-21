/**
 * Canvas plugin API. EDITOR-TOOLS (connect tools, resize/anchor/bend handles, ...) extends the canvas ONLY through this
 * module; see README.md "Plugin API". Everything here is framework-light so the dispatcher is unit-testable without React.
 */
import type { ReactNode } from 'react';
import { createStore, useStore } from 'zustand';
import type { Diagram, Id, Point, Project, Viewport } from '@/model/types';
import type { Palette } from '@/render/palette';
import type { Scene } from '@/scene/types';
import type { EditorStore } from '@/store';
import type { DiagramCanvasHandle } from './canvasHandle';
import type { HitOptions, HitResult } from './hit';

/** What `onPointer*` handlers receive: the raw event plus world-space conveniences. */
export interface CanvasPointerEvent {
  /** Pointer position in world coordinates. */
  world: Point;
  /** Pointer position relative to the canvas container (screen space). */
  screen: Point;
  clientX: number;
  clientY: number;
  button: number;
  buttons: number;
  pointerId: number;
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Number of consecutive clicks (from the browser). */
  detail: number;
  /** Hit-test result at `world` (computed once per event, before dispatch). */
  hit: HitResult;
  /** The underlying DOM event, when there is one (absent in unit tests). */
  native?: PointerEvent | MouseEvent;
}

/** Everything a plugin may read or call. Rebuilt per event, so it is always current (never cache it). */
export interface CanvasContext {
  project: Project;
  diagramId: Id;
  diagram: Diagram;
  scene: Scene;
  viewport: Viewport;
  zoom: number;
  palette: Palette;
  store: EditorStore;
  handle: DiagramCanvasHandle;
  /** Client (page) coordinates -> world. */
  worldFromClient(clientX: number, clientY: number): Point;
  /** Hit-test the scene at a world point using the current zoom (px tolerances are handled). */
  hit(world: Point, opts?: HitOptions): HitResult;
  /** Override the pointer cursor (CSS cursor value) until the next pointer event; `undefined` resets. */
  setCursor(cursor: string | undefined): void;
  /** Re-render the canvas (overlay) — call after changing plugin-local state. */
  requestRender(): void;
}

/**
 * - `'capture'` (only from `onPointerDown`): this plugin owns the pointer sequence. Subsequent pointermove / pointerup /
 *   pointercancel of that pointer go ONLY to it (and the default select behaviour never starts).
 * - `'handled'`: consumed the event; later plugins and the default behaviour skip it (no sequence is captured).
 * - anything else: not interested, the next plugin / default behaviour runs.
 */
export type PluginResult = 'capture' | 'handled' | void;

export type MenuEntry =
  | { kind: 'command'; commandId: string }
  | {
      kind: 'item';
      id: string;
      /** Already translated. */
      label: string;
      /** Already formatted shortcut text, if any. */
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      run(): void;
    }
  | { kind: 'separator' };

export interface CanvasPlugin {
  id: string;
  /** Higher runs first; ties keep registration order. Default 0. The default select behaviour runs last. */
  priority?: number;
  onPointerDown?(cx: CanvasContext, e: CanvasPointerEvent): PluginResult;
  /** While a sequence is captured: drag updates. Otherwise: hover (return `'handled'` to stop the chain). */
  onPointerMove?(cx: CanvasContext, e: CanvasPointerEvent): PluginResult;
  onPointerUp?(cx: CanvasContext, e: CanvasPointerEvent): void;
  /** Escape, pointercancel, window blur or the canvas unmounting while this plugin owns a sequence: abandon it cleanly. */
  onPointerCancel?(cx: CanvasContext): void;
  onDoubleClick?(cx: CanvasContext, e: CanvasPointerEvent): PluginResult;
  /** Runs before the canvas' own key handling (including Escape). Return `'handled'` to consume the key. */
  onKeyDown?(cx: CanvasContext, e: KeyboardEvent): PluginResult;
  /** Cursor while hovering (no sequence captured). First plugin returning a string wins. */
  cursorAt?(cx: CanvasContext, e: CanvasPointerEvent): string | undefined;
  /** SVG content in WORLD coordinates, rendered in the overlay layer above the scene (handles, previews). */
  overlay?(cx: CanvasContext): ReactNode;
  /** Extra context-menu entries for the element under the pointer. */
  contextMenu?(cx: CanvasContext, hit: HitResult): MenuEntry[] | undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------------------------------------------------

const plugins: CanvasPlugin[] = [];
const providers: Array<(cx: CanvasContext, hit: HitResult) => MenuEntry[] | undefined> = [];
const version = createStore<{ v: number }>(() => ({ v: 0 }));
const bump = (): void => version.setState((s) => ({ v: s.v + 1 }));

/** Register (or replace, by id) a plugin; returns the unregister function. */
export function registerCanvasPlugin(plugin: CanvasPlugin): () => void {
  const i = plugins.findIndex((p) => p.id === plugin.id);
  if (i >= 0) plugins[i] = plugin;
  else plugins.push(plugin);
  bump();
  return () => {
    const j = plugins.indexOf(plugin);
    if (j >= 0) {
      plugins.splice(j, 1);
      bump();
    }
  };
}

/** Plugins in dispatch order (priority desc, registration order for ties). */
export function listCanvasPlugins(): CanvasPlugin[] {
  return plugins.map((p, i) => ({ p, i })).sort((a, b) => (b.p.priority ?? 0) - (a.p.priority ?? 0) || a.i - b.i).map((x) => x.p);
}

export function registerContextMenuProvider(fn: (cx: CanvasContext, hit: HitResult) => MenuEntry[] | undefined): () => void {
  providers.push(fn);
  return () => {
    const i = providers.indexOf(fn);
    if (i >= 0) providers.splice(i, 1);
  };
}

/** Entries contributed by plugins' `contextMenu` and by registered providers, in dispatch order. */
export function collectContextMenuEntries(cx: CanvasContext, hit: HitResult): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const p of listCanvasPlugins()) out.push(...(p.contextMenu?.(cx, hit) ?? []));
  for (const fn of providers) out.push(...(fn(cx, hit) ?? []));
  return out;
}

/** Re-renders the canvas when plugins are (un)registered. */
export function usePluginsVersion(): number {
  return useStore(version, (s) => s.v);
}

// ---------------------------------------------------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Routes pointer events to plugins. The canvas owns one instance. `down` returns whether a plugin consumed the event
 * (so the default select behaviour must be skipped); while a plugin holds a capture, move/up/cancel go only to it.
 */
export class PluginDispatcher {
  private captured: CanvasPlugin | null = null;
  private capturedPointer: number | null = null;

  constructor(private readonly list: () => CanvasPlugin[] = listCanvasPlugins) {}

  get capturing(): CanvasPlugin | null {
    return this.captured;
  }

  down(cx: CanvasContext, e: CanvasPointerEvent): boolean {
    if (this.captured) return true;
    for (const p of this.list()) {
      const r = p.onPointerDown?.(cx, e);
      if (r === 'capture') {
        this.captured = p;
        this.capturedPointer = e.pointerId;
        return true;
      }
      if (r === 'handled') return true;
    }
    return false;
  }

  /** Returns true when a plugin consumed the move (captured drag or handled hover). */
  move(cx: CanvasContext, e: CanvasPointerEvent): boolean {
    if (this.captured) {
      if (e.pointerId === this.capturedPointer) this.captured.onPointerMove?.(cx, e);
      return true;
    }
    for (const p of this.list()) if (p.onPointerMove?.(cx, e) === 'handled') return true;
    return false;
  }

  up(cx: CanvasContext, e: CanvasPointerEvent): boolean {
    const p = this.captured;
    if (!p) return false;
    if (e.pointerId !== this.capturedPointer) return true;
    this.captured = null;
    this.capturedPointer = null;
    p.onPointerUp?.(cx, e);
    return true;
  }

  /** Abort a captured sequence (Escape, pointercancel, blur, unmount). Returns true when one was active. */
  cancel(cx: CanvasContext): boolean {
    const p = this.captured;
    if (!p) return false;
    this.captured = null;
    this.capturedPointer = null;
    p.onPointerCancel?.(cx);
    return true;
  }

  /** Forget a captured sequence WITHOUT notifying the plugin (used when no context can be built any more). */
  reset(): void {
    this.captured = null;
    this.capturedPointer = null;
  }

  doubleClick(cx: CanvasContext, e: CanvasPointerEvent): boolean {
    for (const p of this.list()) if (p.onDoubleClick?.(cx, e) === 'handled') return true;
    return false;
  }

  key(cx: CanvasContext, e: KeyboardEvent): boolean {
    for (const p of this.list()) if (p.onKeyDown?.(cx, e) === 'handled') return true;
    return false;
  }

  cursor(cx: CanvasContext, e: CanvasPointerEvent): string | undefined {
    for (const p of this.list()) {
      const c = p.cursorAt?.(cx, e);
      if (c) return c;
    }
    return undefined;
  }
}
