/**
 * Locale-aware formatting for the UI (counts, lists, relative times), built on `Intl` so grouping, list joiners and
 * time units follow the user's language instead of English string concatenation.
 *
 *   formatCount(3, 'shell.tables')            "3 tables" / "3 个表"      (key = plural catalogue key, see core.tp)
 *   formatList(['a','b','c'])                  "a, b and c" / "a、b和c"
 *   formatRelativeTime(then, now)              "3 minutes ago" / "3分钟前"
 *   formatSavedAgo(then, now)                  "Saved 3 minutes ago" / "3分钟前已保存"
 */
import { currentLocale, t, tp, type Locale, type MessageParams } from './core';

/** BCP-47 tag per UI locale. `en-GB` joins lists as "a, b and c" (en-US would add an Oxford comma). */
const TAG: Record<Locale, string> = { en: 'en-GB', zh: 'zh-CN' };

export const intlLocale = (locale: Locale = currentLocale()): string => TAG[locale];

export function formatNumber(n: number, locale: Locale = currentLocale()): string {
  return new Intl.NumberFormat(TAG[locale]).format(n);
}

/** Plural-aware "N things": `key` is a `.one`/`.other` catalogue key; `{count}` is grouped per locale (1,200 / 1,200). */
export function formatCount(n: number, key: string, params?: MessageParams, locale: Locale = currentLocale()): string {
  // tp() picks one/other (English) or other (Chinese) and interpolates `{count}`; pass the grouped text for large counts.
  return tp(key, n, { ...params, count: formatNumber(n, locale) }, locale);
}

/** "a, b and c" / "a、b和c" (`or` for alternatives). Empty list gives an empty string. */
export function formatList(items: readonly string[], kind: 'and' | 'or' = 'and', locale: Locale = currentLocale()): string {
  if (items.length === 0) return '';
  return new Intl.ListFormat(TAG[locale], { style: 'long', type: kind === 'and' ? 'conjunction' : 'disjunction' }).format(items);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 minutes ago" for `then` seen from `now`; under 45 seconds is "just now". Future times read "in 3 minutes". */
export function formatRelativeTime(then: Date | number, now: Date | number = Date.now(), locale: Locale = currentLocale()): string {
  const seconds = Math.round((+then - +now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return t('format.justNow', undefined, locale);
  const rtf = new Intl.RelativeTimeFormat(TAG[locale], { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (abs >= size * 0.9 || unit === 'minute') return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.round(seconds / 60), 'minute');
}

/** "Saved 3 minutes ago" / "3分钟前已保存". */
export function formatSavedAgo(then: Date | number, now: Date | number = Date.now(), locale: Locale = currentLocale()): string {
  if (Math.abs(+then - +now) / 1000 < 45) return t('format.savedJustNow', undefined, locale);
  return t('format.savedAgo', { when: formatRelativeTime(then, now, locale) }, locale);
}

/** Medium date + short time in the user's language ("18 Oct 2026, 14:05" / "2026年10月18日 14:05"). */
export function formatDateTime(date: Date | number, locale: Locale = currentLocale()): string {
  return new Intl.DateTimeFormat(TAG[locale], { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
