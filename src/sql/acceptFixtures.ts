/** Free-text fixtures shared by the SQL unit tests and the real-database integration tests (never imported by app code). */
import { relationalBuilder } from '@/model/builders';
import type { RelationalModel } from '@/model/types';

export type AcceptDialect = 'postgresql' | 'sqlite' | 'mysql';

export interface AcceptCase {
  column: string;
  type: string;
  def?: string;
  /** substring expected (case-insensitive) in the catalogue's default / the stored table SQL */
  expectDefault?: string;
}

/** Table `acc`: every must-accept DEFAULT / type and CHECK, per dialect. */
export function acceptCases(d: AcceptDialect): AcceptCase[] {
  const cases: AcceptCase[] = [
    { column: 'c_text', type: 'VARCHAR(50)', def: "'N/A'", expectDefault: 'N/A' },
    { column: 'c_zero', type: 'INTEGER', def: '0', expectDefault: '0' },
    { column: 'c_neg', type: 'INTEGER', def: '-1', expectDefault: '-1' },
    { column: 'c_float', type: 'DOUBLE PRECISION', def: '1.5e3', expectDefault: d === 'sqlite' ? '1.5e3' : '1500' },
    { column: 'c_bool', type: 'BOOLEAN', def: 'TRUE' },
    { column: 'c_null', type: 'VARCHAR(10)', def: 'NULL' },
    { column: 'c_quote', type: 'VARCHAR(20)', def: "'it''s'", expectDefault: "it" },
    { column: 'c_hash', type: 'VARCHAR(7)', def: "'#FFFFFF'", expectDefault: '#FFFFFF' },
    { column: 'c_num', type: 'NUMERIC(10,2)' },
    { column: 'c_status', type: 'VARCHAR(10)' },
    { column: 'c_name', type: 'VARCHAR(50)' },
    { column: '价格', type: 'INTEGER' },
    { column: 'Weird Col', type: 'INTEGER' },
    { column: 'c_zip', type: 'VARCHAR(10)' },
    { column: 'c_cast', type: 'INTEGER' },
    { column: 'c_ts', type: d === 'mysql' ? 'DATETIME(3)' : 'TIMESTAMP(3)', def: d === 'mysql' ? 'NOW()' : d === 'sqlite' ? 'CURRENT_TIMESTAMP' : 'CURRENT_TIMESTAMP(3)' },
    { column: 'c_ts2', type: d === 'mysql' ? 'TIMESTAMP(6)' : 'TIMESTAMP', def: d === 'mysql' ? 'LOCALTIMESTAMP' : 'CURRENT_TIMESTAMP' },
  ];
  if (d !== 'sqlite') cases.push({ column: 'c_uuid', type: d === 'postgresql' ? 'UUID' : 'CHAR(36)', def: d === 'postgresql' ? 'gen_random_uuid()' : 'uuid()' });
  if (d === 'sqlite') cases.push({ column: 'c_now', type: 'TEXT', def: "datetime('now')" });
  if (d === 'postgresql') cases.push({ column: 'c_arr', type: 'TEXT[]' }, { column: 'c_tz', type: 'TIMESTAMP(3) WITH TIME ZONE' });
  if (d === 'mysql') cases.push({ column: 'c_uns', type: 'INT UNSIGNED' }, { column: 'c_enum', type: "ENUM('a','b')", def: "'a'", expectDefault: 'a' });
  return cases;
}

/** The CHECK expressions (exactly as a user or the SQL importer writes them, multi-line included). */
export function acceptChecks(d: AcceptDialect): string[] {
  const quoted = d === 'mysql' ? '`Weird Col` > 0' : '"Weird Col" > 0';
  const checks = [
    'c_num > 0 AND c_num < 1000',
    "c_status IN ('a',\n  'b',\r\n\t'c')",
    'length(c_name) >= 2',
    '价格 > 0',
    quoted,
  ];
  if (d === 'postgresql') checks.push("c_zip ~ '^\\d{5}$'", 'c_cast::int > 0');
  return checks;
}

export function acceptModel(d: AcceptDialect): RelationalModel {
  const b = relationalBuilder('accept', d);
  const t = b.relation('acc', [{ name: 'id', type: 'INTEGER' }, ...acceptCases(d).map((c) => ({ name: c.column, type: c.type, nullable: true, ...(c.def !== undefined ? { default: c.def } : {}) }))], { pk: ['id'] });
  t.relation.checks = acceptChecks(d).map((expression, i) => ({ id: `ck${i}`, name: `ck_acc_${i}`, expression }));
  return b.build();
}

/** Payload models: one hostile value in one field of table `t` (with a parent table `par`, an FK, a check and an index). */
export function payloadModel(field: 'type' | 'default' | 'check' | 'where', p: string, d: AcceptDialect): RelationalModel {
  const b = relationalBuilder('R', d);
  const parent = b.relation('par', [{ name: 'id', type: 'INTEGER' }], { pk: ['id'] });
  const t = b.relation('t', [{ name: 'id', type: 'INTEGER' }, { name: 'x', type: field === 'type' ? p : 'INTEGER', ...(field === 'default' ? { default: p } : {}) }, { name: 'pid', type: 'INTEGER', nullable: true }], { pk: ['id'] });
  b.fk(t, ['pid'], parent, ['id']);
  if (field === 'check') t.relation.checks = [{ id: 'ck', expression: p }];
  t.relation.indexes.push({ id: 'ix', name: 'ix_t', columnIds: [t.col('id')], unique: false, ...(field === 'where' ? { where: p } : {}) });
  return b.build();
}

/** Hostile values; every one must be refused (or its field omitted) on every dialect and never run as a statement. */
export const HOSTILE: string[] = [
  "$é$'$é$ ) WITH (fillfactor = $é$'$é$, 70",
  `$${'t'.repeat(70)}$ ; DROP TABLE par ; -- $${'t'.repeat(70)}$`,
  "text DEFAULT $é$''",
  "INTEGER [']) STRICT [']",
  'INTEGER [(]x)',
  "INTEGER ['', \"\\\" ) ) ; DROP TABLE par ; -- \"",
  "E'\\''",
  'int(1;DROP TABLE par;)',
  'int(1\n}\nTable evil {\n a int\n}\n)',
  '0); DROP TABLE par; --',
  '1=1); DROP TABLE par; --',
  '1\nDROP TABLE par',
  '1 # ; DROP TABLE par',
  "'a' ; DROP TABLE par",
  '$$ ; DROP TABLE par ; -- $$',
  // relfix3 round 2: constraints / extra columns smuggled through a type or default
  'INTEGER REFERENCES par (id)',
  'INTEGER UNIQUE',
  'INTEGER GENERATED ALWAYS AS (id) STORED',
  '0, evil text',
  '0, CONSTRAINT u UNIQUE (x)',
  '(1) UNIQUE',
  '(1) REFERENCES par (id) ON DELETE CASCADE',
  '1 NOT NULL',
  'now() REFERENCES par(id)',
  // relfix3 round 3: subqueries / statements are not one simple expression
  "(SELECT 'x' FROM secrets)",
  '(SELECT*FROM users) > 0',
  '(SELECT(1) FROM t FOR UPDATE)',
  '(cast(1 as `(`)), evil text, y int default (cast(2 as `)`))',
];
