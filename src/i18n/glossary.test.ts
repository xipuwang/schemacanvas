/**
 * Vocabulary guard over ALL Chinese catalogues (every namespace, every feature file). The canonical terms and the
 * 关系模式 / 属性 versus 表 / 列 context rule are in GLOSSARY.md. This test fails when a catalogue reintroduces a
 * variant the glossary replaced, or when a zh value interpolates different parameters than the English text.
 * Violations in files owned by other workers are listed (exact key) in PENDING so the suite stays green while they are
 * fixed; a PENDING entry that no longer violates is reported by the last test.
 */
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { catalogueEntries } from './core';

/** Variant -> canonical term. Checked as substring on every zh value. */
const FORBIDDEN: Record<string, string> = {
  所有者: '属主实体 (SQL ownership: 拥有者)',
  所属实体: '属主实体',
  属主表: '属主实体',
  参与度: '参与约束',
  全参与: '全部参与',
  半参与: '部分参与',
  校验: '检查',
  验证: '检查',
  字段: '属性 (relational diagrams) or 列 (SQL / table elements)',
  父表: '被引用的表 / 被参照关系模式',
  子表: '引用的表 / 参照关系模式',
  外联: '外键',
  关联表: '连接表 / 关系模式',
  弱实体集: '弱实体',
  强实体集: '强实体',
  基数比: '基数',
  鸦脚: '鸭脚',
  吸附网格: '对齐网格',
};

/** Exact `namespace.key` entries of files this worker does not own that still violate the glossary: `key: term`. */
const PENDING: Record<string, string> = {};

const zhEntries = (): Array<[string, string, string]> =>
  [...catalogueEntries()].flatMap(([ns, c]) => Object.entries(c.zh).map(([k, v]): [string, string, string] => [ns, k, v]));

describe('glossary: forbidden variants', () => {
  it('no Chinese value uses a variant the glossary replaced', () => {
    const bad: string[] = [];
    for (const [ns, k, v] of zhEntries()) {
      for (const [term, use] of Object.entries(FORBIDDEN)) {
        if (v.includes(term) && PENDING[`${ns}.${k}`] !== term) bad.push(`${ns}.${k}: "${term}" -> ${use}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('PENDING lists only keys that still violate', () => {
    const live = new Set(zhEntries().flatMap(([ns, k, v]) => Object.keys(FORBIDDEN).filter((t) => v.includes(t)).map((t) => `${ns}.${k}:${t}`)));
    const stale = Object.entries(PENDING).filter(([k, t]) => !live.has(`${k}:${t}`));
    expect(stale).toEqual([]);
  });

  it('the ER-to-relational convert dialog speaks the relational model (关系模式 / 属性), not table / column', () => {
    const bad = zhEntries()
      .filter(([ns, k]) => ns === 'dialogs' && k.startsWith('convert.'))
      .filter(([, , v]) => /[表列]/.test(v.replace(/CREATE TABLE/g, '').replace(/列号|列表|表达|表示|表现|代表/g, '')))
      .map(([ns, k, v]) => `${ns}.${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it('quotation marks: Chinese text uses “ ” for names, never straight double quotes around words', () => {
    const bad = zhEntries()
      .filter(([, k]) => !/placeholder/i.test(k))
      .filter(([, , v]) => /"[^"{}\n]*\p{Script=Han}[^"{}\n]*"/u.test(v))
      .map(([ns, k, v]) => `${ns}.${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});

describe('glossary: interpolation parameters', () => {
  const names = (s: string): string[] => [...new Set([...s.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!))].sort();

  it('every zh value interpolates the same {params} as its English text (non-variant namespaces)', () => {
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      if (/^(issues|decisions)$/.test(ns)) continue;
      for (const [k, zh] of Object.entries(c.zh)) {
        const en = c.en[k];
        if (en === undefined) continue;
        if (names(en).join('|') !== names(zh).join('|')) bad.push(`${ns}.${k}: en {${names(en)}} vs zh {${names(zh)}}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('issues / decisions: zh only uses params the English entry of the same key can supply (or the documented structured ones)', () => {
    const structured = new Set(['candidatesNeutral', 'keyColumns', 'sourceColumns', 'targetColumns', 'sourceRelation', 'targetRelation', 'dialect', 'at', 'ownerList', 'columnName', 'count']);
    const bad: string[] = [];
    for (const [ns, c] of catalogueEntries()) {
      if (!/^(issues|decisions)$/.test(ns)) continue;
      for (const [k, zh] of Object.entries(c.zh)) {
        const en = names(c.en[k] ?? '');
        const extra = names(zh).filter((p) => !en.includes(p) && !structured.has(p) && !p.startsWith('>'));
        if (extra.length) bad.push(`${ns}.${k}: zh-only {${extra}}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('braces are balanced and never full-width in any zh value', () => {
    const bad = zhEntries()
      .filter(([, , v]) => v.split('{').length !== v.split('}').length || /[｛｝]/.test(v))
      .map(([ns, k, v]) => `${ns}.${k}: ${v}`);
    expect(bad).toEqual([]);
  });
});
