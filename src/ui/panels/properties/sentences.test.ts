import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { t } from '@/i18n';
import { erBuilder } from '@/model/builders';
import { settingsStore } from '@/store';
import { effectLines, pluralizeLabel } from './forms';

const sentences = (model: ReturnType<ReturnType<typeof erBuilder>['build']>, relId: string, locale: 'en' | 'zh'): string[] =>
  effectLines(model, model.relationships[relId]!).map((l) => t(`properties.rel.effect.${l.key}`, l.params, locale));

beforeEach(() => settingsStore.getState().setLocale('en'));

describe('pluralizeLabel', () => {
  it.each([
    ['Drug', 'Drugs'],
    ['Company', 'Companies'],
    ['Day', 'Days'],
    ['Address', 'Addresses'],
    ['Box', 'Boxes'],
    ['Patient', 'Patients'],
    ['Patients', 'Patients'],
    ['SSN', 'SSNs'],
    ['Employee (manager)', 'Employees (manager)'],
    ['Table2', 'Table2'],
  ])('%s -> %s', (a, b) => expect(pluralizeLabel(a)).toBe(b));
});

describe('"What this means" sentences (UX-9)', () => {
  it('binary: singular / plural, total / partial', () => {
    const b = erBuilder('t');
    const drug = b.entity('Drug').key('Id');
    const company = b.entity('Company').key('Name');
    const r = b.relate('Makes', company, drug, '1:N');
    const m = b.build();
    const en = sentences(m, r.relationship.id, 'en');
    expect(en).toEqual(['Each Drug is related through Makes to at most one Company.', 'Each Company is related through Makes to any number of Drugs.']);
    settingsStore.getState().setLocale('zh');
    const zh = sentences(m, r.relationship.id, 'zh');
    expect(zh[0]).toBe('每个 Drug 通过 Makes 至多关联一个 Company。');
    expect(zh[1]).toBe('每个 Company 通过 Makes 可关联任意多个 Drug。');
  });
  it('never uses the relationship name as a verb', () => {
    const b = erBuilder('t');
    const d = b.entity('Doctor').key('Id');
    const p = b.entity('Patient').key('Id');
    const r = b.relate('PrimaryPhysician', d, p, '1:N');
    const text = sentences(b.build(), r.relationship.id, 'en').join(' ');
    expect(text).not.toMatch(/PrimaryPhysician any number/);
    expect(text).toContain('any number of Patients');
  });
  it('total participation reads as a sentence', () => {
    const b = erBuilder('t');
    const a = b.entity('A').key('a');
    const c = b.entity('B').key('b');
    const r = b.relate('R', a, c, 'M:N');
    const m = b.build();
    m.relationships[r.relationship.id]!.participants[0]!.participation = 'total';
    expect(sentences(m, r.relationship.id, 'en')).toContain('Every A must take part in the relationship R.');
  });
  it('recursive roles keep the role in singular and plural forms', () => {
    const b = erBuilder('t');
    const e = b.entity('Employee').key('Eid');
    const r = b.relationship('Manages', [
      { entity: e, role: 'manager', max: 'one' },
      { entity: e, role: 'report' },
    ]);
    const en = sentences(b.build(), r.relationship.id, 'en');
    expect(en).toEqual(['Each Employee (report) is related through Manages to at most one Employee (manager).', 'Each Employee (manager) is related through Manages to any number of Employees (report).']);
  });
  it('n-ary joins the other participants with "and"', () => {
    const b = erBuilder('t');
    const a = b.entity('A').key('a');
    const c = b.entity('B').key('b');
    const d = b.entity('C').key('c');
    const r = b.relationship('R', [{ entity: a }, { entity: c }, { entity: d, max: 'one' }]);
    const en = sentences(b.build(), r.relationship.id, 'en');
    expect(en).toEqual(['For each combination of B and C, any number of As can be related through R.', 'For each combination of A and C, any number of Bs can be related through R.', 'For each combination of A and B, at most one C is related through R.']);
    settingsStore.getState().setLocale('zh'); // the joined list follows the UI locale at build time
    expect(sentences(b.build(), r.relationship.id, 'zh')[2]).toBe('对于 A和B 的每个组合，通过 R 至多关联一个 C。');
  });
});
