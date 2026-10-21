import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDeterministicIds } from '../ids';
import { columnRole } from '../queries';
import type { Project, RelationalModel } from '../types';
import { OpError } from './common';
import * as ops from './index';
import { projectWith, run, sampleRel } from './testUtils';

let restore: () => void;
beforeEach(() => {
  restore = useDeterministicIds(2000);
});
afterEach(() => restore());

function setup(...types: Array<'relational-schema' | 'crows-foot'>) {
  const s = sampleRel();
  const p = projectWith(s.model, ...(types.length ? types : (['relational-schema'] as const)));
  return { s, p, mid: s.model.id, dgm: Object.keys(p.diagrams)[0]! };
}
const rm = (p: Project, id: string): RelationalModel => p.models[id] as RelationalModel;
const nodeOf = (p: Project, dgm: string, relId: string) => Object.values(p.diagrams[dgm]!.nodes).find((n) => n.ref.kind === 'relation' && n.ref.id === relId)!;

describe('relations', () => {
  it('addRelation: columns, pk flags (NOT NULL, ordered), unique default names, node at place', () => {
    const { p, mid, dgm } = setup('relational-schema', 'crows-foot');
    const { project, result } = run(p, (d) =>
      ops.addRelation(d, mid, { id: 'rln_new', name: 'Student', columns: [{ name: 'SID', dataType: 'INT', pk: true }, { name: 'GPA' }, { name: 'Id2', pk: true }] }, { diagramId: dgm, x: 120, y: 80 }),
    );
    const rel = rm(project, mid).relations['rln_new']!;
    expect(rel.columns.map((c) => c.name)).toEqual(['SID', 'GPA', 'Id2']);
    expect(rel.primaryKey).toEqual([rel.columns[0]!.id, rel.columns[2]!.id]);
    expect(rel.columns.map((c) => c.nullable)).toEqual([false, true, false]);
    expect(nodeOf(project, dgm, 'rln_new')).toMatchObject({ x: 120, y: 80 });
    expect(Object.keys(result.nodeIds)).toHaveLength(2);
    const second = run(project, (d) => ops.addRelation(d, mid)).project;
    const third = run(second, (d) => ops.addRelation(d, mid)).project;
    const names = Object.values(rm(third, mid).relations).map((r) => r.name);
    expect(names).toContain('Table');
    expect(names).toContain('Table_2');
  });

  it('updateRelation renames without touching FKs/nodes; schemaName can be set and cleared', () => {
    const { p, mid, s, dgm } = setup();
    const { project } = run(p, (d) => ops.updateRelation(d, mid, s.doctor.id, { name: 'Physician', schemaName: 'clinic' }));
    expect(rm(project, mid).relations[s.doctor.id]).toMatchObject({ name: 'Physician', schemaName: 'clinic' });
    expect(rm(project, mid).foreignKeys[s.fk1.id]!.targetRelationId).toBe(s.doctor.id);
    expect(nodeOf(project, dgm, s.doctor.id).id).toBe(nodeOf(p, dgm, s.doctor.id).id);
    const cleared = run(project, (d) => ops.updateRelation(d, mid, s.doctor.id, { schemaName: undefined })).project;
    expect('schemaName' in rm(cleared, mid).relations[s.doctor.id]!).toBe(false);
  });

  it('cascade (deleteRelation): every FK whose source or target it is disappears, with their edges and its node', () => {
    const { p, mid, s, dgm } = setup();
    const { project } = run(p, (d) => ops.removeRelation(d, mid, s.patient.id));
    const m = rm(project, mid);
    expect(m.relations[s.patient.id]).toBeUndefined();
    expect(Object.keys(m.foreignKeys)).toEqual([s.fk2.id]); // fk1 (source) and fk3 (target) are gone
    expect(Object.values(project.diagrams[dgm]!.nodes).some((n) => n.ref.id === s.patient.id)).toBe(false);
    expect(Object.keys(project.diagrams[dgm]!.edges)).toHaveLength(1);
  });

  it('cascade (deleteModel): deletes its diagrams and order entries; ConversionRecords are kept', () => {
    const { p, mid } = setup('relational-schema', 'crows-foot');
    const withRecord: Project = { ...JSON.parse(JSON.stringify(p)), conversions: { cnv_1: { id: 'cnv_1', erModelId: 'x', relationalModelId: mid, createdAt: '', options: { oneToOne: 'auto', relationshipOverrides: {}, materializeDerived: [], carryDataTypes: true }, trace: [], decisions: [], warnings: [] } } };
    const { project } = run(withRecord, (d) => ops.removeModel(d, mid));
    expect(project.models[mid]).toBeUndefined();
    expect(project.diagrams).toEqual({});
    expect(project.diagramOrder).toEqual([]);
    expect(project.conversions['cnv_1']).toBeDefined();
    expect(() => run(p, (d) => ops.removeModel(d, 'mdl_ghost'))).toThrow(OpError);
  });
});

describe('columns', () => {
  it('addColumn appends or inserts, gets a unique default name, and appears in the node relation', () => {
    const { p, mid, s } = setup();
    const { project, result } = run(p, (d) => {
      ops.addColumn(d, mid, s.doctor.id, { id: 'col_x', name: 'Phone', dataType: 'VARCHAR(20)', nullable: false, defaultValue: "''" }, { index: 0 });
      return ops.addColumn(d, mid, s.doctor.id);
    });
    const cols = rm(project, mid).relations[s.doctor.id]!.columns;
    expect(cols[0]).toMatchObject({ id: 'col_x', name: 'Phone', dataType: 'VARCHAR(20)', nullable: false, defaultValue: "''" });
    expect(cols.at(-1)!.name).toBe('column');
    expect(result.refs[0]).toEqual({ kind: 'column', relationId: s.doctor.id, id: cols.at(-1)!.id });
    expect(() => run(p, (d) => ops.addColumn(d, mid, 'rln_ghost'))).toThrow(OpError);
  });

  it('updateColumn: forces NOT NULL for PK columns, clears optionals on undefined', () => {
    const { p, mid, s } = setup();
    const ssn = s.doctor.col('SSN');
    const { project } = run(p, (d) => ops.updateColumn(d, mid, s.doctor.id, ssn, { name: 'DoctorId', nullable: true, defaultValue: '0', autoIncrement: true, description: 'd' }));
    expect(rm(project, mid).relations[s.doctor.id]!.columns[0]).toMatchObject({ name: 'DoctorId', nullable: false, defaultValue: '0', autoIncrement: true });
    const name = s.doctor.col('Name');
    const nullable = run(project, (d) => ops.updateColumn(d, mid, s.doctor.id, name, { nullable: false })).project;
    expect(rm(nullable, mid).relations[s.doctor.id]!.columns[1]!.nullable).toBe(false);
    const cleared = run(project, (d) => ops.updateColumn(d, mid, s.doctor.id, ssn, { defaultValue: undefined, autoIncrement: undefined, dataType: undefined })).project;
    const col = rm(cleared, mid).relations[s.doctor.id]!.columns[0]!;
    expect('defaultValue' in col || 'autoIncrement' in col || 'dataType' in col).toBe(false);
  });

  it('reorderColumn moves cells but FK pairs / PK ids / column widths follow the ids, not the positions', () => {
    const { p, mid, s, dgm } = setup();
    const node = nodeOf(p, dgm, s.patient.id);
    const doctorSsn = s.patient.col('DoctorSSN');
    const widthed = run(p, (d) => ops.setColumnWidth(d, dgm, node.id, doctorSsn, 140)).project;
    const { project } = run(widthed, (d) => ops.reorderColumn(d, mid, s.patient.id, doctorSsn, 0));
    const rel = rm(project, mid).relations[s.patient.id]!;
    expect(rel.columns.map((c) => c.name)).toEqual(['DoctorSSN', 'PID', 'Name']);
    expect(rm(project, mid).foreignKeys[s.fk1.id]!.columns).toEqual([{ sourceColumnId: doctorSsn, targetColumnId: s.doctor.col('SSN') }]);
    expect(rel.primaryKey).toEqual([s.patient.col('PID')]);
    expect(nodeOf(project, dgm, s.patient.id).columnWidths).toEqual({ [doctorSsn]: 140 });
    expect(columnRole(rm(project, mid), s.patient.id, doctorSsn)).toBe('fk');
    expect(() => run(p, (d) => ops.reorderColumn(d, mid, s.patient.id, 'col_ghost', 0))).toThrow(OpError);
  });

  it('cascade (deleteColumn): PK, uniques, indexes (empty ones deleted), checks, descendingColumnIds', () => {
    const { p, mid, s } = setup();
    const [company, trade] = s.drug.cols('CompanyName', 'TradeName');
    const prepared = run(p, (d) => {
      ops.addUnique(d, mid, s.drug.id, { id: 'uq_both', columnIds: [company!, trade!] });
      ops.addUnique(d, mid, s.drug.id, { id: 'uq_only', columnIds: [trade!] });
      ops.addIndex(d, mid, s.drug.id, { id: 'idx_both', columnIds: [company!, trade!], descendingColumnIds: [trade!] });
      ops.addIndex(d, mid, s.drug.id, { id: 'idx_only', columnIds: [trade!] });
      ops.addCheck(d, mid, s.drug.id, { id: 'chk_1', expression: 'TradeName <> 1', columnIds: [trade!] });
      ops.addCheck(d, mid, s.drug.id, { id: 'chk_2', expression: '1 = 1' });
    }).project;
    const { project } = run(prepared, (d) => ops.removeColumn(d, mid, s.drug.id, trade!));
    const drug = rm(project, mid).relations[s.drug.id]!;
    expect(drug.columns.map((c) => c.name)).toEqual(['CompanyName', 'Formula']);
    expect(drug.primaryKey).toEqual([company]);
    expect(drug.uniques.map((u) => [u.id, u.columnIds])).toEqual([['uq_both', [company]]]);
    expect(drug.indexes.map((i) => [i.id, i.columnIds, i.descendingColumnIds])).toEqual([['idx_both', [company], undefined]]);
    expect(drug.checks!.map((c) => c.id)).toEqual(['chk_2']);
  });

  it('cascade (deleteColumn): a partially removed composite FK stays; one with 0 pairs left is deleted; columnWidths and branchAnchors go', () => {
    const { p, mid, s, dgm } = setup();
    const rxNode = nodeOf(p, dgm, s.rx.id);
    const [cn, dt] = s.rx.cols('CompanyName', 'DrugTradeName');
    const fkEdge = Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === s.fk2.id)!;
    const prepared = run(p, (d) => {
      ops.setColumnWidth(d, dgm, rxNode.id, cn!, 90);
      ops.setColumnWidth(d, dgm, rxNode.id, dt!, 70);
      ops.setEdgeRoute(d, dgm, fkEdge.id, { branchAnchors: { [cn!]: { source: { side: 'top', offset: 0.3 } }, [dt!]: { target: { side: 'bottom' } } } });
    }).project;
    const partial = run(prepared, (d) => ops.removeColumn(d, mid, s.rx.id, cn!)).project;
    expect(rm(partial, mid).foreignKeys[s.fk2.id]!.columns).toEqual([{ sourceColumnId: dt, targetColumnId: s.drug.col('TradeName') }]);
    expect(nodeOf(partial, dgm, s.rx.id).columnWidths).toEqual({ [dt!]: 70 });
    expect(partial.diagrams[dgm]!.edges[fkEdge.id]!.route.branchAnchors).toEqual({ [dt!]: { target: { side: 'bottom' } } });
    expect(rm(partial, mid).relations[s.rx.id]!.primaryKey).toEqual([s.rx.col('PID'), dt]);
    const gone = run(partial, (d) => ops.removeColumn(d, mid, s.rx.id, dt!)).project;
    expect(rm(gone, mid).foreignKeys[s.fk2.id]).toBeUndefined();
    expect(gone.diagrams[dgm]!.edges[fkEdge.id]).toBeUndefined();
    expect(nodeOf(gone, dgm, s.rx.id).columnWidths).toBeUndefined();
  });

  it('cascade (deleteColumn): removing a TARGET column prunes the pair (and the FK) from the referencing side too', () => {
    const { p, mid, s } = setup();
    const { project } = run(p, (d) => ops.removeColumn(d, mid, s.doctor.id, s.doctor.col('SSN')));
    expect(rm(project, mid).foreignKeys[s.fk1.id]).toBeUndefined();
    expect(rm(project, mid).relations[s.doctor.id]!.primaryKey).toEqual([]);
    expect(rm(project, mid).relations[s.patient.id]!.columns.map((c) => c.name)).toContain('DoctorSSN'); // the FK column itself stays
  });
});

describe('keys', () => {
  it('setPrimaryKey: ordered composite PK, forces NOT NULL, removal leaves nullable alone, refuses foreign/duplicate columns', () => {
    const { p, mid, s } = setup();
    const [name, ssn] = s.doctor.cols('Name', 'SSN');
    const { project } = run(p, (d) => ops.setPrimaryKey(d, mid, s.doctor.id, [name!, ssn!]));
    const rel = rm(project, mid).relations[s.doctor.id]!;
    expect(rel.primaryKey).toEqual([name, ssn]);
    expect(rel.columns.every((c) => c.nullable === false)).toBe(true);
    const relaxed = run(project, (d) => {
      ops.setPrimaryKey(d, mid, s.doctor.id, [ssn!]);
    }).project;
    expect(rm(relaxed, mid).relations[s.doctor.id]!.columns.find((c) => c.id === name)!.nullable).toBe(false);
    expect(() => run(p, (d) => ops.setPrimaryKey(d, mid, s.doctor.id, [s.patient.col('PID')]))).toThrow(OpError);
    expect(() => run(p, (d) => ops.setPrimaryKey(d, mid, s.doctor.id, [ssn!, ssn!]))).toThrow(OpError);
    const none = run(project, (d) => ops.setPrimaryKey(d, mid, s.doctor.id, [])).project;
    expect(rm(none, mid).relations[s.doctor.id]!.primaryKey).toEqual([]);
  });

  it('setColumnUnique toggles exactly the single-column constraint', () => {
    const { p, mid, s } = setup();
    const name = s.doctor.col('Name');
    const ssn = s.doctor.col('SSN');
    const on = run(p, (d) => {
      ops.addUnique(d, mid, s.doctor.id, { id: 'uq_multi', columnIds: [name, ssn] });
      return ops.setColumnUnique(d, mid, s.doctor.id, name, true);
    });
    expect(rm(on.project, mid).relations[s.doctor.id]!.uniques.map((u) => u.columnIds)).toEqual([[name, ssn], [name]]);
    const twice = run(on.project, (d) => ops.setColumnUnique(d, mid, s.doctor.id, name, true)).project;
    expect(rm(twice, mid).relations[s.doctor.id]!.uniques).toHaveLength(2);
    const off = run(twice, (d) => ops.setColumnUnique(d, mid, s.doctor.id, name, false)).project;
    expect(rm(off, mid).relations[s.doctor.id]!.uniques.map((u) => u.id)).toEqual(['uq_multi']);
  });

  it('unique / index / check: add, update, remove with column ownership validation', () => {
    const { p, mid, s } = setup();
    const [a, b] = s.patient.cols('PID', 'Name');
    const { project, result } = run(p, (d) => {
      const u = ops.addUnique(d, mid, s.patient.id, { name: 'uq_p', columnIds: [a!] });
      ops.updateUnique(d, mid, s.patient.id, u.refs[0]!.id, { columnIds: [a!, b!], name: undefined });
      const i = ops.addIndex(d, mid, s.patient.id, { columnIds: [b!], unique: true, where: 'x > 1', method: 'btree' });
      ops.updateIndex(d, mid, s.patient.id, i.refs[0]!.id, { columnIds: [a!, b!], descendingColumnIds: [b!], where: undefined, name: 'idx_renamed' });
      const c = ops.addCheck(d, mid, s.patient.id, { expression: 'PID > 0', columnIds: [a!] });
      return { u, i, c };
    });
    const rel = rm(project, mid).relations[s.patient.id]!;
    expect(rel.uniques).toEqual([{ id: result.u.refs[0]!.id, columnIds: [a, b] }]);
    expect(rel.indexes[0]).toMatchObject({ name: 'idx_renamed', columnIds: [a, b], unique: true, method: 'btree', descendingColumnIds: [b] });
    expect('where' in rel.indexes[0]!).toBe(false);
    expect(rel.checks).toHaveLength(1);
    const removed = run(project, (d) => {
      ops.removeUnique(d, mid, s.patient.id, rel.uniques[0]!.id);
      ops.removeIndex(d, mid, s.patient.id, rel.indexes[0]!.id);
      ops.removeCheck(d, mid, s.patient.id, rel.checks![0]!.id);
    }).project;
    const r2 = rm(removed, mid).relations[s.patient.id]!;
    expect([r2.uniques, r2.indexes, r2.checks]).toEqual([[], [], undefined]);
    expect(() => run(p, (d) => ops.addUnique(d, mid, s.patient.id, { columnIds: [] }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.addIndex(d, mid, s.patient.id, { columnIds: [s.doctor.col('SSN')] }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.addCheck(d, mid, s.patient.id, { expression: '  ' }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.removeUnique(d, mid, s.patient.id, 'uq_ghost'))).toThrow(OpError);
  });
});

describe('foreign keys', () => {
  it('addForeignKey: composite = ONE FK with ordered pairs and ONE edge; edge appears in every diagram', () => {
    const s = sampleRel();
    // start without the composite FK
    delete s.model.foreignKeys[s.fk2.id];
    const p = projectWith(s.model, 'relational-schema', 'crows-foot');
    const [cn, dt] = s.rx.cols('CompanyName', 'DrugTradeName');
    const { project, result } = run(p, (d) =>
      ops.addForeignKey(d, s.model.id, {
        id: 'fk_comp',
        name: 'fk_rx_drug',
        sourceRelationId: s.rx.id,
        targetRelationId: s.drug.id,
        columns: [{ sourceColumnId: cn!, targetColumnId: s.drug.col('CompanyName') }, { sourceColumnId: dt!, targetColumnId: s.drug.col('TradeName') }],
        onDelete: 'CASCADE',
        label: 'prescribes',
      }),
    );
    expect(result.refs).toEqual([{ kind: 'foreignKey', id: 'fk_comp' }]);
    expect(rm(project, s.model.id).foreignKeys['fk_comp']).toMatchObject({ onDelete: 'CASCADE', label: 'prescribes', name: 'fk_rx_drug' });
    for (const d of Object.values(project.diagrams)) {
      expect(Object.values(d.edges).filter((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === 'fk_comp')).toHaveLength(1);
    }
  });

  it('addForeignKey refuses missing relations, foreign columns, empty/duplicate pairs', () => {
    const { p, mid, s } = setup();
    const base = { sourceRelationId: s.patient.id, targetRelationId: s.doctor.id };
    const pair = { sourceColumnId: s.patient.col('DoctorSSN'), targetColumnId: s.doctor.col('SSN') };
    const bad = (init: Partial<Parameters<typeof ops.addForeignKey>[2]>) => () => run(p, (d) => ops.addForeignKey(d, mid, { ...base, columns: [pair], ...init }));
    expect(bad({ sourceRelationId: 'rln_ghost' })).toThrow(OpError);
    expect(bad({ targetRelationId: 'rln_ghost' })).toThrow(OpError);
    expect(bad({ columns: [] })).toThrow(OpError);
    expect(bad({ columns: [{ ...pair, sourceColumnId: s.doctor.col('Name') }] })).toThrow(/does not belong/);
    expect(bad({ columns: [{ ...pair, targetColumnId: s.patient.col('PID') }] })).toThrow(/does not belong/);
    expect(bad({ columns: [pair, { sourceColumnId: pair.sourceColumnId, targetColumnId: s.doctor.col('Name') }] })).toThrow(OpError);
    try {
      bad({ columns: [] })();
    } catch (e) {
      expect((e as OpError).code).toBe('foreign-key-invalid');
    }
    // a relation from ANOTHER model is not accepted either
    const other = sampleRel();
    expect(() => run(p, (d) => ops.addForeignKey(d, mid, { sourceRelationId: other.patient.id, targetRelationId: s.doctor.id, columns: [pair] }))).toThrow(OpError);
  });

  it('allows recursive FKs (self-reference) and non-key targets (soft state)', () => {
    const { p, mid, s } = setup();
    const { project } = run(p, (d) => {
      ops.addForeignKey(d, mid, { sourceRelationId: s.doctor.id, targetRelationId: s.doctor.id, columns: [{ sourceColumnId: s.doctor.col('Name'), targetColumnId: s.doctor.col('SSN') }] });
      ops.addForeignKey(d, mid, { sourceRelationId: s.patient.id, targetRelationId: s.doctor.id, columns: [{ sourceColumnId: s.patient.col('PID'), targetColumnId: s.doctor.col('Name') }] });
    });
    expect(Object.keys(rm(project, mid).foreignKeys)).toHaveLength(5);
  });

  it('updateForeignKey: pairs re-validated, branchAnchors of dropped pairs pruned, label/actions/cardinality editable', () => {
    const { p, mid, s, dgm } = setup();
    const [cn, dt] = s.rx.cols('CompanyName', 'DrugTradeName');
    const edge = Object.values(p.diagrams[dgm]!.edges).find((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === s.fk2.id)!;
    const prepared = run(p, (d) => ops.setEdgeRoute(d, dgm, edge.id, { branchAnchors: { [cn!]: { source: { side: 'top' } }, [dt!]: { source: { side: 'bottom' } } } })).project;
    const swapped = [
      { sourceColumnId: dt!, targetColumnId: s.drug.col('TradeName') },
    ];
    const { project } = run(prepared, (d) =>
      ops.updateForeignKey(d, mid, s.fk2.id, { columns: swapped, label: 'L', onUpdate: 'RESTRICT', name: 'n', cardinality: { childMax: 'one', parentMin: 1 } }),
    );
    expect(rm(project, mid).foreignKeys[s.fk2.id]).toMatchObject({ columns: swapped, label: 'L', onUpdate: 'RESTRICT', name: 'n', cardinality: { childMax: 'one', parentMin: 1 } });
    expect(project.diagrams[dgm]!.edges[edge.id]!.route.branchAnchors).toEqual({ [dt!]: { source: { side: 'bottom' } } });
    const cleared = run(project, (d) => ops.updateForeignKey(d, mid, s.fk2.id, { label: undefined, onUpdate: undefined, cardinality: undefined, name: undefined })).project;
    const fk = rm(cleared, mid).foreignKeys[s.fk2.id]!;
    expect(['label', 'onUpdate', 'cardinality', 'name'].some((k) => k in fk)).toBe(false);
    expect(() => run(p, (d) => ops.updateForeignKey(d, mid, s.fk2.id, { columns: [{ sourceColumnId: s.patient.col('PID'), targetColumnId: s.drug.col('TradeName') }] }))).toThrow(OpError);
    expect(() => run(p, (d) => ops.updateForeignKey(d, mid, 'fk_ghost', {}))).toThrow(OpError);
  });

  it('removeForeignKey removes constraint and edge; source/target relations stay', () => {
    const { p, mid, s, dgm } = setup();
    const { project } = run(p, (d) => ops.removeForeignKey(d, mid, s.fk1.id));
    expect(rm(project, mid).foreignKeys[s.fk1.id]).toBeUndefined();
    expect(Object.values(project.diagrams[dgm]!.edges).some((e) => e.ref.kind === 'foreignKey' && e.ref.foreignKeyId === s.fk1.id)).toBe(false);
    expect(Object.keys(rm(project, mid).relations)).toHaveLength(4);
  });

  it('createFkColumns copies ONLY the target dataType, avoids name collisions, and feeds addForeignKey', () => {
    const { p, mid, s } = setup();
    const withAuto = run(p, (d) => ops.updateColumn(d, mid, s.doctor.id, s.doctor.col('SSN'), { autoIncrement: true, defaultValue: '7' })).project;
    const { project } = run(withAuto, (d) => {
      const made = ops.createFkColumns(d, mid, { sourceRelationId: s.drug.id, targetRelationId: s.doctor.id, nullable: false });
      ops.addForeignKey(d, mid, { sourceRelationId: s.drug.id, targetRelationId: s.doctor.id, columns: made.pairs });
    });
    const drug = rm(project, mid).relations[s.drug.id]!;
    const created = drug.columns.at(-1)!;
    expect(created).toMatchObject({ name: 'SSN', dataType: 'CHAR(9)', nullable: false });
    expect('autoIncrement' in created || 'defaultValue' in created).toBe(false);
    // a second call collides with "SSN" and falls back to Doctor_SSN
    const again = run(project, (d) => ops.createFkColumns(d, mid, { sourceRelationId: s.drug.id, targetRelationId: s.doctor.id, names: ['CompanyName'] })).project;
    expect(rm(again, mid).relations[s.drug.id]!.columns.at(-1)!.name).toBe('CompanyName_2');
    const composite = run(p, (d) => ops.createFkColumns(d, mid, { sourceRelationId: s.patient.id, targetRelationId: s.drug.id }));
    expect(composite.result.pairs.map((x) => x.targetColumnId)).toEqual(s.drug.relation.primaryKey);
    expect(rm(composite.project, mid).relations[s.patient.id]!.columns.slice(-2).map((c) => c.name)).toEqual(['CompanyName', 'TradeName']);
    // referencing a relation without a key requires explicit target columns
    const keyless = run(p, (d) => ops.setPrimaryKey(d, mid, s.doctor.id, [])).project;
    expect(() => run(keyless, (d) => ops.createFkColumns(d, mid, { sourceRelationId: s.patient.id, targetRelationId: s.doctor.id }))).toThrow(OpError);
  });
});
