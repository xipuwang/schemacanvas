import { describe, expect, it, vi } from 'vitest';
import { NUDGE_IDLE_MS, NudgeCoalescer } from './nudge';
import { makeStore } from './testFixtures';

describe('nudge coalescing', () => {
  const setup = () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const s = makeStore('rel');
    const ids = Object.keys(s.store.getState().project.diagrams[s.diagramId]!.nodes).slice(0, 2);
    const pos = () => ids.map((id) => ({ x: s.store.getState().project.diagrams[s.diagramId]!.nodes[id]!.x, y: s.store.getState().project.diagrams[s.diagramId]!.nodes[id]!.y }));
    return { ...s, ids, pos, co: new NudgeCoalescer(s.store) };
  };

  it('a burst of presses inside the idle window is ONE undo step with the summed move', () => {
    const { store, diagramId, ids, pos, co } = setup();
    const before = pos();
    const depth = store.getState().undoStack.length;
    for (let i = 0; i < 6; i++) {
      expect(co.nudge(diagramId, ids, 10, 0)).toBe(true);
      vi.advanceTimersByTime(NUDGE_IDLE_MS - 50);
    }
    expect(store.getState().inTransaction).toBe(true);
    expect(pos()[0]!.x).toBe(before[0]!.x + 60);
    vi.advanceTimersByTime(NUDGE_IDLE_MS);
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().undoStack.length).toBe(depth + 1);
    expect(store.getState().undoStack.at(-1)!.label).toBe('Nudge');
    store.getState().undo();
    expect(pos()).toEqual(before);
    store.getState().redo();
    expect(pos()[1]!.x).toBe(before[1]!.x + 60);
    vi.useRealTimers();
  });

  it('presses further apart than the window are separate steps', () => {
    const { store, diagramId, ids, co } = setup();
    const depth = store.getState().undoStack.length;
    co.nudge(diagramId, ids, 10, 0);
    vi.advanceTimersByTime(NUDGE_IDLE_MS + 1);
    co.nudge(diagramId, ids, 0, 10);
    vi.advanceTimersByTime(NUDGE_IDLE_MS + 1);
    expect(store.getState().undoStack.length).toBe(depth + 2);
    vi.useRealTimers();
  });

  it('flush() closes the burst immediately; a changed selection starts a new step', () => {
    const { store, diagramId, ids, co } = setup();
    const depth = store.getState().undoStack.length;
    co.nudge(diagramId, ids, 10, 0);
    co.nudge(diagramId, [ids[0]!], 10, 0);
    expect(store.getState().undoStack.length).toBe(depth + 1);
    co.flush();
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().undoStack.length).toBe(depth + 2);
    co.flush(); // idempotent
    expect(store.getState().undoStack.length).toBe(depth + 2);
    vi.useRealTimers();
  });

  it('cancel() restores the positions and records nothing', () => {
    const { store, diagramId, ids, pos, co } = setup();
    const before = pos();
    const depth = store.getState().undoStack.length;
    co.nudge(diagramId, ids, 30, 30);
    co.cancel();
    expect(pos()).toEqual(before);
    expect(store.getState().inTransaction).toBe(false);
    expect(store.getState().undoStack.length).toBe(depth);
    vi.useRealTimers();
  });

  it('is dropped (not thrown) while another gesture owns the transaction', () => {
    const { store, diagramId, ids, co } = setup();
    store.getState().beginTransaction('Move');
    expect(co.nudge(diagramId, ids, 10, 0)).toBe(false);
    store.getState().cancelTransaction();
    vi.useRealTimers();
  });
});
