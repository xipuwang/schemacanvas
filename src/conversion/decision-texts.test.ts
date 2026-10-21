import { describe, expect, it } from 'vitest';
import { localizeDecision } from '@/i18n';
import { erBuilder } from '@/model/builders';
import { run } from './testkit';

const merge = (leftTotal: boolean, rightTotal: boolean) => {
  const b = erBuilder('M');
  const a = b.entity('Person').key('Pid');
  const p = b.entity('Passport').key('PassNo');
  b.relate('Holds', a, p, '1:1', { leftTotal, rightTotal });
  const d = run(b.build(), { oneToOne: 'merge' }).record.decisions.find((x) => x.ruleId === 'one-to-one-merge')!;
  return { d, en: localizeDecision(d, 'en').explanation, zh: localizeDecision(d, 'zh').explanation };
};

describe('1:1 merge decision wording', () => {
  it('uses distinct texts for exactly one total, both total and both partial', () => {
    const one = merge(true, false);
    const both = merge(true, true);
    const none = merge(false, false);
    expect(one.d.explanation).toContain('The side with partial participation keys the relation');
    expect(both.d.explanation).toContain('Both sides participate totally');
    expect(both.d.explanation).not.toContain('partial participation keys');
    expect(none.d.explanation).toContain('Both sides participate only partially');
    for (const x of [one, both, none]) expect(x.en).toBe(x.d.explanation);
    expect(new Set([one.zh, both.zh, none.zh]).size).toBe(3);
  });
});

describe('relationship-table decision without a primary key', () => {
  const keyless = () => {
    const b = erBuilder('K');
    const e = b.entity('E').key('Eid');
    const h = b.entity('H');
    b.relate('Visits', e, h, 'M:N');
    return run(b.build());
  };
  it('does not say "Its no primary key"', () => {
    const r = keyless();
    const d = r.record.decisions.find((x) => x.id.includes('no-key'))!;
    expect(d).toBeDefined();
    const rt = r.record.decisions.find((x) => x.params?.kind === 'relationship-table')!;
    expect(rt.explanation).not.toContain('Its no primary key');
    // names only the participant that has no key (E has one)
    expect(rt.explanation).toContain('No primary key could be formed because H has no key');
    expect(rt.explanation).not.toMatch(/because[^.]*\bE\b/);
    expect(localizeDecision(rt, 'en').explanation).toBe(rt.explanation);
    expect(localizeDecision(rt, 'zh').explanation).toContain('未能生成主键');
  });
  it('does not append key-attribute / UNIQUE tails when no key was formed', () => {
    const b = erBuilder('K');
    const rel = b.relate('Visits', b.entity('E').key('Eid'), b.entity('H'), 'M:N');
    rel.key('Date');
    const rt = run(b.build()).record.decisions.find((x) => x.params?.kind === 'relationship-table')!;
    expect(rt.explanation).toContain('because H has no key.');
    expect(rt.explanation).not.toContain('plus the key attribute');
    expect(localizeDecision(rt, 'en').explanation).toBe(rt.explanation);
  });
  it('keeps the normal sentence when a key exists', () => {
    const b = erBuilder('K');
    b.relate('Visits', b.entity('E').key('Eid'), b.entity('H').key('Hid'), 'M:N');
    const rt = run(b.build()).record.decisions.find((x) => x.params?.kind === 'relationship-table')!;
    expect(rt.explanation).toContain('Its primary key (');
    expect(localizeDecision(rt, 'en').explanation).toBe(rt.explanation);
  });
});
