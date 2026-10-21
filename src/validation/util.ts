import type { Id } from '@/model/types';

/** Defensive: names are strings by contract, but a hand-edited file may carry anything. */
export const nameOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `"Name"` or `(unnamed)` for display inside messages. */
export const quote = (name: string): string => (name.trim() ? `"${name.trim()}"` : '(unnamed)');

export const quoteAll = (names: string[]): string => names.map(quote).join(', ');

/** Group items by key, keeping insertion order; items whose key is `undefined` are skipped. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

/** Entries with at least two members (duplicates). */
export const duplicatesOnly = <T>(groups: Map<string, T[]>): Array<[string, T[]]> =>
  [...groups.entries()].filter(([, v]) => v.length > 1);

export const uniqueIds = (ids: readonly Id[]): Id[] => [...new Set(ids)];

const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** Record lookup that ignores prototype keys (`toString`, `constructor`, ...) and non-string ids from hand-edited files. */
export const lookup = <T>(rec: Readonly<Record<string, T>>, id: unknown): T | undefined =>
  typeof id === 'string' && hasOwn(rec, id) ? rec[id] : undefined;

/** `value` if it is an array, else `[]` (hand-edited files may carry any type in optional fields). */
export const arrayOf = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Total order on (name, id) used to make titles/params/affected independent of record key order. */
export const byNameThenId = (a: { name?: unknown; id: string }, b: { name?: unknown; id: string }): number => {
  const x = nameOf(a.name);
  const y = nameOf(b.name);
  return x < y ? -1 : x > y ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};
