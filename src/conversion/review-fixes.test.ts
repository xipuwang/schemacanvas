import { describe, expect, it } from 'vitest';
import { erBuilder } from '@/model/builders';
import { col, colNames, pkNames, rel, run } from './testkit';

const warn = (r: ReturnType<typeof run>, code: string) => r.record.warnings.find((w) => w.code === code);

describe('CONV-1 merged optional partner', () => {
  it('FK columns and relationship attributes placed on the partner are nullable', () => {
    const b = erBuilder('M');
    const person = b.entity('Person').key('Pid').attr('Name');
    const pass = b.entity('Passport').key('PassNo');
    const country = b.entity('Country').key('Code');
    b.relate('Holds', person, pass, '1:1', { rightTotal: true });
    b.relate('IssuedBy', pass, country, 'N:1', { leftTotal: true }).attr('Fee');
    const m = run(b.build(), { oneToOne: 'merge' }).relationalModel;
    const r = rel(m, 'Person_Passport');
    expect(pkNames(r)).toEqual(['Pid']);
    expect(col(r, 'CountryCode').nullable).toBe(true);
    expect(col(r, 'Fee').nullable).toBe(true);
  });
  it('both sides total: partner FK stays NOT NULL', () => {
    const b = erBuilder('M');
    const person = b.entity('Person').key('Pid');
    const pass = b.entity('Passport').key('PassNo');
    const country = b.entity('Country').key('Code');
    b.relate('Holds', person, pass, '1:1', { leftTotal: true, rightTotal: true });
    b.relate('IssuedBy', pass, country, 'N:1', { leftTotal: true });
    const r = rel(run(b.build(), { oneToOne: 'merge' }).relationalModel, 'Person_Passport');
    expect(col(r, 'CountryCode').nullable).toBe(false);
  });
});

describe('CONV-2 composite multivalued optional leaf', () => {
  it('optional leaf is nullable and not in the key; info warning explains', () => {
    const b = erBuilder('MV');
    b.entity('Student').key('sid').composite('Phones', ['Number', { name: 'Ext', optional: true }], { multivalued: true } as never);
    const r = run(b.build());
    const t = rel(r.relationalModel, 'Student_Phones');
    expect(pkNames(t)).toEqual(['StudentSid', 'Number']);
    expect(col(t, 'Ext').nullable).toBe(true);
    expect(warn(r, 'conv.multivalued-optional-leaf')?.severity).toBe('info');
  });
  it('all leaves optional: all stay in the key, with a warning', () => {
    const b = erBuilder('MV');
    b.entity('Student').key('sid').composite('Phones', [{ name: 'A', optional: true }, { name: 'B', optional: true }], { multivalued: true } as never);
    const r = run(b.build());
    expect(pkNames(rel(r.relationalModel, 'Student_Phones'))).toEqual(['StudentSid', 'A', 'B']);
    expect(warn(r, 'conv.multivalued-optional-leaf')).toBeDefined();
  });
});

describe('CONV-3 1:1 merge choice independent of names', () => {
  it('merges the lossless (total) relationship even when a lossy one sorts first', () => {
    const b = erBuilder('X');
    const e = b.entity('Emp').key('eid');
    const d = b.entity('Dept').key('did');
    b.relate('Manages', e, d, '1:1', { rightTotal: true });
    b.relate('Deputy', e, d, '1:1');
    const r = run(b.build(), { oneToOne: 'merge' });
    expect(warn(r, 'conv.one-to-one-merge-lossy')).toBeUndefined();
    expect(warn(r, 'conv.one-to-one-merge-ineligible')).toBeDefined();
    expect(colNames(rel(r.relationalModel, 'Emp_Dept'))).toContain('did');
  });
});

describe('CONV-4 keyless participant', () => {
  it('no PK is generated instead of a shrunken one', () => {
    const b = erBuilder('K');
    const a = b.entity('A').attr('x');
    const c = b.entity('C').key('cid');
    b.relate('R1', a, c, 'M:N');
    const r = run(b.build());
    expect(rel(r.relationalModel, 'R1').primaryKey).toEqual([]);
  });
});

describe('CONV-5 explanation texts', () => {
  it('recursive 1:N names roles', () => {
    const b = erBuilder('R');
    const emp = b.entity('Employee').key('Eid');
    b.relate('Manages', emp, emp, '1:N', { leftRole: 'Manager', rightRole: 'Subordinate', leftTotal: true });
    const r = run(b.build());
    const text = r.record.decisions.map((d) => d.explanation).join('\n') + r.record.warnings.map((w) => w.explanation).join('\n');
    expect(text).toContain('each Subordinate relates to at most one Manager');
    expect(text).toContain('Every Manager must take part');
  });
  it('n-ary clause only when the key is a strict subset', () => {
    const b = erBuilder('T');
    const x = b.entity('X').key('xid');
    const y = b.entity('Y').key('yid');
    const z = b.entity('Z').key('zid');
    b.relationship('All', [{ entity: x }, { entity: y }, { entity: z }]);
    const txt = (r: ReturnType<typeof run>) => r.record.decisions.map((d) => d.explanation).join('\n');
    expect(txt(run(b.build()))).not.toContain('not automatically all foreign keys');
    const b2 = erBuilder('T2');
    const x2 = b2.entity('X').key('xid');
    const y2 = b2.entity('Y').key('yid');
    const z2 = b2.entity('Z').key('zid');
    b2.relationship('Some', [{ entity: x2 }, { entity: y2 }, { entity: z2, max: 'one' }]);
    expect(txt(run(b2.build()))).toContain('not automatically all foreign keys');
  });
});

describe('CONV-6 / VAL-12 severity', () => {
  it('unenforceable total on the one side is info (weak owner and 1:N)', () => {
    const b = erBuilder('W');
    const co = b.entity('Company').key('Name');
    const dr = b.entity('Drug', { weak: true }).partialKey('TradeName');
    b.relate('Makes', co, dr, '1:N', { identifying: true, leftTotal: true, rightTotal: true });
    const d = b.entity('Dept').key('did');
    const e = b.entity('Emp').key('eid');
    b.relate('Works', d, e, '1:N', { leftTotal: true });
    const r = run(b.build());
    const ws = r.record.warnings.filter((w) => w.code === 'conv.total-on-one-side-unenforceable');
    expect(ws).toHaveLength(2);
    expect(ws.every((w) => w.severity === 'info')).toBe(true);
  });
});
