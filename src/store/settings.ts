/**
 * Per-browser UI preferences (NOT part of the project file). Persisted to localStorage; every storage access is
 * wrapped because it throws in private mode / with blocked site data and does not exist during SSR or tests.
 */
import { createStore, useStore, type StoreApi } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Locale = 'en' | 'zh';

export interface PanelVisibility {
  library: boolean;
  properties: boolean;
  issues: boolean;
}

export interface SettingsState {
  theme: ThemePreference;
  locale: Locale;
  panels: PanelVisibility;
  setTheme(theme: ThemePreference): void;
  setLocale(locale: Locale): void;
  setPanel(panel: keyof PanelVisibility, visible: boolean): void;
  togglePanel(panel: keyof PanelVisibility): void;
}

export const SETTINGS_STORAGE_KEY = 'schemacanvas:settings:v1';

export const DEFAULT_SETTINGS = {
  theme: 'system' as ThemePreference,
  locale: 'en' as Locale,
  panels: { library: true, properties: true, issues: false } as PanelVisibility,
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
  } catch {
    return undefined; // accessing the getter itself can throw (blocked site data)
  }
}

/** Parse stored JSON, keeping only valid fields; anything else falls back to the defaults. */
export function sanitizeSettings(raw: unknown): typeof DEFAULT_SETTINGS {
  const out = { ...DEFAULT_SETTINGS, panels: { ...DEFAULT_SETTINGS.panels } };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  if (o.theme === 'system' || o.theme === 'light' || o.theme === 'dark') out.theme = o.theme;
  if (o.locale === 'en' || o.locale === 'zh') out.locale = o.locale;
  if (o.panels && typeof o.panels === 'object') {
    const p = o.panels as Record<string, unknown>;
    for (const k of Object.keys(out.panels) as Array<keyof PanelVisibility>) if (typeof p[k] === 'boolean') out.panels[k] = p[k];
  }
  return out;
}

function readStored(storage: StorageLike | undefined): typeof DEFAULT_SETTINGS {
  try {
    const text = storage?.getItem(SETTINGS_STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : undefined);
  } catch {
    return sanitizeSettings(undefined);
  }
}

export function createSettingsStore(storage: StorageLike | undefined = defaultStorage()): StoreApi<SettingsState> {
  const store = createStore<SettingsState>()((set) => ({
    ...readStored(storage),
    setTheme: (theme) => set({ theme }),
    setLocale: (locale) => set({ locale }),
    setPanel: (panel, visible) => set((s) => ({ panels: { ...s.panels, [panel]: visible } })),
    togglePanel: (panel) => set((s) => ({ panels: { ...s.panels, [panel]: !s.panels[panel] } })),
  }));
  store.subscribe((s) => {
    try {
      storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ theme: s.theme, locale: s.locale, panels: s.panels }));
    } catch {
      // quota exceeded / private mode: preferences simply last for this session
    }
  });
  return store;
}

export const settingsStore = createSettingsStore();

export function useSettings(): SettingsState;
export function useSettings<T>(selector: (s: SettingsState) => T): T;
export function useSettings<T>(selector?: (s: SettingsState) => T): T | SettingsState {
  return useStore(settingsStore, selector ?? ((s) => s as unknown as T));
}

/** Resolve `system` against the OS preference (false-safe when `matchMedia` is unavailable). */
export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
