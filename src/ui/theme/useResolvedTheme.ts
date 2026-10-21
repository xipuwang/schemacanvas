import { useEffect, useSyncExternalStore } from 'react';
import { resolveTheme, settingsStore, useSettings } from '@/store';

type Resolved = 'light' | 'dark';

function subscribeSystem(cb: () => void): () => void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
}

/** The concrete theme in effect (`system` follows `prefers-color-scheme` live). The canvas picks its palette from this. */
export function useResolvedTheme(): Resolved {
  const pref = useSettings((s) => s.theme);
  // Re-evaluate when the OS preference flips (only matters for `system`).
  return useSyncExternalStore(
    subscribeSystem,
    () => resolveTheme(pref),
    () => 'light',
  );
}

/** Sync `<html data-theme>` and `<html lang>` with settings. Mount once (AppShell). */
export function useApplyTheme(): Resolved {
  const resolved = useResolvedTheme();
  const locale = useSettings((s) => s.locale);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);
  return resolved;
}

/** Imperative variant for startup (before React mounts) to avoid a flash of the wrong theme. */
export function applyThemeNow(): void {
  const s = settingsStore.getState();
  document.documentElement.dataset.theme = resolveTheme(s.theme);
  document.documentElement.lang = s.locale === 'zh' ? 'zh-CN' : 'en';
}
