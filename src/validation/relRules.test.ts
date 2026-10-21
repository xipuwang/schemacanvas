import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { createBareProject } from '@/model/defaults';
import { withDiagram } from '@/model/diagramSync';
import type { RelColumn, RelationalModel } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import { validateProject } from './index';
import { check, codesOf, pharmacyEr, pharmacyRel } from './fixtures';

const codes = (m: RelationalModel): string[] => codesOf(check(m).issues);
const only = (m: RelationalModel, code: string): void => expect(codes(m)).toEqual([code]);
const col = (r: { relation: { columns: RelColumn[] } }, name: string): RelColumn => r.relation.columns.find((c) => c.name === name)!;

describe('pharmacy relational baseline', () => {
  it('is valid (composite PKs and composite FKs included): no issues at all', () => {
    expect(check(pharmacyRel().b.build()).issues).toEqual([]);
  });
});

describe('names', () => {
  it('flags empty relation and column names', () => {
    const f = pharmacyRel();
    f.company.relation.name = '';
    col(f.doctor, 'Specialty').name = ' ';
    expect(codes(f.b.build())).toEqual(['rel.column-name-empty', 'rel.relation-name-empty']);
  });

  it('flags duplicate relation names, but not the same name in different schemas', () => {
    const f = pharmacyRel();
    f.company.relation.name = 'DOCTOR';
    only(f.b.build(), 'rel.relation-name-duplicate');
    f.company.relation.schemaName = 'sales';
    expect(codes(f.b.build())).toEqual([]);
  });

  it('flags duplicate column names within a relation, but not across relations', () => {
    const f = pharmacyRel();
    f.doctor.addColumn('ssn');
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.column-name-duplicate']);
    expect(issues[0]!.affected).toHaveLength(2);
  });
});

describe('primary key and key columns', () => {
  it('rel.no-primary-key; incoming FKs are then reported as not referencing a key', () => {
    const f = pharmacyRel();
    f.drug.relation.primaryKey = [];
    expect(codes(f.b.build())).toEqual(['rel.fk-target-not-key', 'rel.no-primary-key']);
  });

  it('a relation consisting only of PK columns is valid', () => {
    const b = relationalBuilder('x');
    b.relation('Tag', ['Name'], { pk: ['Name'] });
    expect(check(b.build()).issues).toEqual([]);
  });

  it('rel.pk-nullable', () => {
    const f = pharmacyRel();
    col(f.contact, 'StartDate').nullable = true; // not in PK: fine
    expect(codes(f.b.build())).toEqual([]);
    col(f.contact, 'PharmacyName').nullable = true;
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.pk-nullable']);
    expect(issues[0]!.severity).toBe('error');
  });

  it('rel.key-column-missing: unique, index and PK referencing a column of another relation or a deleted one', () => {
    const f = pharmacyRel();
    // Contact has no incoming FKs, so only the key rule fires.
    f.contact.relation.uniques.push({ id: 'uq_bad', columnIds: [col(f.doctor, 'Name').id] });
    f.contact.relation.indexes.push({ id: 'idx_bad', name: 'ix', columnIds: ['col_gone'], unique: false });
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.key-column-missing']);
    expect(issues).toHaveLength(2);
    expect(issues.find((i) => i.affected[0]!.kind === 'unique')!.explanation).toContain('"Doctor"."Name"');
    f.contact.relation.primaryKey = [...f.contact.relation.primaryKey, col(f.doctor, 'Name').id];
    expect(check(f.b.build()).issues.filter((i) => i.code === 'rel.key-column-missing')).toHaveLength(3);
  });
});

describe('foreign keys: structure', () => {
  it('rel.fk-relation-missing', () => {
    const f = pharmacyRel();
    f.fks.patientDoctor!.sourceRelationId = 'rln_gone';
    only(f.b.build(), 'rel.fk-relation-missing');
  });

  it('rel.fk-no-columns', () => {
    const f = pharmacyRel();
    f.fks.patientDoctor!.columns = [];
    only(f.b.build(), 'rel.fk-no-columns');
  });

  it('rel.fk-column-missing on either side', () => {
    const f = pharmacyRel();
    f.fks.patientDoctor!.columns = [{ sourceColumnId: 'col_gone', targetColumnId: col(f.doctor, 'SSN').id }];
    only(f.b.build(), 'rel.fk-column-missing');
    f.fks.patientDoctor!.columns = [{ sourceColumnId: col(f.patient, 'DoctorSSN').id, targetColumnId: 'col_gone' }];
    only(f.b.build(), 'rel.fk-column-missing');
  });

  it('rel.fk-column-wrong-relation: a column of another relation on the source or the target side', () => {
    const f = pharmacyRel();
    f.fks.patientDoctor!.columns = [{ sourceColumnId: col(f.doctor, 'Name').id, targetColumnId: col(f.doctor, 'SSN').id }];
    const r1 = check(f.b.build()).issues;
    expect(codesOf(r1)).toEqual(['rel.fk-column-wrong-relation']);
    expect(r1[0]!.severity).toBe('error');
    f.fks.patientDoctor!.columns = [{ sourceColumnId: col(f.patient, 'DoctorSSN').id, targetColumnId: col(f.patient, 'SSN').id }];
    only(f.b.build(), 'rel.fk-column-wrong-relation');
  });
});

describe('rel.fk-target-not-key', () => {
  it('headline case: incomplete composite key, message names the missing key column', () => {
    const f = pharmacyRel();
    f.fks.sellDrug!.columns = [f.fks.sellDrug!.columns[0]!];
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-target-not-key']);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.explanation).toContain('missing key column(s): TradeName');
    expect(issues[0]!.title).toContain('Sell.CompanyName → Drug.CompanyName');
  });

  it('is NOT raised when the composite key is complete, in any pair order', () => {
    const f = pharmacyRel();
    f.fks.sellDrug!.columns = [...f.fks.sellDrug!.columns].reverse();
    expect(check(f.b.build()).issues).toEqual([]);
  });

  it('is NOT raised for an FK to a UNIQUE constraint or a unique index', () => {
    const f = pharmacyRel();
    f.company.unique('Phone');
    f.b.fk(f.pharmacy, ['Phone'], f.company, ['Phone']);
    expect(check(f.b.build()).issues).toEqual([]);
    const g = pharmacyRel();
    g.company.index('ux_phone', ['Phone'], true);
    g.b.fk(g.pharmacy, ['Phone'], g.company, ['Phone']);
    expect(check(g.b.build()).issues).toEqual([]);
  });

  it('is raised for a non-unique column, and a partial unique index does not count', () => {
    const f = pharmacyRel();
    f.b.fk(f.pharmacy, ['Phone'], f.company, ['Phone']);
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-target-not-key']);
    expect(issues[0]!.explanation).toContain('primary key (Name)');
    f.company.index('ux_phone', ['Phone'], true);
    f.company.relation.indexes[0]!.where = 'Phone IS NOT NULL';
    only(f.b.build(), 'rel.fk-target-not-key');
  });
});

describe('rel.fk-type-mismatch', () => {
  it('warns only for clearly incompatible families', () => {
    const f = pharmacyRel();
    col(f.patient, 'DoctorSSN').dataType = 'INT'; // VARCHAR target
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-type-mismatch']);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('does not warn for compatible or unknown types', () => {
    const f = pharmacyRel();
    col(f.patient, 'DoctorSSN').dataType = 'VARCHAR(100)'; // compatible
    expect(codes(f.b.build())).toEqual([]);
    col(f.patient, 'DoctorSSN').dataType = 'TEXT'; // same family
    expect(codes(f.b.build())).toEqual([]);
    delete col(f.patient, 'DoctorSSN').dataType; // unknown
    expect(codes(f.b.build())).toEqual([]);
    col(f.patient, 'DoctorSSN').dataType = 'MY_CUSTOM_TYPE'; // unknown
    expect(codes(f.b.build())).toEqual([]);
  });
});

describe('rel.fk-total-but-nullable', () => {
  it('warns when parentMin=1 is stated but the column is nullable', () => {
    const f = pharmacyRel();
    col(f.patient, 'DoctorSSN').nullable = true;
    expect(codes(f.b.build())).toEqual([]); // nothing stated: an optional FK is perfectly valid
    f.fks.patientDoctor!.cardinality = { parentMin: 1 };
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-total-but-nullable']);
    expect(issues[0]!.severity).toBe('warning');
    f.fks.patientDoctor!.cardinality = { parentMin: 0 };
    expect(codes(f.b.build())).toEqual([]);
  });

  describe('via the conversion Origin', () => {
    const setup = (participation: 'partial' | 'total' | 'dangling') => {
      const er = pharmacyEr();
      const rel = pharmacyRel();
      const primary = Object.values(er.b.model.relationships).find((r) => r.name === 'Primary_physician')!;
      const patientPart = primary.participants[1]!;
      patientPart.participation = participation === 'partial' ? 'partial' : 'total';
      rel.fks.patientDoctor!.origin = {
        ruleId: 'one-to-many-fk',
        sources: [
          { kind: 'participant', relationshipId: participation === 'dangling' ? 'rel_gone' : primary.id, id: patientPart.id },
          { kind: 'participant', relationshipId: primary.id, id: primary.participants[0]!.id },
          { kind: 'relationship', id: primary.id },
        ],
      };
      col(rel.patient, 'DoctorSSN').nullable = true;
      const project = createBareProject('p');
      withDiagram(project, er.b.build(), 'chen');
      withDiagram(project, rel.b.build(), 'relational-schema');
      return validateProject(deepFreeze(project));
    };

    it('warns when the holder-side participant is total', () => {
      expect(codesOf(setup('total'))).toEqual(['rel.fk-total-but-nullable']);
    });
    it('does not warn for a partial participant or a dangling Origin', () => {
      expect(setup('partial')).toEqual([]);
      expect(setup('dangling')).toEqual([]);
    });
  });
});

describe('referential actions and cycles', () => {
  it("rel.fk-set-null-not-null: 'SET NULL' on a NOT NULL column is an error; fine on a nullable one", () => {
    const f = pharmacyRel();
    f.fks.patientDoctor!.onDelete = 'SET NULL';
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-set-null-not-null']);
    expect(issues[0]!.severity).toBe('error');
    col(f.patient, 'DoctorSSN').nullable = true;
    expect(codes(f.b.build())).toEqual([]);
    f.fks.patientDoctor!.onUpdate = 'SET NULL';
    expect(codes(f.b.build())).toEqual([]);
  });

  const cycle = (n: number, nullableIndex?: number) => {
    const b = relationalBuilder('cyc');
    const rels = Array.from({ length: n }, (_, i) =>
      b.relation(`T${i}`, ['id', { name: 'next', nullable: nullableIndex === i }], { pk: ['id'] }),
    );
    rels.forEach((r, i) => b.fk(r, ['next'], rels[(i + 1) % n]!, ['id']));
    return b.build();
  };

  it('rel.fk-not-null-cycle: warning for 2- and 3-cycles; broken by one nullable FK', () => {
    for (const n of [2, 3]) {
      const { issues } = check(cycle(n));
      expect(codesOf(issues)).toEqual(['rel.fk-not-null-cycle']);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.severity).toBe('warning');
      expect(issues[0]!.affected.filter((r) => r.kind === 'relation')).toHaveLength(n);
      expect(issues[0]!.affected.filter((r) => r.kind === 'foreignKey')).toHaveLength(n);
      expect(check(cycle(n, 0)).issues).toEqual([]);
    }
  });

  it('a one-directional chain of NOT NULL FKs is not a cycle', () => {
    const f = pharmacyRel();
    expect(codes(f.b.build())).toEqual([]);
  });

  it('self-referencing FK: nullable is silent, NOT NULL is an info hint (unless stated optional)', () => {
    const make = (nullable: boolean, card?: { parentMin: 0 | 1 }) => {
      const b = relationalBuilder('s');
      const e = b.relation('Employee', ['Eid', { name: 'ManagerEid', nullable }], { pk: ['Eid'] });
      const fk = b.fk(e, ['ManagerEid'], e, ['Eid']);
      if (card) fk.cardinality = card;
      return b.build();
    };
    expect(check(make(true)).issues).toEqual([]);
    const { issues } = check(make(false));
    expect(codesOf(issues)).toEqual(['rel.self-reference-not-null']);
    expect(issues[0]!.severity).toBe('info');
    expect(check(make(false, { parentMin: 0 })).issues).toEqual([]);
  });
});

describe('rel.fk-duplicate', () => {
  it('is info for identical FKs, not for FKs to different targets', () => {
    const f = pharmacyRel();
    f.b.fk(f.patient, ['DoctorSSN'], f.doctor, ['SSN']);
    const { issues } = check(f.b.build());
    expect(codesOf(issues)).toEqual(['rel.fk-duplicate']);
    expect(issues[0]!.severity).toBe('info');
    expect(issues[0]!.affected).toHaveLength(2);
  });
});

describe('unconventional but valid designs', () => {
  it('FK covering the whole PK (1:1 subtype/extension table) is valid', () => {
    const b = relationalBuilder('x');
    const person = b.relation('Person', ['Id', 'Name'], { pk: ['Id'] });
    const student = b.relation('Student', ['Id', 'Gpa'], { pk: ['Id'] });
    b.fk(student, ['Id'], person, ['Id']);
    expect(check(b.build()).issues).toEqual([]);
  });

  it('a recursive M:N relation (PreReq) with two FKs to the same table is valid', () => {
    const b = relationalBuilder('x');
    const course = b.relation('Course', ['Cid', 'Name'], { pk: ['Cid'] });
    const pre = b.relation('PreReq', ['Cid', 'Req_Cid'], { pk: ['Cid', 'Req_Cid'] });
    b.fk(pre, ['Cid'], course, ['Cid']);
    b.fk(pre, ['Req_Cid'], course, ['Cid']);
    expect(check(b.build()).issues).toEqual([]);
  });
});
