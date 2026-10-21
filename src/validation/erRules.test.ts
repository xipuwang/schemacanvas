import { describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import type { ErModel } from '@/model/types';
import { check, codesOf, pharmacyEr } from './fixtures';

const codes = (m: ErModel): string[] => codesOf(check(m).issues);
const only = (m: ErModel, code: string): void => expect(codes(m)).toEqual([code]);

describe('pharmacy ER baseline', () => {
  it('is valid: no errors, warnings or recommendations', () => {
    expect(check(pharmacyEr().b.build()).issues).toEqual([]);
  });
});

describe('names', () => {
  it('flags empty entity / relationship / attribute names', () => {
    const f = pharmacyEr();
    f.doctor.entity.name = '  ';
    f.makes.relationship.name = '';
    f.company.addAttribute('');
    expect(codes(f.b.build())).toEqual(['er.attribute-name-empty', 'er.entity-name-empty', 'er.relationship-name-empty']);
  });

  it('flags duplicate entity names case-insensitively and lists both entities', () => {
    const f = pharmacyEr();
    f.doctor.entity.name = 'patient';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.entity-name-duplicate']);
    expect(issues[0]!.affected.map((r) => r.id).sort()).toEqual([f.doctor.id, f.patient.id].sort());
    expect(issues[0]!.severity).toBe('error');
  });

  it('flags duplicate relationship names as a warning only', () => {
    const f = pharmacyEr();
    f.makes.relationship.name = 'sell';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.relationship-name-duplicate']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('flags duplicate attribute names within one owner but not across owners', () => {
    const f = pharmacyEr();
    f.doctor.attr('NAME'); // Doctor already has Name
    only(f.b.build(), 'er.attribute-name-duplicate');
    // Doctor.SSN and Patient.SSN (different owners) are fine: baseline stays clean.
    expect(check(pharmacyEr().b.build()).issues).toEqual([]);
  });

  it('does not treat two empty names as duplicates (reported as empty instead)', () => {
    const f = pharmacyEr();
    f.doctor.entity.name = '';
    f.patient.entity.name = '';
    expect(codes(f.b.build())).toEqual(['er.entity-name-empty']);
  });
});

describe('keys', () => {
  it('warns about a strong entity without key, but not weak or associative ones', () => {
    const f = pharmacyEr();
    for (const a of Object.values(f.b.model.attributes)) if (a.owner.id === f.doctor.id) a.key = 'none';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.entity-no-key']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('er.key-on-subattribute (warning)', () => {
    const f = pharmacyEr();
    f.patient.composite('Addr', ['Street', 'City']);
    const street = Object.values(f.b.model.attributes).find((a) => a.name === 'Street')!;
    street.key = 'primary';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.key-on-subattribute']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('a composite attribute as a key is valid (its leaves are the key)', () => {
    const b = erBuilder('x');
    b.entity('E').composite('Id', ['A', 'B'], { key: 'primary' });
    expect(check(b.build()).issues).toEqual([]);
  });

  it('er.weak-primary-key (warning) and no extra partial-key complaint', () => {
    const f = pharmacyEr();
    const trade = Object.values(f.b.model.attributes).find((a) => a.name === 'TradeName')!;
    trade.key = 'primary';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.weak-primary-key']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('er.partial-key-on-strong (warning)', () => {
    const f = pharmacyEr();
    f.doctor.partialKey('Badge');
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.partial-key-on-strong']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('er.key-multivalued and er.key-derived are errors', () => {
    const f = pharmacyEr();
    const ssn = Object.values(f.b.model.attributes).find((a) => a.name === 'SSN' && a.owner.id === f.doctor.id)!;
    ssn.multivalued = true;
    const r1 = check(f.b.build()).issues;
    expect(codesOf(r1)).toEqual(['er.key-multivalued']);
    expect(r1[0]!.severity).toBe('error');
    ssn.multivalued = false;
    ssn.derived = true;
    const r2 = check(f.b.build()).issues;
    expect(codesOf(r2)).toEqual(['er.key-derived', 'er.derived-no-source'].sort());
    expect(r2.find((i) => i.code === 'er.key-derived')!.severity).toBe('error');
  });

  it('multivalued / derived attributes that are not keys are fine', () => {
    const b = erBuilder('x');
    b.entity('Student').key('SID').multivalued('Languages').derived('Age', { derivedFrom: [] });
    // derived without source is only an info
    expect(codesOf(check(b.build()).issues)).toEqual(['er.derived-no-source']);
  });
});

describe('weak entities and identifying relationships', () => {
  it('er.weak-no-owner when the identifying relationship is made ordinary', () => {
    const f = pharmacyEr();
    f.makes.relationship.identifying = false;
    only(f.b.build(), 'er.weak-no-owner');
  });

  it('er.weak-no-partial-key', () => {
    const f = pharmacyEr();
    const trade = Object.values(f.b.model.attributes).find((a) => a.name === 'TradeName')!;
    trade.key = 'none';
    only(f.b.build(), 'er.weak-no-partial-key');
  });

  it('a weak entity identified by TWO owners (multi-owner) is valid', () => {
    const b = erBuilder('x');
    const a = b.entity('A').key('a');
    const c = b.entity('C').key('c');
    const w = b.entity('W', { weak: true }).partialKey('n');
    b.relationship(
      'Id',
      [
        { entity: a, max: 'one' },
        { entity: c, max: 'one' },
        { entity: w, max: 'many', participation: 'total' },
      ],
      { identifying: true },
    );
    expect(check(b.build()).issues).toEqual([]);
  });

  it('a weak entity owned by another weak entity (chain) is valid', () => {
    const b = erBuilder('x');
    const a = b.entity('A').key('a');
    const w1 = b.entity('W1', { weak: true }).partialKey('n1');
    const w2 = b.entity('W2', { weak: true }).partialKey('n2');
    b.relate('R1', a, w1, '1:N', { identifying: true, rightTotal: true });
    const r2 = b.relate('R2', w1, w2, '1:N', { identifying: true, rightTotal: true });
    // Two weak participants: the identified side must be flagged explicitly, otherwise it is ambiguous.
    only(b.build(), 'er.identifying-ambiguous');
    r2.relationship.participants[1]!.identified = true;
    expect(check(b.build()).issues).toEqual([]);
  });

  it('identifying relationship that identifies nothing (+ strong drug without a key)', () => {
    const f = pharmacyEr();
    f.drug.entity.weak = false;
    expect(codes(f.b.build())).toEqual(['er.entity-no-key', 'er.identifying-identifies-nothing', 'er.partial-key-on-strong']);
  });

  it('er.identifying-ambiguous when two weak participants and none flagged; flagging resolves it', () => {
    const b = erBuilder('x');
    const w1 = b.entity('W1', { weak: true }).partialKey('a');
    const w2 = b.entity('W2', { weak: true }).partialKey('b');
    const r = b.relate('R', w1, w2, '1:N', { identifying: true });
    only(b.build(), 'er.identifying-ambiguous');
    // now flag the dependent side; W1 still has no owner of its own
    r.relationship.participants[1]!.identified = true;
    r.relationship.participants[1]!.participation = 'total';
    expect(codes(b.build())).toEqual(['er.weak-no-owner']);
  });

  it('er.identified-not-weak', () => {
    const f = pharmacyEr();
    f.makes.relationship.participants[1]!.identified = true;
    f.drug.entity.weak = false;
    // The strong Drug keeps its (now meaningless) partial key and has no primary key of its own.
    expect(codes(f.b.build())).toEqual(['er.entity-no-key', 'er.identified-not-weak', 'er.partial-key-on-strong']);
  });

  it('er.identifying-partial: weak side not total (error)', () => {
    const f = pharmacyEr();
    f.makes.relationship.participants[1]!.participation = 'partial';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.identifying-partial']);
    expect(issues[0]!.severity).toBe('error');
  });

  it('er.identifying-owner-many: owner side drawn as many', () => {
    const f = pharmacyEr();
    f.makes.relationship.participants[0]!.max = 'many';
    only(f.b.build(), 'er.identifying-owner-many');
  });

  it('er.weak-ownership-cycle between two weak entities', () => {
    const b = erBuilder('x');
    const a = b.entity('A', { weak: true }).partialKey('a');
    const c = b.entity('B', { weak: true }).partialKey('b');
    const r1 = b.relate('R1', c, a, '1:N', { identifying: true, rightTotal: true });
    const r2 = b.relate('R2', a, c, '1:N', { identifying: true, rightTotal: true });
    r1.relationship.participants[1]!.identified = true;
    r2.relationship.participants[1]!.identified = true;
    const { issues } = check(b.build());
    expect(codesOf(issues)).toEqual(['er.weak-ownership-cycle']);
    expect(issues[0]!.affected).toHaveLength(2);
  });

  it('er.weak-ownership-cycle for a recursive identifying relationship (self-ownership)', () => {
    const b = erBuilder('x');
    const a = b.entity('A', { weak: true }).partialKey('a');
    const r = b.relate('Self', a, a, '1:N', { identifying: true, rightTotal: true });
    r.relationship.participants[1]!.identified = true;
    r.relationship.participants[0]!.role = 'parent';
    r.relationship.participants[1]!.role = 'child';
    only(b.build(), 'er.weak-ownership-cycle');
  });
});

describe('relationships', () => {
  it('er.relationship-too-few-participants', () => {
    const f = pharmacyEr();
    const contact = Object.values(f.b.model.relationships).find((r) => r.name === 'Contact')!;
    contact.participants.pop();
    only(f.b.build(), 'er.relationship-too-few-participants');
  });

  it('er.participant-missing-entity', () => {
    const b = erBuilder('x');
    const a = b.entity('A').key('a');
    const c = b.entity('C').key('c');
    b.relate('R', a, c, 'M:N');
    delete b.model.entities[c.id];
    for (const [id, at] of Object.entries(b.model.attributes)) if (at.owner.id === c.id) delete b.model.attributes[id];
    only(b.build(), 'er.participant-missing-entity');
  });

  it('er.relationship-key-vs-cardinality: chosen key is not a superkey', () => {
    const f = pharmacyEr();
    f.prescription.relationship.keyParticipantIds = [f.prescription.relationship.participants[0]!.id];
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.relationship-key-vs-cardinality']);
    expect(issues[0]!.severity).toBe('error');
  });

  it('a valid chosen key (superset of a candidate key) is accepted', () => {
    const f = pharmacyEr();
    f.prescription.relationship.keyParticipantIds = f.prescription.relationship.participants.map((p) => p.id);
    expect(check(f.b.build()).issues).toEqual([]);
  });

  it('er.relationship-key-vs-cardinality: unknown participant ids in the key', () => {
    const f = pharmacyEr();
    f.prescription.relationship.keyParticipantIds = [...f.prescription.relationship.participants.map((p) => p.id), 'par_gone'];
    only(f.b.build(), 'er.relationship-key-vs-cardinality');
  });

  it('er.cardinality-label-conflict only when the label contradicts max', () => {
    const f = pharmacyEr();
    const primary = Object.values(f.b.model.relationships).find((r) => r.name === 'Primary_physician')!;
    primary.participants[0]!.cardinalityLabel = 'N'; // doctor is 'one'
    only(f.b.build(), 'er.cardinality-label-conflict');
    primary.participants[0]!.cardinalityLabel = '1';
    primary.participants[1]!.cardinalityLabel = 'M'; // many + letter: consistent
    expect(codes(f.b.build())).toEqual([]);
  });

  it('er.recursive-no-roles is info, and disappears with roles', () => {
    const b = erBuilder('x');
    const e = b.entity('Employee').key('Eid');
    const r = b.relate('Manages', e, e, '1:N');
    const { issues } = check(b.build());
    expect(codesOf(issues)).toEqual(['er.recursive-no-roles']);
    expect(issues[0]!.severity).toBe('info');
    r.relationship.participants[0]!.role = 'manager';
    r.relationship.participants[1]!.role = 'subordinate';
    expect(check(b.build()).issues).toEqual([]);
  });
});

describe('associative entities', () => {
  const base = () => {
    const b = erBuilder('x');
    const a = b.entity('A').key('a');
    const c = b.entity('C').key('c');
    const r = b.relate('R', a, c, 'M:N');
    return { b, a, c, r };
  };

  it('a well-formed associative entity is valid', () => {
    const { b, r } = base();
    b.associativeEntity('Enrollment', r).key('id');
    expect(check(b.build()).issues).toEqual([]);
  });

  it('er.associative-dangling', () => {
    const { b, r } = base();
    const e = b.associativeEntity('Enrollment', r);
    e.entity.associativeOf = 'rel_gone';
    only(b.build(), 'er.associative-dangling');
  });

  it('er.associative-duplicate', () => {
    const { b, r } = base();
    b.associativeEntity('E1', r);
    b.associativeEntity('E2', r);
    const { issues } = check(b.build());
    expect(codesOf(issues)).toEqual(['er.associative-duplicate']);
    expect(issues[0]!.affected).toHaveLength(3);
  });

  it('er.associative-weak', () => {
    const { b, r } = base();
    b.associativeEntity('E1', r).entity.weak = true;
    only(b.build(), 'er.associative-weak');
  });

  it('er.associative-identifying', () => {
    const { b, r } = base();
    b.associativeEntity('E1', r);
    r.relationship.identifying = true;
    only(b.build(), 'er.associative-identifying');
  });
});

describe('attribute recommendations', () => {
  it('er.composite-single-child only for exactly one child', () => {
    const b = erBuilder('x');
    b.entity('E').key('id').composite('One', ['Only']).composite('Two', ['A', 'B']);
    const { issues } = check(b.build());
    expect(codesOf(issues)).toEqual(['er.composite-single-child']);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('info');
  });

  it('er.derived-no-source only without derivedFrom', () => {
    const b = erBuilder('x');
    const e = b.entity('S').key('id').attr('DOB');
    const dob = Object.values(b.model.attributes).find((a) => a.name === 'DOB')!;
    e.derived('Age', { derivedFrom: [dob.id] });
    expect(check(b.build()).issues).toEqual([]);
    e.derived('Age2');
    const { issues } = check(b.build());
    expect(codesOf(issues)).toEqual(['er.derived-no-source']);
    expect(issues[0]!.severity).toBe('info');
  });
});

describe('conversion-ambiguity recommendations', () => {
  const oneToOne = (opts: { leftTotal?: boolean; rightTotal?: boolean }) => {
    const b = erBuilder('x');
    const a = b.entity('A').key('a');
    const c = b.entity('C').key('c');
    b.relate('R', a, c, '1:1', opts);
    return b.build();
  };

  it('er.one-to-one-ambiguous-placement is info and only without a total side', () => {
    const { issues } = check(oneToOne({}));
    expect(codesOf(issues)).toEqual(['er.one-to-one-ambiguous-placement']);
    expect(issues[0]!.severity).toBe('info');
    expect(check(oneToOne({ rightTotal: true })).issues).toEqual([]);
    expect(check(oneToOne({ leftTotal: true, rightTotal: true })).issues).toEqual([]);
  });

  it('er.nary-multiple-keys is info and suppressed once the user chose a valid key', () => {
    const f = pharmacyEr();
    const [p0, p1, p2] = f.prescription.relationship.participants;
    p0!.max = 'one';
    p1!.max = 'one';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.nary-multiple-keys']);
    expect(issues[0]!.severity).toBe('info');
    f.prescription.relationship.keyParticipantIds = [p1!.id, p2!.id];
    expect(check(f.b.build()).issues).toEqual([]);
  });

  it('a ternary with exactly one "one" participant is not flagged', () => {
    const f = pharmacyEr();
    f.prescription.relationship.participants[0]!.max = 'one';
    expect(check(f.b.build()).issues).toEqual([]);
  });

  it('er.total-on-one-side is info, and total on the many side is fine', () => {
    const f = pharmacyEr();
    const primary = Object.values(f.b.model.relationships).find((r) => r.name === 'Primary_physician')!;
    expect(primary.participants[1]!.participation).toBe('total'); // many side: baseline is clean
    primary.participants[0]!.participation = 'total'; // doctor ("one") total
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['er.total-on-one-side']);
    expect(issues[0]!.severity).toBe('info');
  });
});
