/**
 * Shell-local UI state that is neither project data nor global UI (uiStore): dock sizes, drawers, palette, the live
 * validation flag. Sizes and the flag persist to localStorage (failure-safe).
 */
import { createStore, useStore } from 'zustand';

export const SHELL_STORAGE_KEY = 'schemacanvas:shell:v1';

export const WELCOME_STORAGE_KEY = 'schemacanvas:welcome:v1';

function readWelcomeDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(WELCOME_STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

export type Drawer = 'library' | 'properties' | null;

export interface ShellState {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  /** Open drawer in the medium / narrow layouts (docks are drawers there). */
  drawer: Drawer;
  paletteOpen: boolean;
  /** Debounced re-validation after model edits. */
  liveValidation: boolean;
  /** True when nothing was stored at startup (shows the first-run call to action). */
  firstRun: boolean;
  ready: boolean;
  /** First-run welcome: hidden for this session / remembered in localStorage ("Don't show again"). */
  welcomeHidden: boolean;
  welcomeDismissed: boolean;
  hideWelcome(forever: boolean): void;
  setLeftWidth(w: number): void;
  setRightWidth(w: number): void;
  setBottomHeight(h: number): void;
  setDrawer(d: Drawer): void;
  toggleDrawer(d: Exclude<Drawer, null>): void;
  setPalette(open: boolean): void;
  setLiveValidation(on: boolean): void;
  setFirstRun(v: boolean): void;
  setReady(v: boolean): void;
}

export const DOCK_LIMITS = {
  left: { min: 180, max: 420, def: 240 },
  right: { min: 240, max: 520, def: 300 },
  bottom: { min: 100, max: 520, def: 220 },
};

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(n)));

function read(): Partial<Pick<ShellState, 'leftWidth' | 'rightWidth' | 'bottomHeight' | 'liveValidation'>> {
  try {
    const raw = globalThis.localStorage?.getItem(SHELL_STORAGE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: ReturnType<typeof read> = {};
    if (typeof o.leftWidth === 'number') out.leftWidth = clamp(o.leftWidth, DOCK_LIMITS.left.min, DOCK_LIMITS.left.max);
    if (typeof o.rightWidth === 'number') out.rightWidth = clamp(o.rightWidth, DOCK_LIMITS.right.min, DOCK_LIMITS.right.max);
    if (typeof o.bottomHeight === 'number') out.bottomHeight = clamp(o.bottomHeight, DOCK_LIMITS.bottom.min, DOCK_LIMITS.bottom.max);
    if (typeof o.liveValidation === 'boolean') out.liveValidation = o.liveValidation;
    return out;
  } catch {
    return {};
  }
}

export const createShellStore = () => {
  const store = createStore<ShellState>()((set) => ({
    leftWidth: DOCK_LIMITS.left.def,
    rightWidth: DOCK_LIMITS.right.def,
    bottomHeight: DOCK_LIMITS.bottom.def,
    liveValidation: true,
    ...read(),
    drawer: null,
    paletteOpen: false,
    firstRun: false,
    ready: false,
    welcomeHidden: false,
    welcomeDismissed: readWelcomeDismissed(),
    hideWelcome: (forever) => {
      if (forever) {
        try {
          globalThis.localStorage?.setItem(WELCOME_STORAGE_KEY, 'dismissed');
        } catch {
          /* private mode: hidden for this session only */
        }
      }
      set(forever ? { welcomeHidden: true, welcomeDismissed: true } : { welcomeHidden: true });
    },
    setLeftWidth: (w) => set({ leftWidth: clamp(w, DOCK_LIMITS.left.min, DOCK_LIMITS.left.max) }),
    setRightWidth: (w) => set({ rightWidth: clamp(w, DOCK_LIMITS.right.min, DOCK_LIMITS.right.max) }),
    setBottomHeight: (h) => set({ bottomHeight: clamp(h, DOCK_LIMITS.bottom.min, DOCK_LIMITS.bottom.max) }),
    setDrawer: (drawer) => set({ drawer }),
    toggleDrawer: (d) => set((s) => ({ drawer: s.drawer === d ? null : d })),
    setPalette: (paletteOpen) => set({ paletteOpen }),
    setLiveValidation: (liveValidation) => set({ liveValidation }),
    setFirstRun: (firstRun) => set({ firstRun }),
    setReady: (ready) => set({ ready }),
  }));
  store.subscribe((s, prev) => {
    if (s.leftWidth === prev.leftWidth && s.rightWidth === prev.rightWidth && s.bottomHeight === prev.bottomHeight && s.liveValidation === prev.liveValidation) return;
    try {
      globalThis.localStorage?.setItem(SHELL_STORAGE_KEY, JSON.stringify({ leftWidth: s.leftWidth, rightWidth: s.rightWidth, bottomHeight: s.bottomHeight, liveValidation: s.liveValidation }));
    } catch {
      /* private mode: sizes last for the session */
    }
  });
  return store;
};

export const shellStore = createShellStore();
export const useShell = <T,>(selector: (s: ShellState) => T): T => useStore(shellStore, selector);
