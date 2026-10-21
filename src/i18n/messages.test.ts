/**
 * Completeness and fidelity of the logic-module catalogues (namespaces `issues`, `decisions`, `errors`).
 *  1. Every code the modules can emit (enumerated from the registries / closed lists) has a complete en + zh entry.
 *  2. Every catalogue key belongs to a known code (no orphans from renamed rules).
 *  3. Over a corpus of REAL module output (examples, mutated models, DDL, SQL/DBML import) the English catalogue
 *     reproduces the module's own text and the Chinese text has no unfilled placeholder and no English run.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { CONVERSION_RULE_IDS } from '@/model/conversionRules';
import type { ConversionDecision, ErModel, Issue, Project, RelationalModel } from '@/model/types';
import { convertErToRelational } from '@/conversion';
import { CONV_OPS_CODES, CONV_WARNING_CODES, DECISION_KINDS } from '@/conversion/codes';
import { EXAMPLES, buildExample } from '@/examples';
import { DBML_EXPORT_CODES, DBML_IMPORT_CODES, DDL_CODES, DDL_DIALECTS, SQL_IMPORT_CODES } from '@/sql/codes';
import { exportDbmlDetailed, generateDdl, importDbml, parseDdl } from '@/sql';
import { kitchenSink, pharmacy } from '@/sql/fixtures';
import { check, pharmacyEr, pharmacyRel } from '@/validation/fixtures';
import { RULES, validateProject } from '@/validation';
import { catalogueGaps, hasMessage, registeredNamespaces, t } from './core';
import { INVARIANT_CODES, LOAD_ERROR_CODES, OP_ERROR_CODES } from './errors';
import { issueBase, localizeDecision, localizeIssue, localizeRule, resolveKey, ISSUE_PARTS } from './issues';

const LOCALES = ['en', 'zh'] as const;

/** Is there any text for `<base>.<part>` (bare or variant) in `locale`? */
function hasPart(base: string, part: string, locale: 'en' | 'zh'): boolean {
  const prefix = `${base}.${part}`;
  return hasMessage(prefix, locale) || keysOf(locale).some((k) => k.startsWith(`${prefix}.`));
}

const keyCache: Partial<Record<'en' | 'zh', string[]>> = {};
/** Full keys of the logic-module catalogues. */
function keysOf(locale: 'en' | 'zh'): string[] {
  return (keyCache[locale] ??= allKeys(locale));
}
function allKeys(locale: 'en' | 'zh'): string[] {
  const out: string[] = [];
  // The registry is private to core.ts; rebuild the key list from the catalogue modules (they default-export their catalogue).
  for (const mod of Object.values(modules)) {
    const cat = (mod as { default: { namespace: string; en: Record<string, string>; zh: Record<string, string> } }).default;
    for (const k of Object.keys(cat[locale])) out.push(`${cat.namespace}.${k}`);
  }
  return out;
}
const modules = import.meta.glob('./messages/{issues,conversion,ddl,decisions,errors}.ts', { eager: true });

const issueCodes = (): string[] => [
  ...RULES.map((r) => r.code),
  ...CONV_WARNING_CODES,
  ...CONV_OPS_CODES,
  ...DDL_CODES.map((c) => `ddl.*.${c}`),
  ...SQL_IMPORT_CODES.map((c) => `sql.import.${c}`),
  ...DBML_IMPORT_CODES.map((c) => `dbml.import.${c}`),
  ...DBML_EXPORT_CODES.map((c) => `dbml.export.${c}`),
];
const baseOf = (code: string): string => (code.startsWith('ddl.*.') ? `issues.ddl.${code.slice(6)}` : `issues.${code}`);

describe('inventory', () => {
  it('lists every validation rule once', () => {
    expect(new Set(RULES.map((r) => r.code)).size).toBe(RULES.length);
    expect(RULES.length).toBeGreaterThanOrEqual(50);
  });

  it('closed lists match the source they describe (no drift)', () => {
    const ops = readFileSync('src/model/ops/conversion.ts', 'utf8');
    expect([...ops.matchAll(/code: '(conv\.[a-z-]+)'/g)].map((m) => m[1]).sort()).toEqual([...CONV_OPS_CODES].sort());
    const inv = readFileSync('src/model/invariants.ts', 'utf8');
    expect([...new Set([...inv.matchAll(/\badd\('([a-z-]+)'/g)].map((m) => m[1]))].sort()).toEqual([...INVARIANT_CODES].sort());
    expect(DDL_DIALECTS).toHaveLength(4);
    const dir = 'src/conversion';
    const emitted = new Set<string>();
    for (const f of ['attributes', 'convert', 'entities', 'merge', 'multivalued', 'relationships', 'shared']) {
      for (const m of readFileSync(`${dir}/${f}.ts`, 'utf8').matchAll(/code: '(conv\.[a-z-]+)'/g)) emitted.add(m[1]!);
    }
    expect([...emitted].sort()).toEqual([...CONV_WARNING_CODES].sort());
  });

  it('every issue code has a complete English and Chinese title, explanation and suggestion', () => {
    const missing: string[] = [];
    for (const code of issueCodes()) {
      const base = baseOf(code);
      for (const part of ISSUE_PARTS) {
        for (const locale of LOCALES) {
          if (hasPart(base, part, locale)) continue;
          // Import warnings and DBML omissions share one piece of advice.
          if (part === 'suggestion' && (/^(sql|dbml)\.import\./.test(code) || code.startsWith('dbml.export.'))) continue;
          missing.push(`${base}.${part} (${locale})`);
        }
      }
    }
    expect(missing).toEqual([]);
    for (const key of ['issues.import.suggestion', 'issues.dbml-export.suggestion', 'issues.at']) {
      for (const locale of LOCALES) expect(hasMessage(key, locale), `${key} ${locale}`).toBe(true);
    }
  });

  it('every decision kind and every conversion rule has English and Chinese text', () => {
    const missing: string[] = [];
    for (const kind of DECISION_KINDS) {
      for (const part of ['title', 'explanation']) {
        for (const locale of LOCALES) if (!hasMessage(`decisions.${kind}.${part}`, locale)) missing.push(`decisions.${kind}.${part} (${locale})`);
      }
    }
    for (const id of CONVERSION_RULE_IDS) {
      for (const locale of LOCALES) {
        expect(localizeRule(id, locale), `rule ${id} ${locale}`).toBeDefined();
        expect(hasMessage(`decisions.rule.${id}.explanation`, locale)).toBe(true);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every load, op and invariant error code has text in both languages', () => {
    const missing: string[] = [];
    const wanted = [
      ...Object.keys(LOAD_ERROR_CODES).map((c) => `errors.load.${c}`),
      ...Object.keys(OP_ERROR_CODES).map((c) => `errors.op.${c}`),
      ...INVARIANT_CODES.map((c) => `errors.invariant.${c}`),
    ];
    for (const key of wanted) for (const locale of LOCALES) if (!hasMessage(key, locale)) missing.push(`${key} (${locale})`);
    expect(missing).toEqual([]);
  });

  it('has no orphan keys: every issues.* / decisions.* key belongs to a known code', () => {
    const bases = new Set(issueCodes().map(baseOf));
    const kinds = new Set<string>(DECISION_KINDS);
    const orphans: string[] = [];
    const generic = new Set(['issues.at', 'issues.import.suggestion', 'issues.dbml-export.suggestion']);
    for (const key of keysOf('en')) {
      if (key.startsWith('issues.')) {
        if (generic.has(key) || /^issues\.(word|dialect|kind)\./.test(key)) continue;
        const m = /^(.*?)\.(title|explanation|suggestion)(\..+)?$/.exec(key);
        if (!m || !bases.has(m[1]!)) orphans.push(key);
      } else if (key.startsWith('decisions.')) {
        if (/^decisions\.(word|rule)\./.test(key)) {
          const m = /^decisions\.rule\.([a-z-]+)\./.exec(key);
          if (m && !(CONVERSION_RULE_IDS as readonly string[]).includes(m[1]!)) orphans.push(key);
          continue;
        }
        const m = /^decisions\.(.*?)(?:\.(title|explanation)|\.frag\..+)$/.exec(key);
        if (!m || !kinds.has(m[1]!)) orphans.push(key);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('en and zh define exactly the same keys', () => {
    expect(catalogueGaps()).toEqual([]);
    expect(registeredNamespaces()).toEqual(expect.arrayContaining(['issues', 'decisions', 'errors', 'format']));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Corpus of real module output
// ---------------------------------------------------------------------------------------------------------------------

const hasLatinRun = (text: string): boolean =>
  /[A-Za-z]{4,} [a-z]{3,} [a-z]{3,}/.test(text.replace(/"[^"]*"|“[^”]*”|`[^`]*`/g, ''));

interface Seen {
  issues: Issue[];
  decisions: ConversionDecision[];
}

function expectIssue(i: Issue): void {
  const en = localizeIssue(i, 'en');
  expect(en.localized, `${i.code} (en) is not localised`).toBe(true);
  expect({ title: en.title, explanation: en.explanation, suggestion: en.suggestion }, i.code).toEqual({
    title: i.title,
    explanation: i.explanation,
    suggestion: i.suggestion,
  });
  const zh = localizeIssue(i, 'zh');
  expect(zh.localized, `${i.code} (zh) is not localised`).toBe(true);
  for (const part of ISSUE_PARTS) {
    expect(zh[part], `${i.code}.${part} zh has an unfilled placeholder`).not.toMatch(/\{[A-Za-z>]+\}/);
    expect(hasLatinRun(zh[part]), `${i.code}.${part} zh contains an English run: ${zh[part]}`).toBe(false);
    expect(zh[part].trim(), `${i.code}.${part}`).not.toBe('');
  }
}

function expectDecision(d: ConversionDecision): void {
  const en = localizeDecision(d, 'en');
  expect(en.localized, `${d.id} (en) is not localised`).toBe(true);
  expect({ title: en.title, explanation: en.explanation }, d.id).toEqual({ title: d.title, explanation: d.explanation });
  const zh = localizeDecision(d, 'zh');
  expect(zh.localized, `${d.id} (zh) is not localised`).toBe(true);
  for (const part of ['title', 'explanation'] as const) {
    expect(zh[part], `${d.id}.${part}`).not.toMatch(/\{[A-Za-z>]+\}/);
    expect(hasLatinRun(zh[part]), `${d.id}.${part} zh contains an English run: ${zh[part]}`).toBe(false);
  }
}

const erModels = (p: Project): ErModel[] => Object.values(p.models).filter((m): m is ErModel => m.kind === 'er');

describe('real output: validation and conversion of every example', () => {
  const seen: Seen = { issues: [], decisions: [] };
  for (const ex of EXAMPLES) {
    it(`example ${ex.id}`, () => {
      const project = buildExample(ex.id);
      seen.issues.push(...validateProject(project));
      for (const er of erModels(project)) {
        for (const oneToOne of ['auto', 'merge', 'relation'] as const) {
          const result = convertErToRelational(project, er.id, { oneToOne, materializeDerived: [] });
          seen.decisions.push(...result.record.decisions);
          seen.issues.push(...result.record.warnings);
        }
      }
    });
  }
  it('every message of those runs is localised and faithful', () => {
    expect(seen.decisions.length).toBeGreaterThan(20);
    for (const i of seen.issues) expectIssue(i);
    for (const d of seen.decisions) expectDecision(d);
  });
});

describe('real output: validation of broken models', () => {
  const issues: Issue[] = [];
  const add = (m: ErModel | RelationalModel): void => void issues.push(...check(m).issues);

  it('collects ER problems', () => {
    // names, keys
    let f = pharmacyEr();
    f.doctor.entity.name = '';
    f.makes.relationship.name = 'sell';
    f.company.addAttribute('');
    f.patient.attr('NAME');
    add(f.b.build());
    f = pharmacyEr();
    for (const a of Object.values(f.b.model.attributes)) if (a.owner.id === f.doctor.id) a.key = 'none';
    f.pharmacy.entity.name = 'doctor';
    add(f.b.build());
    // weak entities / identifying relationships
    f = pharmacyEr();
    f.drug.entity.weak = true;
    f.makes.relationship.identifying = false;
    add(f.b.build());
    f = pharmacyEr();
    for (const a of Object.values(f.b.model.attributes)) if (a.owner.id === f.drug.id) a.key = 'primary';
    add(f.b.build());
    f = pharmacyEr();
    f.company.entity.weak = true;
    f.makes.relationship.participants.forEach((p) => (p.participation = 'partial'));
    add(f.b.build());
    // cardinality label, key vs cardinality, recursive without roles
    f = pharmacyEr();
    f.makes.relationship.participants[0]!.cardinalityLabel = 'N';
    f.makes.relationship.participants[1]!.cardinalityLabel = '1';
    add(f.b.build());
    const b = erBuilder('Rec');
    const emp = b.entity('Employee').key('Eid').attr('Name');
    b.relate('Manages', emp, emp, '1:N');
    const course = b.entity('Course').key('Cid');
    const t = b.relationship('Teaches', [{ entity: emp }, { entity: course }, { entity: course }]);
    t.relationship.keyParticipantIds = ['ghost'];
    add(b.build());
    expect(issues.length).toBeGreaterThan(8);
  });

  it('collects relational problems', () => {
    const f = pharmacyRel();
    const m = f.b.model;
    f.doctor.relation.primaryKey = [];
    f.patient.relation.columns[0]!.name = '';
    f.drug.relation.primaryKey.push('ghost');
    f.company.relation.name = 'doctor';
    f.contact.relation.columns[1]!.nullable = true;
    f.prescription.relation.columns[1]!.dataType = 'DATE';
    f.fks.patientDoctor!.onDelete = 'SET NULL';
    f.fks.drugCompany!.columns = [];
    const dup = structuredClone(f.fks.sellPharmacy!);
    dup.id = 'fk_dup';
    m.foreignKeys[dup.id] = dup;
    // composite FK that references only part of the target key
    f.fks.sellDrug!.columns = f.fks.sellDrug!.columns.slice(0, 1);
    // column of another relation
    f.fks.contactCompany!.columns[0]!.targetColumnId = f.doctor.relation.columns[0]!.id;
    add(m);
    const c = relationalBuilder('Cycle');
    const a = c.relation('A', [{ name: 'id' }, { name: 'bid', nullable: false }], { pk: ['id'] });
    const bb = c.relation('B', [{ name: 'id' }, { name: 'aid', nullable: false }], { pk: ['id'] });
    c.fk(a, ['bid'], bb, ['id']);
    c.fk(bb, ['aid'], a, ['id']);
    const s = c.relation('S', [{ name: 'id' }, { name: 'parent', nullable: false }], { pk: ['id'] });
    c.fk(s, ['parent'], s, ['id']);
    add(c.build());
    expect(issues.length).toBeGreaterThan(8);
  });

  it('every issue is localised and faithful', () => {
    expect(issues.length).toBeGreaterThan(15);
    for (const i of issues) expectIssue(i);
  });
});

describe('real output: DDL, SQL import, DBML', () => {
  const issues: Issue[] = [];

  it('DDL issues of all dialects', () => {
    for (const dialect of ['postgresql', 'mysql', 'sqlite', 'generic'] as const) {
      issues.push(...generateDdl(kitchenSink(dialect), dialect).issues, ...generateDdl(pharmacy(dialect), dialect).issues);
      const m = kitchenSink(dialect);
      const [a, b] = Object.values(m.relations);
      a!.name = '';
      a!.columns[0]!.name = '';
      a!.columns.push({ id: 'dup', name: 'EMAIL', nullable: true });
      a!.checks = [{ id: 'cc', name: 'x', expression: ' ' }];
      a!.primaryKey.push('nope', a!.primaryKey[0]!);
      a!.primaryKeyName = 'pkname';
      b!.columns.forEach((c) => (c.autoIncrement = true));
      b!.indexes.push(
        { id: 'ix1', name: 'dupix', columnIds: [b!.columns[0]!.id], unique: false },
        { id: 'ix2', name: 'dupix', columnIds: [b!.columns[0]!.id], unique: true, method: 'hash' },
      );
      m.foreignKeys['bad1'] = { id: 'bad1', sourceRelationId: 'zz', targetRelationId: b!.id, columns: [] };
      m.foreignKeys['bad2'] = { id: 'bad2', sourceRelationId: b!.id, targetRelationId: b!.id, columns: [] };
      m.foreignKeys['bad3'] = { id: 'bad3', sourceRelationId: b!.id, targetRelationId: b!.id, columns: [{ sourceColumnId: 'q', targetColumnId: 'r' }] };
      issues.push(...generateDdl(m, dialect).issues);
      // long names, type issues, defaults, FK type mismatch
      const n = kitchenSink(dialect);
      const [u, o] = Object.values(n.relations);
      u!.name = 'x'.repeat(70);
      u!.columns[1]!.dataType = 'GEOMETRY';
      u!.columns[2]!.dataType = 'VARCHAR';
      u!.columns[3]!.defaultValue = 'random()';
      u!.columns[4]!.dataType = undefined;
      o!.columns[0]!.dataType = 'TEXT';
      u!.indexes[0]!.where = 'status = 1';
      u!.indexes[0]!.method = 'gin';
      u!.schemaName = 'app';
      issues.push(...generateDdl(n, dialect).issues);
    }
    expect(issues.length).toBeGreaterThan(30);
  });

  it('SQL import warnings', () => {
    const sql = `
CREATE TEMPORARY TABLE tmp1 (id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, name TEXT COLLATE nocase DEFERRABLE, other TEXT, UNIQUE (name DESC), CONSTRAINT c CHECK (id > 0) NOT ENFORCED);
CREATE TABLE IF NOT EXISTS t (id INTEGER);
CREATE TABLE u (id INTEGER PRIMARY KEY, tid INTEGER, FOREIGN KEY (tid) REFERENCES t (id) MATCH FULL ON DELETE CASCADE DEFERRABLE);
CREATE INDEX i1 ON t (name NULLS FIRST);
ALTER TABLE t OWNER TO bob;
ALTER TABLE t ENABLE ROW LEVEL SECURITY;
CREATE TABLE m (id INT PRIMARY KEY, v VARCHAR(10) CHARACTER SET utf8 COLLATE utf8_bin, KEY k (v(5)) COMMENT 'x') ENGINE=InnoDB;
CREATE INDEX i2 ON m (v) WITH (fillfactor=70);
CREATE TABLE w (a INT, b INT, FOREIGN KEY (b) REFERENCES m (v));
CREATE TABLE s (id SERIAL, ts TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, KEY k2 (id) USING BTREE);
CREATE VIEW vw AS SELECT 1;
/*!40101 SET x=1 */;
`;
    const r = parseDdl(sql, 'auto');
    expect(new Set(r.warnings.map((w) => w.code)).size).toBeGreaterThan(14);
    issues.push(...r.warnings);
  });

  it('DBML import warnings and export omissions', () => {
    const d = importDbml(`
Table a [headercolor: #fff] { id int [pk, color: red]
 name text [note: 'x', default: \`now()\`]
 indexes { (id) [unique, foo: 1]
  \`lower(name)\` } }
Table b { id int [pk]
 aid int }
Ref: b.aid > a.name [color: red]
Ref: b.id <> a.id
Enum e { x }
`);
    expect(d.warnings.length).toBeGreaterThan(6);
    issues.push(...d.warnings);
    const m = kitchenSink('generic');
    const rel = Object.values(m.relations)[0]!;
    rel.columns[0]!.defaultValue = '`x`';
    rel.columns[1]!.dataType = undefined;
    rel.checks = [{ id: 'cc', name: 'x', expression: '`a`' }];
    rel.indexes[0]!.where = 'a = 1';
    Object.values(m.foreignKeys)[0]!.label = 'lbl';
    m.foreignKeys['bad'] = { id: 'bad', sourceRelationId: 'zz', targetRelationId: rel.id, columns: [] };
    issues.push(...exportDbmlDetailed(m).issues);
  });

  it('every message is localised and faithful', () => {
    const codes = new Set(issues.map((i) => i.code.replace(/^ddl\.[a-z]+\./, 'ddl.*.')));
    expect(codes.size).toBeGreaterThan(45);
    for (const i of issues) expectIssue(i);
  });
});

describe('decisions the examples never produce (hand-edited or circular states)', () => {
  // Params exactly as the converter writes them (src/conversion/*): kinds only reachable from invalid ER models.
  const rare: Array<[string, Record<string, string | number>]> = [
    ['unmapped.entity', { name: 'Ghost' }],
    ['unmapped.attribute', { name: 'Orphan' }],
    ['unmapped.relationship', { name: 'Rel' }],
    ['unmapped.participant', { name: 'Rel' }],
    ['derived-omitted.multivalued', { name: 'Age', attribute: 'Phones' }],
    ['multivalued-relation.nokey', { name: 'Phones', relation: 'Person_Phones', host: 'Person' }],
    ['weak-entity-owner-key.nokey', { entity: 'Drug', owner: 'Company' }],
    ['weak-entity-owner-key.unavailable', { entity: 'Drug', owner: 'Company' }],
    ['associative-entity.invalid', { entity: 'Enrolment' }],
    ['participant-no-fk.unavailable', { entity: 'Drug', relationship: 'Sell' }],
    ['relationship-omitted.missing-entity', { relationship: 'Sell' }],
    ['relationship-omitted.strategy', { relationship: 'Has' }],
    ['relationship-omitted.weak-no-relation', { relationship: 'Makes' }],
    ['relationship-omitted.circular', { relationship: 'Sell' }],
    ['relationship-omitted.merged-unavailable', { relationship: 'Has' }],
  ];
  for (const [kind, params] of rare) {
    it(kind, () => {
      for (const locale of LOCALES) {
        const l = localizeDecision({ ruleId: 'strong-entity', title: 'x', explanation: 'y', params: { kind, ...params } }, locale);
        expect(l.localized, `${kind} ${locale}`).toBe(true);
        expect(l.title + l.explanation).not.toMatch(/\{[A-Za-z>]+\}/);
        expect(l.title + l.explanation).toContain(Object.values(params)[0] as string);
      }
    });
  }
  it('decisions without params (older files) keep their English text', () => {
    const d = { ruleId: 'strong-entity' as const, title: 'Old title', explanation: 'Old text' };
    expect(localizeDecision(d, 'zh')).toEqual({ title: 'Old title', explanation: 'Old text', localized: false });
  });
});

describe('localizeIssue contract', () => {
  const base: Issue = {
    id: 'x',
    code: 'er.entity-no-key',
    severity: 'warning',
    title: 'T',
    explanation: 'E',
    suggestion: 'S',
    affected: [],
    modelId: 'm',
    params: { entity: 'Student' },
  };
  it('interpolates params and never mixes languages', () => {
    const zh = localizeIssue(base, 'zh');
    expect(zh.title).toBe('实体“Student”没有键');
    expect(zh.localized).toBe(true);
    // an unknown code falls back to the module text as a whole
    expect(localizeIssue({ ...base, code: 'x.unknown' }, 'zh')).toEqual({ title: 'T', explanation: 'E', suggestion: 'S', localized: false });
  });
  it('plural variants follow params.count', () => {
    const one = localizeIssue({ ...base, code: 'er.relationship-too-few-participants', params: { relationship: 'R', count: 1 } }, 'en');
    expect(one.title).toBe('Relationship "R" has 1 participant');
    const other = localizeIssue({ ...base, code: 'er.relationship-too-few-participants', params: { relationship: 'R', count: 0 } }, 'en');
    expect(other.title).toBe('Relationship "R" has 0 participants');
  });
  it('ddl codes share one entry across dialects', () => {
    expect(issueBase('ddl.mysql.no-columns')).toEqual({ base: 'issues.ddl.no-columns', dialect: 'mysql' });
    expect(issueBase('ddl.sqlite.no-columns').base).toBe(issueBase('ddl.postgresql.no-columns').base);
    expect(resolveKey('issues.ddl.fk-target-not-key', 'explanation', {}, 'zh', 'mysql')).toBe('issues.ddl.fk-target-not-key.explanation.mysql');
    expect(resolveKey('issues.ddl.fk-target-not-key', 'explanation', {}, 'zh', 'postgresql')).toBe('issues.ddl.fk-target-not-key.explanation');
  });
  it('an empty name renders as (unnamed) like the module text', () => {
    expect(localizeIssue({ ...base, params: { entity: '' } }, 'en').title).toBe('Entity (unnamed) has no key');
    expect(localizeIssue({ ...base, params: { entity: '' } }, 'zh').title).toBe('实体（未命名）没有键');
  });
  it('is reachable through t() with the documented key shape', () => {
    expect(t('issues.er.entity-no-key.title', { entity: 'A' }, 'en')).toBe('Entity "A" has no key');
  });
});
