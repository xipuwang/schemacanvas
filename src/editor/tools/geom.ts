/** Small pure geometry helpers shared by the tools (all in WORLD units unless a name says `Px`). */
import type { Point } from '@/model/types';
import type { Rect } from '@/scene/base';

/** Minimum screen size of any grab target (px): large enough for a fingertip-ish hit area at every zoom. */
export const HIT_PX = 9;
/** Drag distance (screen px) before a press becomes a drag. */
export const DRAG_PX = 3;

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));
export const snapTo = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
export const center = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
