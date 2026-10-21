import type { Catalogue } from './core';

/** `[key, en, zh]`: one row per message keeps both languages side by side and makes a missing translation impossible. */
export type Row = readonly [key: string, en: string, zh: string];

/** Build a catalogue from rows; a duplicate key is a programming error. */
export function fromRows(rows: readonly Row[]): Catalogue {
  const en: Record<string, string> = {};
  const zh: Record<string, string> = {};
  for (const [key, e, z] of rows) {
    if (key in en) throw new Error(`duplicate catalogue key ${key}`);
    en[key] = e;
    zh[key] = z;
  }
  return { en, zh };
}

/** Rows for a validation/conversion issue triple. Variant rows use `<part>.<variant>` keys: `issue('x', ..., { explanation: { one: [en, zh] } })`. */
export function issue(
  code: string,
  title: readonly [string, string],
  explanation: readonly [string, string],
  suggestion: readonly [string, string],
): Row[] {
  return [
    [`${code}.title`, title[0], title[1]],
    [`${code}.explanation`, explanation[0], explanation[1]],
    [`${code}.suggestion`, suggestion[0], suggestion[1]],
  ];
}

/** One extra row `<code>.<part>.<variant>` (an alternative text of a part; the bare key may then be absent). */
export const variant = (code: string, part: 'title' | 'explanation' | 'suggestion', name: string, en: string, zh: string): Row => [
  `${code}.${part}.${name}`,
  en,
  zh,
];
