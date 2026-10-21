/**
 * Transient keyboard-interaction state (cell mode, connector handle focus, keyboard connect). NOT project data, never history.
 * `live` is the text of the canvas aria-live region while one of these modes owns the announcements.
 */
import { createStore, useStore } from 'zustand';
import type { Id } from '@/model/types';
import type { CellModeState } from './cellMode';

export interface KbState {
  cell: CellModeState | null;
  /** The connector whose handles `[` / `]` walk, and the focused handle (an `EdgeFocus.id`). */
  edgeId: Id | null;
  edgeFocus: string | null;
  /** Chen keyboard connect: the shape the connection starts from. */
  link: { fromNodeId: Id } | null;
  live: string;
}

export const kbStore = createStore<KbState>(() => ({ cell: null, edgeId: null, edgeFocus: null, link: null, live: '' }));
export const useKb = <T,>(selector: (s: KbState) => T): T => useStore(kbStore, selector);

/** A live message is meant to be heard once: it is dropped after this long so a later reader never meets stale text. */
const LIVE_TTL_MS = 10_000;
let liveTimer: ReturnType<typeof setTimeout> | undefined;

/** Replace the live text (a zero-width suffix makes an identical repeat announce again); it expires on its own. */
export const kbAnnounce = (text: string): void => {
  kbStore.setState((s) => ({ live: s.live === text ? `${text}​` : text }));
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = text ? setTimeout(() => kbStore.setState({ live: '' }), LIVE_TTL_MS) : undefined;
};

/** Drop whatever the live region says now (an action finished; its "type a name" hint must not outlive it). */
export const kbClearLive = (): void => kbAnnounce('');

export const resetKb = (): void => kbStore.setState({ cell: null, edgeId: null, edgeFocus: null, link: null, live: '' });
