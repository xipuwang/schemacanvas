/**
 * i18n core. Every user-visible string goes through `t()` / `useT()`.
 *
 * Catalogues are PER FEATURE (`src/i18n/messages/<namespace>.ts`, auto-registered by `src/i18n/index.ts` through
 * `import.meta.glob`) so parallel workers never edit the same file. A catalogue file default-exports
 * `defineMessages('<namespace>', { en: {...}, zh: {...} })`; the full key is `<namespace>.<key>`.
 * LOADING: authoring keeps both languages side by side, but the app bundle only carries English: scripts/vite-i18n-split.ts
 * turns each file into an `en` module (eager) and a `zh` module (a separate chunk), and `loadLocale('zh')` fetches the latter.
 * `setLocaleLoaded(locale)` is the only way the UI flips the language, so no key is ever shown while zh is still downloading.
 *   - interpolation: `Delete {name}?`  → t('x.delete', { name })
 *   - plurals: keys `foo.one` / `foo.other` → `tp('x.foo', count)` (`{count}` is interpolated; zh only needs `.other`)
 * Fallback order: requested locale → English → the key itself (so a missing translation is visible, never blank).
 * `i18n.test.ts` fails when `zh` lacks a key that `en` has (and vice-versa) in any registered namespace.
 */
import { useStore } from 'zustand';
import { settingsStore, type Locale } from '@/store/settings';

export type { Locale };
export type MessageParams = Record<string, string | number>;
export interface Catalogue {
  en: Record<string, string>;
  zh: Record<string, string>;
}

const catalogues = new Map<string, Catalogue>();

export function defineMessages(namespace: string, catalogue: Catalogue): Catalogue & { namespace: string } {
  registerMessages(namespace, catalogue);
  return { namespace, ...catalogue };
}

/** Registering a namespace again MERGES into it (several feature files may contribute to e.g. `commands`). */
export function registerMessages(namespace: string, catalogue: Catalogue): void {
  const existing = catalogues.get(namespace);
  catalogues.set(
    namespace,
    existing
      ? { en: { ...existing.en, ...catalogue.en }, zh: { ...existing.zh, ...catalogue.zh } }
      : { en: { ...catalogue.en }, zh: { ...catalogue.zh } },
  );
}

/** Merge one language of several namespaces (`{ namespace: { key: text } }`), the shape of a split catalogue module. */
export function registerLocale(locale: Locale, data: Record<string, Record<string, string>>): void {
  for (const [namespace, messages] of Object.entries(data)) {
    registerMessages(namespace, locale === 'en' ? { en: messages, zh: {} } : { en: {}, zh: messages });
  }
}

type LocaleLoader = () => Promise<Array<Record<string, Record<string, string>>>>;
const loaders: Partial<Record<Locale, LocaleLoader>> = {};
const loading = new Map<Locale, Promise<void>>();
const loaded = new Set<Locale>();

/** Installed by `src/i18n/index.ts`: how to fetch the catalogue modules of a locale that are not bundled eagerly (`en`: the deferred ones). */
export function setLocaleLoader(locale: Locale, loader: LocaleLoader): void {
  loaders[locale] = loader;
}

export const isLocaleLoaded = (locale: Locale): boolean => loaded.has(locale);

/** Load (once) every non-eager catalogue of `locale`. Rejects when the download fails; a later call retries. */
export function loadLocale(locale: Locale): Promise<void> {
  if (loaded.has(locale)) return Promise.resolve();
  let p = loading.get(locale);
  if (!p) {
    const loader = loaders[locale];
    if (!loader && locale === 'en') return Promise.resolve(); // core used without the registry: nothing deferred
    if (!loader) return Promise.reject(new Error(`no catalogue loader for locale ${locale}`));
    p = loader()
      .then((modules) => {
        for (const data of modules) registerLocale(locale, data);
        loaded.add(locale);
      })
      .finally(() => loading.delete(locale));
    loading.set(locale, p);
  }
  return p;
}

/** Switch the UI language: awaits the catalogues first so the switch is atomic. Download failure keeps the current language. */
let localeRequest = 0;
export type LocaleSwitch = 'applied' | 'superseded' | 'failed';
/**
 * Latest request wins: a slower, superseded switch (en -> zh still downloading, then back to en) resolves 'superseded' and
 * changes nothing; callers report only 'failed' (a superseded request that also failed is still just 'superseded').
 */
export async function setLocaleLoaded(locale: Locale): Promise<LocaleSwitch> {
  const token = ++localeRequest;
  let failed = false;
  try {
    await loadLocale(locale);
  } catch {
    failed = true;
  }
  if (token !== localeRequest) return 'superseded';
  if (failed) return 'failed';
  settingsStore.getState().setLocale(locale);
  return 'applied';
}

/** Read-only view of every registered catalogue (namespace → {en, zh}); for the catalogue consistency tests. */
export function catalogueEntries(): ReadonlyMap<string, Readonly<Catalogue>> {
  return catalogues;
}

export function registeredNamespaces(): string[] {
  return [...catalogues.keys()].sort();
}

/** For the completeness test: keys present in one locale but missing in the other, per namespace. */
export function catalogueGaps(): Array<{ namespace: string; missingIn: Locale; keys: string[] }> {
  const gaps: Array<{ namespace: string; missingIn: Locale; keys: string[] }> = [];
  for (const [namespace, c] of catalogues) {
    const en = new Set(Object.keys(c.en));
    const zh = new Set(Object.keys(c.zh));
    const missingZh = [...en].filter((k) => !zh.has(k));
    const missingEn = [...zh].filter((k) => !en.has(k));
    if (missingZh.length) gaps.push({ namespace, missingIn: 'zh', keys: missingZh });
    if (missingEn.length) gaps.push({ namespace, missingIn: 'en', keys: missingEn });
  }
  return gaps;
}

function lookup(key: string, locale: Locale): string | undefined {
  const dot = key.indexOf('.');
  if (dot < 0) return undefined;
  const cat = catalogues.get(key.slice(0, dot));
  return cat?.[locale][key.slice(dot + 1)];
}

function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

export const currentLocale = (): Locale => settingsStore.getState().locale;

/** Translate `key` (`namespace.key`). Pass `locale` only in tests / exports; default is the user's locale. */
export function t(key: string, params?: MessageParams, locale: Locale = currentLocale()): string {
  const template = lookup(key, locale) ?? lookup(key, 'en');
  return template === undefined ? key : interpolate(template, params);
}

/** Does a translation exist (in the given locale, no fallback)? Lets UIs prefer a specific key over a generic one. */
export function hasMessage(key: string, locale: Locale = currentLocale()): boolean {
  return lookup(key, locale) !== undefined;
}

/** Plural-aware: tries `${key}.one` for count === 1 (English), else `${key}.other`; `{count}` is available. */
export function tp(key: string, count: number, params?: MessageParams, locale: Locale = currentLocale()): string {
  const form = locale === 'en' && count === 1 ? 'one' : 'other';
  const k = hasMessage(`${key}.${form}`, locale) || locale === 'en' ? `${key}.${form}` : `${key}.other`;
  return t(k, { count, ...params }, locale);
}

/** React hook: re-renders on locale change; returns a `t` bound to the current locale. */
export function useT(): (key: string, params?: MessageParams) => string {
  const locale = useStore(settingsStore, (s) => s.locale);
  return (key, params) => t(key, params, locale);
}
