/**
 * Fidelity probe (dev tooling, not part of the normal test run). Run the WHOLE suite with every Issue and every conversion
 * decision checked against the catalogues as it is produced:
 *
 *   npx vitest run --config src/i18n/probe/vitest.config.ts src/validation src/conversion src/sql src/model src/integration src/examples
 *
 * Any message whose English catalogue text differs from the module's own text, that has no complete en + zh entry, whose
 * Chinese keeps an unfilled `{placeholder}`, or whose Chinese contains an English sentence fragment, throws inside the test
 * that produced it. The existing suites contain hundreds of broken and unusual models, so this reaches kinds of message the
 * curated corpus in messages.test.ts does not.
 */
import { vi } from 'vitest';

const ISSUE_PARTS = ['title', 'explanation', 'suggestion'] as const;
const unfilled = /\{[A-Za-z>]+\}/;
const englishRun = (text: string): boolean => /[A-Za-z]{4,} [a-z]{3,} [a-z]{3,}/.test(text.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, ''));

vi.mock('@/model/issues', async (orig) => {
  const mod = await orig<typeof import('@/model/issues')>();
  const { localizeIssue } = await import('@/i18n/issues');
  await import('@/i18n');
  return {
    ...mod,
    makeIssue: (init: Parameters<typeof mod.makeIssue>[0]) => {
      const issue = mod.makeIssue(init);
      for (const locale of ['en', 'zh'] as const) {
        const l = localizeIssue(issue, locale);
        if (!l.localized) throw new Error(`i18n probe: ${issue.code} has no complete ${locale} entry (params ${JSON.stringify(issue.params)})`);
        for (const p of ISSUE_PARTS) {
          if (locale === 'en' && l[p] !== issue[p]) {
            throw new Error(`i18n probe: ${issue.code}.${p} differs\n  module:    ${issue[p]}\n  catalogue: ${l[p]}\n  params: ${JSON.stringify(issue.params)}`);
          }
          if (locale === 'zh' && (unfilled.test(l[p]) || englishRun(l[p]))) {
            throw new Error(`i18n probe: ${issue.code}.${p} zh looks wrong: ${l[p]}`);
          }
        }
      }
      return issue;
    },
  };
});

vi.mock('@/conversion/convert', async (orig) => {
  const mod = await orig<typeof import('@/conversion/convert')>();
  const { localizeDecision } = await import('@/i18n/issues');
  await import('@/i18n');
  return {
    ...mod,
    convertErToRelational: (...args: Parameters<typeof mod.convertErToRelational>) => {
      const result = mod.convertErToRelational(...args);
      for (const d of result.record.decisions) {
        for (const locale of ['en', 'zh'] as const) {
          const l = localizeDecision(d, locale);
          if (!l.localized) throw new Error(`i18n probe: decision ${d.id} has no complete ${locale} entry (params ${JSON.stringify(d.params)})`);
          for (const p of ['title', 'explanation'] as const) {
            if (locale === 'en' && l[p] !== d[p]) throw new Error(`i18n probe: decision ${d.id}.${p} differs\n  module:    ${d[p]}\n  catalogue: ${l[p]}`);
            if (locale === 'zh' && (unfilled.test(l[p]) || englishRun(l[p]))) throw new Error(`i18n probe: decision ${d.id}.${p} zh looks wrong: ${l[p]}`);
          }
        }
      }
      return result;
    },
  };
});
