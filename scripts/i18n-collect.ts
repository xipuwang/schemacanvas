/**
 * Build-time helper of scripts/vite-i18n-split.ts (loaded through Vite's `runnerImport`, never part of the app bundle):
 * evaluates every `src/i18n/messages/*.ts` catalogue file and returns, per file, the namespaces it contributed with the
 * English and the Chinese half separately, so the Chinese half can ship as an on-demand chunk.
 */
import { catalogueEntries } from '../src/i18n/core';

export type SplitCatalogue = Record<string, { en: Record<string, Record<string, string>>; zh: Record<string, Record<string, string>> }>;

const files = import.meta.glob('../src/i18n/messages/*.ts');

async function collect(): Promise<SplitCatalogue> {
  const out: SplitCatalogue = {};
  // A file may register several namespaces (and several files one namespace): attribute to a file every key it added or changed.
  const snapshot = () => new Map([...catalogueEntries()].map(([ns, c]) => [ns, { en: { ...c.en }, zh: { ...c.zh } }]));
  for (const path of Object.keys(files).sort()) {
    const before = snapshot();
    await files[path]!();
    const entry: SplitCatalogue[string] = { en: {}, zh: {} };
    for (const [ns, c] of catalogueEntries()) {
      for (const locale of ['en', 'zh'] as const) {
        const prev = before.get(ns)?.[locale] ?? {};
        for (const [k, v] of Object.entries(c[locale])) {
          if (prev[k] !== v) (entry[locale][ns] ??= {})[k] = v;
        }
      }
    }
    out[path.slice(path.lastIndexOf('/') + 1)] = entry;
  }
  return out;
}

// `runnerImport` closes its module runner once the entry has evaluated, so everything is loaded during evaluation.
export const catalogues: SplitCatalogue = await collect();
