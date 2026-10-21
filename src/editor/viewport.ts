/**
 * Pure viewport math. A `Viewport` is `{ x, y, zoom }` with  `screen = world * zoom + (x, y)`, where `screen` is
 * relative to the top-left of the canvas container (NOT the page).
 */
import type { Point, Viewport } from '@/model/types';
import type { Rect } from '@/scene/base';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1);

export const worldToScreen = (v: Viewport, p: Point): Point => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });
export const screenToWorld = (v: Viewport, p: Point): Point => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });

/** Zoom to `zoom` keeping the world point under `screenPoint` fixed. */
export function zoomAround(v: Viewport, zoom: number, screenPoint: Point): Viewport {
  const z = clampZoom(zoom);
  const w = screenToWorld(v, screenPoint);
  return { zoom: z, x: screenPoint.x - w.x * z, y: screenPoint.y - w.y * z };
}

export const panBy = (v: Viewport, dx: number, dy: number): Viewport => ({ ...v, x: v.x + dx, y: v.y + dy });

export interface FitOptions {
  /** Screen margin around the content, px. */
  margin?: number;
  /** Never zoom in beyond this (fit of a tiny diagram must not blow it up). */
  maxZoom?: number;
}

/** Viewport that shows `rect` (world) centred in a `size` container. */
export function fitRect(rect: Rect, size: { w: number; h: number }, opts: FitOptions = {}): Viewport {
  const margin = opts.margin ?? 48;
  const maxZoom = opts.maxZoom ?? 2;
  const availW = Math.max(1, size.w - margin * 2);
  const availH = Math.max(1, size.h - margin * 2);
  const zoom = clampZoom(Math.min(maxZoom, availW / Math.max(1, rect.w), availH / Math.max(1, rect.h)));
  return {
    zoom,
    x: size.w / 2 - (rect.x + rect.w / 2) * zoom,
    y: size.h / 2 - (rect.y + rect.h / 2) * zoom,
  };
}

/** Empty diagram: world origin in the centre of the container at 100%. */
export const originCentered = (size: { w: number; h: number }): Viewport => ({ zoom: 1, x: size.w / 2, y: size.h / 2 });

/** The world rectangle visible in a `size` container. */
export function visibleWorldRect(v: Viewport, size: { w: number; h: number }): Rect {
  const tl = screenToWorld(v, { x: 0, y: 0 });
  return { x: tl.x, y: tl.y, w: size.w / v.zoom, h: size.h / v.zoom };
}

export const sameViewport = (a: Viewport, b: Viewport): boolean => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

// ---- animated zoom / fit ---------------------------------------------------------------------------------------------------

export const VIEW_ANIM_MS = 150;

/** Ease-out cubic: fast start, gentle landing. `t` is clamped to 0..1. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Viewport between `a` and `b` at eased progress `t`: zoom interpolates geometrically (equal ratios per frame), the offset linearly. */
export function interpolateView(a: Viewport, b: Viewport, t: number): Viewport {
  if (t <= 0) return a;
  if (t >= 1) return b;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom: a.zoom * Math.pow(b.zoom / a.zoom, t) };
}
