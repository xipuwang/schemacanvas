/** Regression tests for the independent review findings VAL-1 ... VAL-11. */
import { describe, expect, it } from 'vitest';
import { erBuilder, relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import { convertErToRelational } from '@/conversion';
import { exampleE } from '@/conversion/fixtures';
import type { ErModel, Project, RelationalModel } from '@/model/types';
import { check, codesOf, pharmacyEr, pharmacyRel, projectOf } from './fixtures';
import { validateProject } from './index';

const relB = () => relationalBuilder('R');
const reverseKeys = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).reverse()) as T;

function plainProject(m: ErModel | RelationalModel): Project {
  const p = createBareProject('x');
  p.models[m.id] = m;
  return p;
}

describe('VAL-1 click-to-highlight for FK-structure issues', () => {
  const twoTables = (mutate: (fk: ReturnType<ReturnType<typeof relB>['fk']>) => void): RelationalModel => {
    const b = relB();
    const t = b.relation('T', ['a', 'x'], { pk: ['a'] });
    const u = b.relation('U', ['a'], { pk: ['a'] });
    mutate(b.fk(t, ['x'], u, ['a']));
    return b.build();
  };

  it.each([
    ['target column deleted', (fk: any) => (fk.columns[0].targetColumnId = 'col_ghost'), 'rel.fk-column-missing'],
    ['source column deleted', (fk: any) => (fk.columns[0].sourceColumnId = 'col_ghost'), 'rel.fk-column-missing'],
    ['no column pairs', (fk: any) => (fk.columns = []), 'rel.fk-no-columns'],
  ])('%s: the issue names both tables (check() counts only edges the scene draws)', (_n, mutate, code) => {
    const { issues } = check(twoTables(mutate)); // throws when nothing drawable is highlighted
    const issue = issues.find((i) => i.code === code)!;
    expect(issue.affected.filter((r) => r.kind === 'relation')).toHaveLength(2);
  });
});

describe('VAL-2 validateProject never throws on odd optional fields', () => {
  it('ER: keyParticipantIds not an array, prototype-key entity ids', () => {
    const f = pharmacyEr();
    const m = f.b.build() as any;
    const r = Object.values<any>(m.relationships)[0];
    r.keyParticipantIds = 'par_x';
    expect(() => validateProject(plainProject(m))).not.toThrow();
    r.keyParticipantIds = undefined;
    r.participants[0].entityId = 'constructor';
    expect(codesOf(validateProject(plainProject(m)))).toContain('er.participant-missing-entity');
  });

  it('relational: numeric dataType / schemaName, non-array origin.sources, prototype-key relation ids', () => {
    const m = pharmacyRel().b.build() as any;
    for (const rel of Object.values<any>(m.relations)) {
      rel.schemaName = 5;
      for (const c of rel.columns) c.dataType = 42;
    }
    const fks = Object.values<any>(m.foreignKeys);
    for (const fk of fks) fk.origin = { ruleId: 'one-to-many-fk', sources: 'nope', key: 'k' };
    for (const rel of Object.values<any>(m.relations)) for (const c of rel.columns) c.nullable = true;
    expect(() => validateProject(plainProject(m))).not.toThrow();
    fks[0].targetRelationId = 'toString';
    fks[1].sourceRelationId = 'hasOwnProperty';
    const codes = codesOf(validateProject(plainProject(m)));
    expect(codes).toContain('rel.fk-relation-missing');
  });
});

describe('VAL-3 output does not depend on record key order', () => {
  const same = (m: ErModel | RelationalModel, keys: string[]): void => {
    const rev: any = structuredClone(m);
    for (const k of keys) rev[k] = reverseKeys(rev[k]);
    expect(validateProject(plainProject(rev))).toEqual(validateProject(plainProject(structuredClone(m))));
  };

  it('duplicate relation names and duplicate FKs', () => {
    const b = relB();
    b.relation('Student', ['a'], { pk: ['a'] });
    b.relation('student', ['a'], { pk: ['a'] });
    const x = b.relation('X', [{ name: 'id', type: 'INT' }, { name: 'y', type: 'INT', nullable: false }], { pk: ['id'] });
    const y = b.relation('Y', [{ name: 'id', type: 'INT' }, { name: 'x', type: 'INT', nullable: false }], { pk: ['id'] });
    b.fk(x, ['y'], y, ['id']);
    b.fk(y, ['x'], x, ['id']);
    b.fk(y, ['x'], x, ['id']);
    same(b.build(), ['relations', 'foreignKeys']);
  });

  it('duplicate ER names and weak ownership cycles', () => {
    const b = erBuilder('E');
    b.entity('Course').key('c');
    b.entity('course').key('c');
    const ws = [1, 2, 3].map((i) => b.entity(`W${i}`, { weak: true }).partialKey('p'));
    for (const [o, d] of [[ws[0]!, ws[1]!], [ws[1]!, ws[2]!], [ws[2]!, ws[0]!]] as const) {
      const r = b.relate(`I${o.entity.name}`, o, d, '1:N', { identifying: true, rightTotal: true });
      r.relationship.participants[1]!.identified = true;
    }
    b.relationship('R', [{ entity: ws[0]! }]);
    b.relationship('r', [{ entity: ws[1]! }]);
    const e = b.entity('E').key('k');
    e.attr('Nm').attr('nm');
    same(b.build(), ['entities', 'relationships', 'attributes']);
  });
});

describe('VAL-4 weak entity at most one per owner needs no partial key', () => {
  const weak = (card: '1:1' | '1:N'): ErModel => {
    const b = erBuilder('E');
    const p = b.entity('Person').key('Pid');
    const prof = b.entity('Profile', { weak: true }).attr('Bio');
    b.relate('HasProfile', p, prof, card, { identifying: true, rightTotal: true });
    return b.build();
  };
  it('1:1 identifying: no warning', () => expect(codesOf(check(weak('1:1')).issues)).not.toContain('er.weak-no-partial-key'));
  it('1:N identifying: still warns', () => expect(codesOf(check(weak('1:N')).issues)).toContain('er.weak-no-partial-key'));
});

describe('VAL-5 integer vs numeric foreign keys', () => {
  const fkOf = (a: string, b2: string): string[] => {
    const b = relB();
    const t = b.relation('T', [{ name: 'id', type: 'INT' }, { name: 'x', type: a }], { pk: ['id'] });
    const u = b.relation('U', [{ name: 'id', type: b2 }], { pk: ['id'] });
    b.fk(t, ['x'], u, ['id']);
    return codesOf(check(b.build()).issues);
  };
  it('INTEGER -> NUMERIC(10) is fine', () => expect(fkOf('INTEGER', 'NUMERIC(10)')).toEqual([]));
  it('DATE -> INT still mismatches', () => expect(fkOf('DATE', 'INT')).toEqual(['rel.fk-type-mismatch']));
});

describe('VAL-6 participation of a relationship-relation FK', () => {
  function sellNullable(pharmacyTotal: boolean) {
    const er = exampleE();
    const sell = Object.values(er.relationships).find((r) => r.name === 'Sell')!;
    sell.participants[0]!.participation = pharmacyTotal ? 'total' : 'partial';
    const project = createBareProject('p');
    withDiagram(project, er, 'chen');
    const res = convertErToRelational(project, er.id);
    project.models[res.relationalModel.id] = res.relationalModel;
    project.diagrams[res.diagram.id] = res.diagram;
    const rel = Object.values(res.relationalModel.relations).find((r) => r.name === 'Sell')!;
    const c = rel.columns.find((x) => /pharmacy/i.test(x.name))!;
    rel.primaryKey = rel.primaryKey.filter((id) => id !== c.id);
    c.nullable = true;
    return validateProject(project).filter((i) => i.code === 'rel.fk-total-but-nullable');
  }
  it('does not read the referenced participant as the holder side, and does not depend on it', () => {
    for (const total of [true, false]) {
      const issues = sellNullable(total);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.explanation).not.toContain('participation behind');
      expect(issues[0]!.params?.source).toBe('relationship');
    }
  });
});

describe('VAL-7 repeated referenced column', () => {
  it('explains the repetition, not an empty missing list', () => {
    const b = relB();
    const u = b.relation('U', ['a'], { pk: ['a'] });
    const t = b.relation('T', ['id', 'x', 'y'], { pk: ['id'] });
    const fk = b.fk(t, ['x'], u, ['a']);
    fk.columns.push({ sourceColumnId: t.col('y'), targetColumnId: u.col('a') });
    const issue = check(b.build()).issues.find((i) => i.code === 'rel.fk-target-not-key')!;
    expect(issue.explanation).toContain('more than once');
    expect(issue.explanation).not.toContain('missing key column(s): .');
  });
});

describe('VAL-8 SET NULL on primary-key columns', () => {
  it('does not advise making a PK column nullable', () => {
    const b = relB();
    const u = b.relation('U', ['a'], { pk: ['a'] });
    const t = b.relation('T', ['a', 'w'], { pk: ['a', 'w'] });
    b.fk(t, ['a'], u, ['a'], { onDelete: 'SET NULL' });
    const issue = check(b.build()).issues.find((i) => i.code === 'rel.fk-set-null-not-null')!;
    expect(issue.suggestion).not.toMatch(/or make the column/);
    expect(issue.suggestion).toContain('CASCADE');
  });
});

describe('VAL-9 no primary key but a NOT NULL UNIQUE candidate key', () => {
  it('is a recommendation, not an error', () => {
    const b = relB();
    b.relation('Log', [{ name: 'k', type: 'INT', nullable: false, unique: true }, 'msg']);
    const { issues } = check(b.build());
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['rel.no-primary-key-candidate', 'info']]);
  });
  it('stays an error with no candidate key (nullable UNIQUE does not count)', () => {
    const b = relB();
    b.relation('Log', [{ name: 'k', type: 'INT', unique: true }]);
    expect(codesOf(check(b.build()).issues)).toEqual(['rel.no-primary-key']);
  });
});

describe('VAL-10 optional flag on a key attribute', () => {
  it('warns that the flag is ignored', () => {
    const b = erBuilder('x');
    b.entity('S').key('id', { optional: true } as any);
    const { issues } = check(b.build());
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['er.key-optional', 'warning']]);
  });
});

describe('VAL-11 scale', () => {
  it('a 12000-relation NOT NULL FK cycle neither overflows the stack nor misses the cycle', () => {
    const n = 12000;
    const b = relB();
    const rs = Array.from({ length: n }, (_, i) =>
      b.relation(`T${i}`, [{ name: 'id', type: 'INT' }, { name: 'p', type: 'INT', nullable: false }], { pk: ['id'] }),
    );
    for (let i = 0; i < n; i++) b.fk(rs[i]!, ['p'], rs[(i + 1) % n]!, ['id']);
    const issues = validateProject(projectOf(b.build()).project);
    expect(codesOf(issues)).toEqual(['rel.fk-not-null-cycle']);
  }, 60_000);

  it('caches never leak between validations of a mutated model', () => {
    const f = pharmacyEr();
    const m = f.b.build();
    const p = plainProject(m);
    expect(validateProject(p)).toEqual([]);
    f.doctor.entity.weak = true; // same model object, now invalid
    expect(codesOf(validateProject(p)).length).toBeGreaterThan(0);
  });
});
