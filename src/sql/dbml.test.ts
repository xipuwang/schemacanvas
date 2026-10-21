import { describe, expect, it } from 'vitest';
import { relationalBuilder } from '@/model/builders';
import { fkCardinality } from '@/model/queries';
import type { RelationalModel } from '@/model/types';
import { deepFreeze } from '@/test/deepFreeze';
import { exportDbml, exportDbmlDetailed } from './dbmlExport';
import { importDbml } from './dbmlImport';
import { cycle, kitchenSink, pharmacy, selfRef } from './fixtures';
import { shapeOf } from './testing';
import { SqlParseError } from './types';

const err = (text: string): SqlParseError => {
  try {
    importDbml(text);
  } catch (e) {
    expect(e).toBeInstanceOf(SqlParseError);
    return e as SqlParseError;
  }
  throw new Error('expected SqlParseError');
};
const find = (m: RelationalModel, n: string) => Object.values(m.relations).find((r) => r.name === n)!;

describe('exportDbml', () => {
  it('kitchen sink golden', () => {
    expect(exportDbml(deepFreeze(kitchenSink()))).toBe(`Table order {
  "user id" BIGINT
  No INTEGER
  note TEXT

  indexes {
    ("user id", No) [pk]
  }
}

Table users {
  id BIGINT [pk, increment]
  email VARCHAR(255) [not null, unique]
  status VARCHAR(20) [not null, default: 'active']
  score NUMERIC(8,2) [default: 0]
  created TIMESTAMP [not null, default: \`CURRENT_TIMESTAMP\`]

  indexes {
    status [name: 'idx_users_status']
    created [name: 'idx_users_created']
  }

  checks {
    \`score >= 0\` [name: 'ck_score']
  }
}

Ref: order."user id" > users.id [delete: cascade, update: no action]
`);
  });

  it('writes composite refs as one Ref and composite PK in indexes (pharmacy)', () => {
    const out = exportDbml(pharmacy());
    expect(out).toContain('Ref fk_rx_drug: Prescription.(CompanyName, DrugTradeName) > Drug.(CompanyName, TradeName)');
    expect(out).toContain('Ref fk_sell_drug: Sell.(CompanyName, TradeName) > Drug.(CompanyName, TradeName) [delete: restrict, update: cascade]');
    expect(out).toContain('(CompanyName, TradeName) [pk]');
    expect(out.match(/^Ref/gm)).toHaveLength(9);
  });

  it('is deterministic regardless of Record key order', () => {
    const m = pharmacy();
    const rev = { ...m, relations: Object.fromEntries(Object.entries(m.relations).reverse()), foreignKeys: Object.fromEntries(Object.entries(m.foreignKeys).reverse()) };
    expect(exportDbml(rev)).toBe(exportDbml(m));
  });

  it('reports what DBML cannot express', () => {
    const b = relationalBuilder('x');
    const t = b.relation('T', [{ name: 'id', type: 'INTEGER' }, { name: 'a' }], { pk: ['id'] });
    t.index('ix', ['a'], true);
    t.relation.indexes[0]!.where = 'a > 0';
    t.relation.indexes[0]!.descendingColumnIds = [t.col('a')];
    const r = exportDbmlDetailed(b.build());
    expect(r.issues.map((i) => i.code).sort()).toEqual(['dbml.export.index-order', 'dbml.export.missing-type', 'dbml.export.partial-index']);
  });

  it('1:1 FKs (FK columns are a key) use the - operator', () => {
    const b = relationalBuilder('x');
    const p = b.relation('P', [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
    const c = b.relation('C', [{ name: 'pid', type: 'INTEGER' }], { pk: ['pid'] });
    b.fk(c, ['pid'], p, ['id']);
    expect(exportDbml(b.build())).toContain('Ref: C.pid - P.id');
  });
});

describe('importDbml', () => {
  const sample = `
    // a comment
    Project demo { database_type: 'PostgreSQL' Note: 'x' }
    Enum job_status { created running }

    Table users as U [headercolor: #3498db, note: 'people'] {
      id integer [pk, increment]
      username varchar(255) [not null, unique, note: 'login name']
      role "double precision" [default: 'guest']
      status job_status [default: \`now()\`]
      age int [default: -1]
      active boolean [default: true]
      company_id integer [ref: > companies.id]
      Note: 'All users'
      indexes {
        (username, role) [unique, name: 'uq_user_role']
        age [name: 'idx_age', type: hash]
        (age, active)
        \`lower(username)\` [name: 'fn']
      }
      checks { \`age >= 0\` [name: 'ck_age'] }
    }
    Table companies { id integer [pk] \n name text }
    Table posts {
      id int [pk]
      author_id int [not null]
      company int
      Note { 'multi' }
    }
    Ref author_fk: posts.author_id > users.id [delete: cascade, update: set null]
    Ref: users.id < posts.id
    Ref { posts.company - companies.id }
  `;
  const { model, warnings } = importDbml(sample);

  it('imports tables, columns, settings, notes', () => {
    const users = find(model, 'users');
    expect(users.description).toBe('All users');
    const col = (n: string) => users.columns.find((c) => c.name === n)!;
    expect(col('id')).toMatchObject({ dataType: 'integer', autoIncrement: true, nullable: false });
    expect(users.primaryKey).toEqual([col('id').id]);
    expect(col('username')).toMatchObject({ nullable: false, description: 'login name' });
    expect(col('role')).toMatchObject({ dataType: 'double precision', defaultValue: "'guest'" });
    expect(col('status').defaultValue).toBe('now()');
    expect(col('age').defaultValue).toBe('-1');
    expect(col('active').defaultValue).toBe('true');
    expect(find(model, 'posts').description).toBe('multi');
    expect(users.checks).toMatchObject([{ name: 'ck_age', expression: 'age >= 0', columnIds: [col('age').id] }]);
  });

  it('imports indexes: unique -> UniqueConstraint, typed/plain -> RelIndex', () => {
    const users = find(model, 'users');
    const col = (n: string) => users.columns.find((c) => c.name === n)!.id;
    expect(users.uniques.map((u) => [u.name, u.columnIds])).toEqual([
      [undefined, [col('username')]],
      ['uq_user_role', [col('username'), col('role')]],
    ]);
    expect(users.indexes).toMatchObject([
      { name: 'idx_age', method: 'hash', unique: false, columnIds: [col('age')] },
      { name: 'idx_users_age_active', unique: false, columnIds: [col('age'), col('active')] },
    ]);
  });

  it('refs: > is many-to-one, < is one-to-many, - is one-to-one; inline refs; actions; names', () => {
    const fks = Object.values(model.foreignKeys).map((f) => `${model.relations[f.sourceRelationId]!.name}.${model.relations[f.sourceRelationId]!.columns.find((c) => c.id === f.columns[0]!.sourceColumnId)!.name}>${model.relations[f.targetRelationId]!.name}|${f.name ?? ''}|${f.onDelete ?? ''}|${f.onUpdate ?? ''}`).sort();
    expect(fks).toEqual([
      'posts.author_id>users|author_fk|CASCADE|SET NULL',
      'posts.company>companies|||',
      'posts.id>users|||', // `users.id < posts.id`: the FK sits on the "many" (right) side
      'users.company_id>companies|||',
    ].sort());
  });

  it('cardinality is stored only when DBML states more than the model derives', () => {
    const byName = (n: string) => Object.values(model.foreignKeys).find((f) => model.relations[f.sourceRelationId]!.name === 'posts' && model.relations[f.sourceRelationId]!.columns.find((c) => c.id === f.columns[0]!.sourceColumnId)!.name === n)!;
    // posts.company - companies.id: one-to-one stated, not derivable (company is not unique) => stored
    expect(byName('company').cardinality).toEqual({ childMax: 'one' });
    expect(fkCardinality(model, byName('company')).childMax).toBe('one');
    // posts.id < users.id: posts.id is the PK so childMax derives to 'one'; DBML says many => stored
    expect(byName('id').cardinality).toEqual({ childMax: 'many' });
    // plain many-to-one: derivable => nothing stored
    expect(byName('author_id').cardinality).toBeUndefined();
  });

  it('warns for ignored blocks and expression indexes, naming them', () => {
    const c = warnings.map((w) => w.params!.construct).sort();
    expect(c).toEqual(['Enum', 'Project', 'headercolor', 'index expression'].sort());
    for (const w of warnings) expect(w.code.startsWith('dbml.import.')).toBe(true);
    const proj = warnings.find((w) => w.params!.construct === 'Project')!;
    expect(proj.params).toMatchObject({ line: 3 });
  });

  it('composite refs and many-to-many', () => {
    const { model: m, warnings: w } = importDbml(`
      Table Drug { Co text TradeName text indexes { (Co, TradeName) [pk] } }
      Table Rx { C text T text }
      Table A { id int [pk] }
      Table B { id int [pk] }
      Ref: Rx.(C, T) > Drug.(Co, TradeName)
      Ref: A.id <> B.id
    `);
    expect(Object.values(m.foreignKeys).filter((f) => f.columns.length === 2)).toHaveLength(1);
    const fk = Object.values(m.foreignKeys).find((f) => f.columns.length === 2)!;
    expect(fk.columns.map((p) => find(m, 'Drug').columns.find((c) => c.id === p.targetColumnId)!.name)).toEqual(['Co', 'TradeName']);
    const j = find(m, 'A_B');
    expect(j.primaryKey).toHaveLength(2);
    expect(j.columns.map((c) => c.name)).toEqual(['A_id', 'B_id']);
    expect(Object.values(m.foreignKeys).filter((f) => f.sourceRelationId === j.id)).toHaveLength(2);
    expect(w.map((x) => x.params!.construct)).toEqual(['<>']);
  });

  it('forward refs, aliases and schemas resolve in the second pass', () => {
    const { model: m } = importDbml(`
      Ref: s.child.pid > p.id
      Table s.child { pid int }
      Table parents as p { id int [pk] }
    `);
    expect(shapeOf(m).fks).toEqual(['child(pid->id)>parents|||']);
    expect(find(m, 'child').schemaName).toBe('s');
  });

  it('errors with position', () => {
    expect(err('Table t { a int }\nRef: t.a > nope.id').message).toMatch(/nope.*not defined.*line 2/);
    expect(err('Table t { a int }\nTable u { b int }\nRef: t.zzz > u.b').message).toMatch(/t\.zzz/);
    expect(err('Table t { a int [pk] b int [pk] }').message).toMatch(/several primary keys/);
    expect(err('Table t { a int a int }').message).toMatch(/Duplicate column a/);
    expect(err('Table t { a int').message).toMatch(/Unbalanced|Expected/);
    expect(err("Table t { a int [note: 'x] }").message).toMatch(/Unterminated string/);
    expect(err('Table t { a int } Table u { b int } Ref: t.a >> u.b').message).toMatch(/operator/);
    expect(err('Table t { a int } Table u { b int c int } Ref: t.a > u.(b, c)').message).toMatch(/1 column\(s\) of t with 2/);
    expect(err('Table t { a int } Frobnicate x {}').construct).toBe('Frobnicate');
    expect(err('Table t { ~part }').construct).toBe('~partial');
    expect(err('Table t { a int [default: foo] }').construct).toBe('default');
    expect(err('Table t {\n  a int\n  b int [pk]\n  indexes { (a, zz) }\n}').message).toMatch(/zz/);
  });
});

describe('DBML round trip', () => {
  const shapeNoIdx = (m: RelationalModel) => {
    const s = shapeOf(m);
    // a unique RelIndex re-imports as a UniqueConstraint (documented), so compare "unique key sets" jointly
    return {
      ...s,
      relations: s.relations.map((r) => ({
        ...r,
        uniques: [...r.uniques, ...r.indexes.filter((i) => i.unique).map((i) => i.cols)].map((u) => u.join(',')).sort(),
        indexes: r.indexes.filter((i) => !i.unique).map((i) => ({ name: i.name, cols: i.cols })),
      })),
    };
  };
  const strip = (m: RelationalModel): RelationalModel => {
    // DBML has no DESC/partial/FK-label; remove them from the original before comparing
    for (const r of Object.values(m.relations)) for (const i of r.indexes) (delete i.descendingColumnIds, delete i.where);
    return m;
  };
  for (const [label, make] of [['pharmacy', pharmacy], ['self reference', selfRef], ['cycle', cycle], ['kitchen sink', kitchenSink]] as const) {
    it(`${label}: export -> import -> export is a fixpoint and structurally equal`, () => {
      const original = strip(make('generic'));
      const text = exportDbml(original);
      const { model, warnings } = importDbml(text);
      expect(warnings).toEqual([]);
      expect(shapeNoIdx(model)).toEqual(shapeNoIdx(original));
      expect(exportDbml(model)).toBe(text);
    });
  }
  it('one-to-one cardinality survives', () => {
    const b = relationalBuilder('x');
    const p = b.relation('P', [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
    const c = b.relation('C', [{ name: 'pid', type: 'INTEGER' }], { pk: ['pid'] });
    const fk = b.fk(c, ['pid'], p, ['id']);
    expect(fkCardinality(b.model, fk).childMax).toBe('one');
    const { model } = importDbml(exportDbml(b.build()));
    const f = Object.values(model.foreignKeys)[0]!;
    expect(fkCardinality(model, f).childMax).toBe('one');
  });
  it('escapes newlines in notes; a quote inside a literal default is not exported (dbml2sql would unescape it unsafely)', () => {
    const b = relationalBuilder('x');
    b.relation('T', [{ name: 'id', type: 'TEXT', default: "'it''s ok'", description: "it's\nmulti" }], { pk: ['id'] });
    const m = b.build();
    const back = importDbml(exportDbml(m)).model;
    const c = find(back, 'T').columns[0]!;
    expect(c.defaultValue).toBeUndefined();
    expect(c.description).toBe('it\u2019s\nmulti');
  });
});
