/**
 * Arrow-key nudges coalesce into ONE undo step: the first nudge opens a store transaction, every further nudge inside the idle
 * window (400 ms after the last one) updates it, and the window closing (or `flush()`: any other key, pointer press, blur,
 * unmount) ends it. The store is injected so the maths and the timing are testable without a DOM.
 */
import * as ops from '@/model/ops';
import type { Id, Project } from '@/model/types';
import { editorStore, type EditorStore } from '@/store';

export const NUDGE_IDLE_MS = 400;

export interface NudgeTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: NudgeTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class NudgeCoalescer {
  private open: { diagramId: Id; ids: string } | null = null;
  private timer: unknown = null;

  constructor(
    private readonly store: EditorStore,
    private readonly idleMs = NUDGE_IDLE_MS,
    private readonly timers: NudgeTimers = realTimers,
  ) {}

  get active(): boolean {
    return this.open !== null;
  }

  /** Move `ids` by (dx, dy). Returns false when another gesture owns the store transaction (the nudge is dropped). */
  nudge(diagramId: Id, ids: readonly Id[], dx: number, dy: number): boolean {
    return this.edit(diagramId, ids.join('\u0000'), (d) => void ops.moveNodesBy(d, diagramId, [...ids], dx, dy));
  }

  /**
   * One step of a coalesced burst of keyboard edits: `key` identifies WHAT is being edited (a different key closes the running burst
   * first), `recipe` is applied inside the open transaction. Returns false when another gesture owns the transaction.
   */
  edit(diagramId: Id, key: string, recipe: (draft: Project) => void, label = 'Nudge'): boolean {
    if (this.open && (this.open.diagramId !== diagramId || this.open.ids !== key)) this.flush();
    if (!this.open) {
      const st = this.store.getState();
      if (st.inTransaction) return false;
      st.beginTransaction(label);
      this.open = { diagramId, ids: key };
    }
    try {
      this.store.getState().updateTransaction(recipe);
    } catch (e) {
      this.cancel();
      throw e;
    }
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => this.flush(), this.idleMs);
    return true;
  }

  /** Close the burst now (one history entry; nothing recorded when it moved nothing). Safe to call at any time. */
  flush(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (!this.open) return;
    this.open = null;
    if (this.store.getState().inTransaction) this.store.getState().endTransaction();
  }

  /** Abandon the burst without a history entry. */
  cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (!this.open) return;
    this.open = null;
    this.store.getState().cancelTransaction();
  }
}

/** The one coalescer of the app (canvas arrow nudges and the keyboard connector editing share it, so they close each other's bursts). */
export const sharedNudger = new NudgeCoalescer(editorStore);
