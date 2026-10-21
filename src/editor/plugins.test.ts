import { afterEach, describe, expect, it } from 'vitest';
import { PluginDispatcher, collectContextMenuEntries, listCanvasPlugins, registerCanvasPlugin, registerContextMenuProvider, type CanvasContext, type CanvasPlugin, type CanvasPointerEvent } from './plugins';

const cx = {} as CanvasContext;
const ev = (over: Partial<CanvasPointerEvent> = {}): CanvasPointerEvent => ({
  world: { x: 0, y: 0 },
  screen: { x: 0, y: 0 },
  clientX: 0,
  clientY: 0,
  button: 0,
  buttons: 1,
  pointerId: 1,
  pointerType: 'mouse',
  shiftKey: false,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  detail: 1,
  hit: { kind: 'none' },
  ...over,
});

/** A tiny recording plugin: proves dispatch order and capture semantics. */
function recorder(id: string, log: string[], result: 'capture' | 'handled' | undefined, priority = 0): CanvasPlugin {
  return {
    id,
    priority,
    onPointerDown: () => (log.push(`${id}:down`), result),
    onPointerMove: () => void log.push(`${id}:move`),
    onPointerUp: () => void log.push(`${id}:up`),
    onPointerCancel: () => void log.push(`${id}:cancel`),
  };
}

describe('PluginDispatcher', () => {
  it('runs plugins in priority order and stops at the first that consumes the event', () => {
    const log: string[] = [];
    const list = [recorder('low', log, 'handled', 0), recorder('high', log, undefined, 5), recorder('mid', log, 'handled', 2)];
    const sorted = [...list].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    const d = new PluginDispatcher(() => sorted);
    expect(d.down(cx, ev())).toBe(true);
    expect(log).toEqual(['high:down', 'mid:down']);
    expect(d.capturing).toBeNull(); // 'handled' does not capture
  });
  it('returns false when nobody is interested (default select behaviour runs)', () => {
    const log: string[] = [];
    const d = new PluginDispatcher(() => [recorder('a', log, undefined)]);
    expect(d.down(cx, ev())).toBe(false);
    expect(log).toEqual(['a:down']);
  });
  it('capture routes move/up only to the owner until the sequence ends', () => {
    const log: string[] = [];
    const a = recorder('a', log, undefined, 9);
    const b = recorder('b', log, 'capture', 1);
    const d = new PluginDispatcher(() => [a, b]);
    expect(d.down(cx, ev())).toBe(true);
    expect(d.capturing).toBe(b);
    log.length = 0;
    expect(d.move(cx, ev())).toBe(true);
    expect(d.move(cx, ev({ pointerId: 2 }))).toBe(true); // other pointers are swallowed, not forwarded
    expect(d.up(cx, ev())).toBe(true);
    expect(log).toEqual(['b:move', 'b:up']);
    expect(d.capturing).toBeNull();
    // after release hover goes through the whole chain again
    log.length = 0;
    d.move(cx, ev());
    expect(log).toEqual(['a:move', 'b:move']);
  });
  it('cancel aborts a captured sequence exactly once', () => {
    const log: string[] = [];
    const p = recorder('p', log, 'capture');
    const d = new PluginDispatcher(() => [p]);
    d.down(cx, ev());
    expect(d.cancel(cx)).toBe(true);
    expect(d.cancel(cx)).toBe(false);
    expect(log).toEqual(['p:down', 'p:cancel']);
    expect(d.up(cx, ev())).toBe(false);
  });
  it('a new down while captured does not restart the sequence', () => {
    const log: string[] = [];
    const p = recorder('p', log, 'capture');
    const d = new PluginDispatcher(() => [p]);
    d.down(cx, ev());
    d.down(cx, ev({ pointerId: 7 }));
    expect(log).toEqual(['p:down']);
  });
  it('hover: a plugin returning handled stops the chain; cursorAt: first string wins; keys and double clicks', () => {
    const log: string[] = [];
    const first: CanvasPlugin = { id: 'f', onPointerMove: () => (log.push('f'), 'handled'), cursorAt: () => 'crosshair', onKeyDown: () => 'handled', onDoubleClick: () => 'handled' };
    const second: CanvasPlugin = { id: 's', onPointerMove: () => void log.push('s'), cursorAt: () => 'grab' };
    const d = new PluginDispatcher(() => [first, second]);
    expect(d.move(cx, ev())).toBe(true);
    expect(log).toEqual(['f']);
    expect(d.cursor(cx, ev())).toBe('crosshair');
    expect(d.key(cx, { key: 'x' } as KeyboardEvent)).toBe(true);
    expect(d.doubleClick(cx, ev())).toBe(true);
  });
});

describe('plugin registry', () => {
  const offs: Array<() => void> = [];
  afterEach(() => offs.splice(0).forEach((f) => f()));
  it('orders by priority (desc) then registration, replaces by id, unregisters', () => {
    offs.push(registerCanvasPlugin({ id: 't-a', priority: 1 }));
    offs.push(registerCanvasPlugin({ id: 't-b', priority: 3 }));
    offs.push(registerCanvasPlugin({ id: 't-c', priority: 1 }));
    expect(listCanvasPlugins().map((p) => p.id).filter((i) => i.startsWith('t-'))).toEqual(['t-b', 't-a', 't-c']);
    const replacement: CanvasPlugin = { id: 't-a', priority: 9 };
    offs.push(registerCanvasPlugin(replacement));
    expect(listCanvasPlugins().filter((p) => p.id.startsWith('t-'))[0]).toBe(replacement);
    offs.pop()!();
    expect(listCanvasPlugins().some((p) => p.id === 't-a')).toBe(false);
  });
  it('collects context-menu entries from plugins and providers', () => {
    offs.push(registerCanvasPlugin({ id: 't-m', contextMenu: () => [{ kind: 'separator' }] }));
    offs.push(registerContextMenuProvider(() => [{ kind: 'item', id: 'x', label: 'X', run: () => undefined }]));
    const entries = collectContextMenuEntries(cx, { kind: 'none' });
    expect(entries.map((e) => e.kind)).toEqual(['separator', 'item']);
  });
});
