import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import type { RelationalModel, SqlDialect } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import { generateDdl } from './ddl';
import { parseDdl } from './ddlParser';
import { cycle, kitchenSink, pharmacy, selfRef } from './fixtures';
import { shapeOf } from './testing';

const dialects: SqlDialect[] = ['postgresql', 'sqlite', 'mysql', 'generic'];

function sqliteSafe(m: RelationalModel, d: SqlDialect): RelationalModel {
  // SQLite emits an AUTOINCREMENT key as INTEGER (documented), so declare it that way before comparing types.
  if (d === 'sqlite') for (const r of Object.values(m.relations)) for (const c of r.columns) if (c.autoIncrement) c.dataType = 'INTEGER';
  return m;
}

const fixtures: Array<[string, (d: SqlDialect) => RelationalModel]> = [
  ['pharmacy', pharmacy],
  ['self-reference + autoincrement', selfRef],
  ['FK cycle', cycle],
  ['kitchen sink', kitchenSink],
];

describe('model -> generateDdl -> parseDdl is structurally equal', () => {
  for (const d of dialects) {
    for (const [label, make] of fixtures) {
      it(`${label} (${d})`, () => {
        const original = deepFreeze(sqliteSafe(make(d), d));
        const { sql, issues } = generateDdl(original, d, { header: false });
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
        expect(sql).not.toBe('');
        const { model, warnings } = parseDdl(sql, d);
        expect(warnings).toEqual([]);
        expect(shapeOf(model)).toEqual(shapeOf(original));
        // Fixpoint: the re-imported model generates byte-identical DDL (names, order, types, constraints).
        expect(generateDdl(model, d, { header: false }).sql).toBe(sql);
      });
    }
  }

  it('auto-detection picks the right dialect from generated text', () => {
    expect(parseDdl(generateDdl(pharmacy('mysql'), 'mysql').sql).model.dialect).toBe('mysql');
    expect(parseDdl(generateDdl(selfRef('sqlite'), 'sqlite').sql).model.dialect).toBe('sqlite');
    expect(parseDdl(generateDdl(selfRef('postgresql'), 'postgresql').sql).model.dialect).toBe('postgresql');
  });

  it('composite FK pairs keep target key order and stay ONE foreign key', () => {
    for (const d of dialects) {
      const { model } = parseDdl(generateDdl(pharmacy(d), d).sql, d);
      const rx = Object.values(model.relations).find((r) => r.name === 'Prescription')!;
      const drug = Object.values(model.relations).find((r) => r.name === 'Drug')!;
      const fk = Object.values(model.foreignKeys).filter((f) => f.sourceRelationId === rx.id && f.targetRelationId === drug.id);
      expect(fk).toHaveLength(1);
      expect(fk[0]!.columns.map((p) => drug.columns.find((c) => c.id === p.targetColumnId)!.name)).toEqual(['CompanyName', 'TradeName']);
      expect(fk[0]!.columns.map((p) => rx.columns.find((c) => c.id === p.sourceColumnId)!.name)).toEqual(['CompanyName', 'DrugTradeName']);
    }
  });

  it('schemas, unique-index FK targets (deferred ALTER) and odd identifiers round-trip in postgresql', () => {
    const b = relationalBuilder('x', 'postgresql');
    const p = b.relation('Par"ent', [{ name: 'id', type: 'INTEGER' }, { name: 'code col', type: 'TEXT' }], { pk: ['id'], schemaName: 'my app' });
    p.index('uq_code', ['code col'], true);
    const c = b.relation('child', [{ name: 'id', type: 'INTEGER' }, { name: 'code', type: 'TEXT', nullable: true }], { pk: ['id'], schemaName: 'my app' });
    b.fk(c, ['code'], p, ['code col'], { name: 'fk_code' });
    const m = b.build();
    const { sql } = generateDdl(m, 'postgresql', { header: false });
    expect(sql).toContain('ALTER TABLE "my app".child ADD CONSTRAINT fk_code FOREIGN KEY (code) REFERENCES "my app"."Par""ent" ("code col");');
    const { model, warnings } = parseDdl(sql, 'postgresql');
    expect(warnings.map((w) => w.params!.construct)).toEqual(['CREATE SCHEMA']);
    expect(shapeOf(model)).toEqual(shapeOf(m));
  });

  it('type-less and quoted-reserved models round-trip in sqlite', () => {
    const b = relationalBuilder('x', 'sqlite');
    b.relation('select', [{ name: 'from' }, { name: 'where', nullable: false }], { pk: ['where'] });
    const m = b.build();
    const { sql } = generateDdl(m, 'sqlite', { header: false });
    expect(shapeOf(parseDdl(sql, 'sqlite').model)).toEqual(shapeOf(m));
  });
});
