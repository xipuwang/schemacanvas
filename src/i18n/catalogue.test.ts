/**
 * Consistency of ALL catalogues (every namespace, every feature file):
 *  (a) every key referenced literally from source code exists in en and zh (plural keys: .other in both, .one in en),
 *  (b) en and zh use the same {placeholders} per key,
 *  (c) no Chinese value is empty or merely a copy of the English text (unless it is language-neutral),
 *  (d) plural keys are complete (.one needs .other; zh has .other).
 * Gaps in files owned by other workers are listed in KNOWN_GAPS (exact keys) so the test stays green while they are
 * fixed; a gap NOT listed there fails, and a listed gap that no longer exists is reported by the last test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { catalogueEntries, hasMessage } from './core';

const entries = (): Array<[string, 'en' | 'zh', string, string]> =>
  [...catalogueEntries()].flatMap(([ns, c]) => (['en', 'zh'] as const).flatMap((loc) => Object.entries(c[loc]).map(([k, v]): [string, 'en' | 'zh', string, string] => [ns, loc, k, v])));

/** Missing keys found in files this worker does not own, with the owner to tell. Remove an entry once it is fixed. */
const KNOWN_GAPS: Record<string, string> = {};

/** Chinese values that legitimately equal the English text (product names, SQL, file formats, symbols). */
const SAME_OK =
  /^(?:[\p{P}\p{S}\d\s]*|[A-Z0-9_ ./:+#-]+|SQL|DBML|PDF|PNG|SVG|JSON|PostgreSQL|MySQL|SQLite|SchemaCanvas|Chen|ER|Chen ER|SQL \(DDL\)|1:1|1:N|M:N|N|M|P)$|CREATE TABLE|^Table \w+ \{|^\{ "/u;
/** Fragments may legitimately be empty (a clause that does not apply). */
const EMPTY_OK = /\.frag\./;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.|\.d\.ts$/.test(f) && !p.includes('/i18n/messages/') ? [p] : [];
  });
}

const placeholders = (text: string): string[] => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();

describe('(a) keys referenced from source exist', () => {
  const namespaces = () => new Set(catalogueEntries().keys());
  const referenced = (): Array<{ file: string; key: string; plural: boolean }> => {
    const out: Array<{ file: string; key: string; plural: boolean }> = [];
    const re = /\b(?:t|tr|tp|useT\(\)|translate)\(\s*'([a-z][A-Za-z]*\.[A-Za-z0-9_.-]+)'|\b(?:labelKey|titleKey|descriptionKey|hintKey|tooltipKey|nameKey|placeholderKey|ariaLabelKey): '([a-z][A-Za-z]*\.[A-Za-z0-9_.-]+)'/g;
    for (const file of walk('src')) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(re)) {
        const key = (m[1] ?? m[2])!;
        const whole = m[0];
        out.push({ file, key, plural: /^\s*tp\(/.test(whole) || /^tp\(/.test(whole) });
      }
    }
    return out;
  };
  it('every literal t()/tp()/labelKey key exists in en and zh', () => {
    const ns = namespaces();
    const missing: string[] = [];
    for (const { file, key, plural } of referenced()) {
      if (!ns.has(key.slice(0, key.indexOf('.')))) continue;
      const wanted = plural ? [`${key}.other`] : [key];
      for (const k of wanted) for (const loc of ['en', 'zh'] as const) if (!hasMessage(k, loc) && !(k in KNOWN_GAPS)) missing.push(`${file}: ${k} (${loc})`);
    }
    expect(missing).toEqual([]);
  });
});

describe('(b) placeholders match between en and zh', () => {
  it('every key uses the same {names} in both languages', () => {
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      for (const [k, en] of Object.entries(c.en)) {
        const zh = c.zh[k];
        if (zh === undefined) continue; // reported by catalogueGaps in i18n.test.ts
        const a = placeholders(en);
        const b = placeholders(zh);
        // Variant texts may deliberately use different params per language (zh uses structured params where en reuses the
        // module's English sentence); the zh side must then still only use params the module provides, which messages.test.ts checks.
        if (/^(issues|decisions)$/.test(ns)) continue;
        if (a.join() !== b.join()) bad.push(`${ns}.${k}: en {${a}} vs zh {${b}}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('issues / decisions: zh never uses a placeholder the English text of the same key lacks, except documented structured params', () => {
    const allowedExtra = new Set(['candidatesNeutral', 'keyColumns', 'sourceColumns', 'targetColumns', 'sourceRelation', 'targetRelation', 'dialect', 'at', 'ownerList', 'columnName', 'count']);
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      if (!/^(issues|decisions)$/.test(ns)) continue;
      for (const [k, en] of Object.entries(c.en)) {
        const extra = placeholders(c.zh[k] ?? '').filter((p) => !placeholders(en).includes(p) && !allowedExtra.has(p));
        if (extra.length) bad.push(`${ns}.${k}: zh-only {${extra}}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('(c) Chinese values are real translations', () => {
  it('no empty zh value (fragments excepted) and no zh value identical to English prose', () => {
    const empty: string[] = [];
    const same: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      for (const [k, zh] of Object.entries(c.zh)) {
        const en = c.en[k];
        if (zh.trim() === '' && !(en === '' || EMPTY_OK.test(k))) empty.push(`${ns}.${k}`);
        if (en !== undefined && zh === en && /[A-Za-z]{3,}/.test(en) && !SAME_OK.test(en.trim())) same.push(`${ns}.${k}: ${zh}`);
      }
    }
    expect(empty).toEqual([]);
    expect(same).toEqual([]);
  });

  it('Chinese text contains Chinese characters (or is language-neutral)', () => {
    const bad: string[] = [];
    for (const [ns, loc, k, v] of entries()) {
      if (loc !== 'zh' || v === '' || /\p{Script=Han}/u.test(v)) continue;
      if (!SAME_OK.test(v.trim()) && /[A-Za-z]{4,}/.test(v.replace(/\{\w+\}/g, '').replace(/\b(SQL|JSON|DBML|SVG|PNG|PDF|PostgreSQL|MySQL|SQLite|SchemaCanvas|NOT NULL|UNIQUE|PRIMARY KEY|CASCADE|RESTRICT|VARCHAR|INTEGER|TEXT|Chen)\b/g, ''))) bad.push(`${ns}.${k}: ${v}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('(d) plural keys are complete', () => {
  it('a `.one` / `.other` pair is complete in both languages (and `.other` exists in zh)', () => {
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      // Issue / decision variants named `one` / `many` / `other` are texts of one part, checked below.
      if (/^(issues|decisions)$/.test(ns)) continue;
      const stems = new Set<string>();
      for (const loc of ['en', 'zh'] as const) {
        for (const k of Object.keys(c[loc])) if (/\.(one|other)$/.test(k)) stems.add(k.replace(/\.(one|other)$/, ''));
      }
      for (const stem of stems) {
        const full = `${stem}.one`;
        // `X.one` can also mean the number one (a cardinality): it is a plural form only if `.other` exists somewhere.
        const isPlural = `${stem}.other` in c.en || `${stem}.other` in c.zh;
        if (!isPlural) continue;
        if (!(`${stem}.other` in c.en)) bad.push(`${ns}.${stem}.other missing (en)`);
        if (!(`${stem}.one` in c.en)) bad.push(`${ns}.${full} missing (en)`);
        if (!(`${stem}.other` in c.zh)) bad.push(`${ns}.${stem}.other missing (zh)`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('issue / decision plural variants: .one and .other come in pairs', () => {
    const bad: string[] = [];
    for (const ns of ['issues', 'decisions']) {
      const c = catalogueEntries().get(ns)!;
      for (const loc of ['en', 'zh'] as const) {
        for (const k of Object.keys(c[loc])) {
          const m = /^(.*\.(?:title|explanation|suggestion))\.(one|other)$/.exec(k);
          if (m && !(`${m[1]}.${m[2] === 'one' ? 'other' : 'one'}` in c[loc])) bad.push(`${ns}.${k} (${loc})`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('glossary (src/i18n/GLOSSARY.md)', () => {
  /** Variants of database terms that textbooks use but this product does not: the preferred term follows. */
  const AVOID: Record<string, string> = {
    外部键: '外键',
    外码: '外键',
    主码: '主键',
    候选码: '候选键',
    组合属性: '复合属性',
    完全参与: '全部参与',
    总参与: '全部参与',
    局部参与: '部分参与',
    导出属性: '派生属性',
    衍生属性: '派生属性',
    联系集: '联系',
    实体集: '实体',
    识别联系: '标识联系',
    多值性属性: '多值属性',
  };
  it('no Chinese catalogue uses an avoided variant of a glossary term', () => {
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      for (const [k, v] of Object.entries(c.zh)) for (const [term, use] of Object.entries(AVOID)) if (v.includes(term)) bad.push(`${ns}.${k}: "${term}" -> "${use}"`);
    }
    expect(bad).toEqual([]);
  });
});

describe('known gaps', () => {
  it('only lists keys that are still missing', () => {
    const fixed = Object.keys(KNOWN_GAPS).filter((k) => hasMessage(k, 'en') && hasMessage(k, 'zh'));
    expect(fixed).toEqual([]);
  });
});
