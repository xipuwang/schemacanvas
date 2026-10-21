/**
 * Splits the per-feature catalogues (`src/i18n/messages/<file>.ts`, authored with English and Chinese side by side) into
 * a per-language module graph so the Chinese half is NOT part of the initial bundle:
 *
 *   import '<file>.ts?locale=en'  ->  export default { <namespace>: { key: 'English text', ... }, ... }
 *   import '<file>.ts?locale=zh'  ->  same shape, Chinese text (dynamic import, loaded by `loadLocale('zh')`)
 *
 * The catalogue files stay the single source of truth; this plugin evaluates them once per process (through Vite's own
 * module runner, so the `@` alias, TypeScript and the `fromRows` helpers all work) and caches the result.
 */
import { fileURLToPath } from 'node:url';
import { runnerImport, type Plugin } from 'vite';
import type { SplitCatalogue } from './i18n-collect.ts';

const MESSAGES = /\/src\/i18n\/messages\/([^/?]+\.ts)\?locale=(en|zh)$/;
const SOURCES = /\/src\/i18n\/(messages\/[^/]+|core|build)\.ts$/;

export function i18nSplit(): Plugin {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const collector = fileURLToPath(new URL('./i18n-collect.ts', import.meta.url));
  let cache: Promise<SplitCatalogue> | undefined;
  const evaluate = (): Promise<SplitCatalogue> =>
    (cache ??= runnerImport<typeof import('./i18n-collect.ts')>(collector, {
      configFile: false,
      root,
      logLevel: 'silent',
      resolve: { alias: { '@': `${root}src` } },
    }).then((r) => r.module.catalogues));
  return {
    name: 'schemacanvas-i18n-split',
    enforce: 'pre',
    async load(id) {
      const m = MESSAGES.exec(id.replaceAll('\\', '/'));
      if (!m) return null;
      const data = (await evaluate())[m[1]!];
      if (!data) throw new Error(`i18n split: no catalogue evaluated for ${m[1]}`);
      this.addWatchFile(id.slice(0, id.indexOf('?')));
      return `export default ${JSON.stringify(data[m[2] as 'en' | 'zh'])};`;
    },
    handleHotUpdate({ file, server }) {
      if (!SOURCES.test(file.replaceAll('\\', '/'))) return;
      cache = undefined;
      const mods = [...server.moduleGraph.idToModuleMap.values()].filter((mod) => MESSAGES.test(mod.id ?? ''));
      for (const mod of mods) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
      return [];
    },
  };
}
