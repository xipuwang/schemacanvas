import { describe, expect, it } from 'vitest';
import { erBuilder } from './builders';
import {
  analyzeRelationship,
  associativeEntityOf,
  cardinalityText,
  identificationOrder,
  identifiedParticipants,
  isRelationshipSuperkey,
  minMaxOf,
  relationshipCandidateKeys,
  weakEntityOwners,
} from './erSemantics';

describe('identification', () => {
  it('weak entity owners via identifying relationship; flagged participant resolves weak-of-weak', () => {
    const b = erBuilder('Hotel');
    const building = b.entity('Building').key('Name');
    const room = b.entity('Room', { weak: true }).partialKey('No');
    const seat = b.entity('Seat', { weak: true }).partialKey('Pos');
    b.relate('Has', building, room, '1:N', { identifying: true, rightTotal: true });
    const hasSeat = b.relate('HasSeat', room, seat, '1:N', { identifying: true, rightTotal: true });
    const m = b.build();

    // Both Room and Seat are weak, so HasSeat is ambiguous until a participant is flagged.
    expect(identifiedParticipants(m, hasSeat.relationship)).toHaveLength(0);
    hasSeat.relationship.participants[1]!.identified = true;
    expect(identifiedParticipants(m, hasSeat.relationship).map((p) => p.entityId)).toEqual([seat.id]);

    expect(weakEntityOwners(m, room.id).map((l) => l.owner.name)).toEqual(['Building']);
    expect(weakEntityOwners(m, seat.id).map((l) => l.owner.name)).toEqual(['Room']);
    const { order, cycles } = identificationOrder(m);
    expect(cycles).toEqual([]);
    expect(order.indexOf(building.id)).toBeLessThan(order.indexOf(room.id));
    expect(order.indexOf(room.id)).toBeLessThan(order.indexOf(seat.id));
  });

  it('detects ownership cycles including self-ownership', () => {
    const b = erBuilder('X');
    const a = b.entity('A', { weak: true }).partialKey('k');
    const c = b.entity('C', { weak: true }).partialKey('k');
    const r1 = b.relate('R1', a, c, '1:N', { identifying: true });
    r1.relationship.participants[1]!.identified = true; // C identified by A
    const r2 = b.relate('R2', c, a, '1:N', { identifying: true });
    r2.relationship.participants[1]!.identified = true; // A identified by C
    const { cycles } = identificationOrder(b.build());
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set([a.id, c.id]));

    const b2 = b.build();
    const e = b.entity('E', { weak: true });
    const self = b.relate('Self', e, e, '1:N', { identifying: true });
    self.relationship.participants[1]!.identified = true;
    expect(identificationOrder(b2).cycles.some((cy) => cy.includes(e.id))).toBe(true);
    expect(weakEntityOwners(b2, e.id)).toHaveLength(0);
  });

  it('multi-owner weak entity', () => {
    const b = erBuilder('M');
    const o1 = b.entity('O1').key('a');
    const o2 = b.entity('O2').key('b');
    const w = b.entity('W', { weak: true }).partialKey('c');
    b.relate('I1', o1, w, '1:N', { identifying: true });
    b.relate('I2', o2, w, '1:N', { identifying: true });
    expect(weakEntityOwners(b.build(), w.id).map((l) => l.owner.name)).toEqual(['O1', 'O2']);
  });
});

describe('candidate keys / analysis', () => {
  const ternary = (maxes: Array<'one' | 'many'>) => {
    const b = erBuilder('T');
    const es = maxes.map((_, i) => b.entity(`E${i}`).key(`k${i}`));
    const rel = b.relationship(
      'R',
      es.map((e, i) => ({ entity: e, max: maxes[i] })),
    );
    return { m: b.build(), rel: rel.relationship };
  };

  it('binary shapes', () => {
    const b = erBuilder('B');
    const a = b.entity('A').key('a');
    const c = b.entity('C').key('c');
    const r11 = b.relate('r11', a, c, '1:1');
    const r1n = b.relate('r1n', a, c, '1:N');
    const rmn = b.relate('rmn', a, c, 'M:N');
    const m = b.build();
    expect(analyzeRelationship(m, r11.id)!.shape).toBe('binary-1:1');
    expect(analyzeRelationship(m, r1n.id)!.shape).toBe('binary-1:N');
    expect(analyzeRelationship(m, rmn.id)!.shape).toBe('binary-M:N');
    // 1:N A(one)-C(many): key is the many side only
    const p = r1n.relationship.participants;
    expect(relationshipCandidateKeys(r1n.relationship)).toEqual([[p[1]!.id]]);
    expect(relationshipCandidateKeys(rmn.relationship)).toEqual([rmn.relationship.participants.map((x) => x.id)]);
    expect(relationshipCandidateKeys(r11.relationship)).toHaveLength(2);
  });

  it('ternary with a single `one` participant: key is the other two, NOT all three', () => {
    const { m, rel } = ternary(['many', 'many', 'one']);
    const ids = rel.participants.map((p) => p.id);
    expect(relationshipCandidateKeys(rel)).toEqual([[ids[0], ids[1]]]);
    expect(isRelationshipSuperkey(rel, [ids[0]!])).toBe(false);
    expect(isRelationshipSuperkey(rel, ids)).toBe(true);
    const a = analyzeRelationship(m, rel.id)!;
    expect(a.shape).toBe('n-ary');
    expect(a.chosenKey).toEqual([ids[0], ids[1]]);
    expect(a.keySource).toBe('derived');
  });

  it('all-many ternary: all participants form the key; user key validated', () => {
    const { m, rel } = ternary(['many', 'many', 'many']);
    const ids = rel.participants.map((p) => p.id);
    expect(relationshipCandidateKeys(rel)).toEqual([ids]);
    rel.keyParticipantIds = [ids[0]!];
    const a = analyzeRelationship(m, rel.id)!;
    expect(a.keySource).toBe('user');
    expect(a.chosenKeyValid).toBe(false);
  });

  it('returns undefined for degenerate relationships', () => {
    const b = erBuilder('D');
    const a = b.entity('A');
    const r = b.relationship('R', [{ entity: a }]);
    expect(analyzeRelationship(b.build(), r.id)).toBeUndefined();
  });
});

describe('cardinality text', () => {
  it('min,max are NEAR-side: Dept(1)—Works_for—Employee(N,total) ⇒ Employee (1,1), Dept (0,N)', () => {
    const b = erBuilder('HR');
    const dept = b.entity('Dept').key('Dno');
    const emp = b.entity('Employee').key('Eid');
    const r = b.relate('Works_for', dept, emp, '1:N', { rightTotal: true });
    const [pd, pe] = r.relationship.participants;
    expect(minMaxOf(r.relationship, pe!.id)).toEqual({ min: 1, max: '1' });
    expect(minMaxOf(r.relationship, pd!.id)).toEqual({ min: 0, max: 'N' });
    expect(cardinalityText(r.relationship, pe!.id, 'minmax')).toBe('(1,1)');
    expect(cardinalityText(r.relationship, pd!.id, 'minmax')).toBe('(0,N)');
    expect(cardinalityText(r.relationship, pd!.id)).toBe('1');
    expect(cardinalityText(r.relationship, pe!.id)).toBe('N');
  });

  it('M:N uses M and N; inconsistent labels are ignored; n-ary minmax falls back to letters', () => {
    const b = erBuilder('X');
    const a = b.entity('A');
    const c = b.entity('C');
    const mn = b.relate('mn', a, c, 'M:N');
    const [p1, p2] = mn.relationship.participants;
    expect(cardinalityText(mn.relationship, p1!.id)).toBe('M');
    expect(cardinalityText(mn.relationship, p2!.id)).toBe('N');
    // someone changed max to `one` but the label still says M -> derived '1'
    p1!.max = 'one';
    expect(cardinalityText(mn.relationship, p1!.id)).toBe('1');

    const t = b.relationship('T', [{ entity: a }, { entity: c }, { entity: a }]);
    const tp = t.relationship.participants;
    expect(minMaxOf(t.relationship, tp[0]!.id)).toBeUndefined();
    expect(cardinalityText(t.relationship, tp[0]!.id, 'minmax')).toBe('M');
  });
});

describe('associative entity', () => {
  it('is found through associativeOf', () => {
    const b = erBuilder('A');
    const s = b.entity('Student').key('sid');
    const c = b.entity('Course').key('cid');
    const enrol = b.relate('Enrol', s, c, 'M:N');
    const e = b.associativeEntity('Enrollment', enrol);
    expect(associativeEntityOf(b.build(), enrol.id)?.id).toBe(e.id);
  });
});
