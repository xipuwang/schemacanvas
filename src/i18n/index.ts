// Bundled eagerly: the English catalogues of everything the first paint can show. Separate chunks: the Chinese catalogues
// (fetched by loadLocale('zh')) and the DEFERRED English ones, the texts of validation / conversion / DDL issues, which only
// appear after the user (or live validation) produced an issue and otherwise default to the identical English text the logic
// modules write themselves (localizeIssue falls back to it). scripts/vite-i18n-split.ts generates all module kinds from the
// single per-feature source files.
import { registerLocale, setLocaleLoader } from './core';

type Data = Record<string, Record<string, string>>;

for (const data of Object.values(import.meta.glob<Data>(['./messages/*.ts', '!./messages/{issues,conversion,ddl,decisions}.ts'], { query: '?locale=en', eager: true, import: 'default' }))) {
  registerLocale('en', data);
}
const enDeferred = import.meta.glob<Data>('./messages/{issues,conversion,ddl,decisions}.ts', { query: '?locale=en', import: 'default' });
const zhModules = import.meta.glob<Data>('./messages/*.ts', { query: '?locale=zh', import: 'default' });
const all = (modules: Record<string, () => Promise<Data>>) => () => Promise.all(Object.keys(modules).sort().map((k) => modules[k]!()));
setLocaleLoader('en', all(enDeferred));
setLocaleLoader('zh', all(zhModules));

export { t, tp, useT, hasMessage, defineMessages, registerMessages, registeredNamespaces, catalogueGaps, currentLocale, loadLocale, setLocaleLoaded, isLocaleLoaded } from './core';
export type { LocaleSwitch } from './core';
export type { Catalogue, Locale, MessageParams } from './core';
export { localizeIssue, localizeDecision, localizeRule, type LocalizedIssue, type LocalizedDecision } from './issues';
export { localizeLoadError, localizeOpError, localizeInvariant } from './errors';
export { formatCount, formatList, formatNumber, formatRelativeTime, formatSavedAgo, formatDateTime } from './format';
export { displayDiagramName, isDefaultDiagramName } from './defaultNames';
