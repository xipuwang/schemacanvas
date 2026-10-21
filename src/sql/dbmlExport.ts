/**
 * DBML export. Pure and deterministic (relations ordered by (name, id), column order preserved).
 *
 * Mapping decisions (see README):
 *  - single-column PK -> `[pk]`; composite PK -> `indexes { (a, b) [pk] }`;
 *  - unnamed single-column UNIQUE -> `[unique]`; every other UNIQUE -> `indexes { ... [unique, name: '…'] }`;
 *  - one `Ref` per ForeignKey (composite FKs use `a.(x, y) > b.(p, q)`); operator `-` when the effective
 *    `fkCardinality().childMax` is 'one', else `>`;
 *  - no DBML equivalent (partial index predicate, DESC columns, FK labels, childMin/parentMin) -> dropped with an issue.
 */
import { makeIssue } from '@/model/issues';
import type { DbmlExportCode } from './codes';
import { scanSqlText } from './sqlText';
import { fkCardinality } from '@/model/queries';
import type { ForeignKey, Issue, RelColumn, Relation, RelationalModel, SemanticRef } from '@/model/types';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ACTIONS: ReadonlySet<string> = new Set(['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION']);
const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const escapeBreaks = (s: string): string => s.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\u2028\u2029]/g, ' ');
export const dbmlName = (n: string): string => (BARE.test(n) ? n : `"${escapeBreaks(n.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))}"`);
export const dbmlString = (s: string): string => `'${escapeBreaks(s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"))}'`;

/** Types DBML accepts unquoted: identifier, optional schema, optional (args), optional []. */
const dbmlType = (t: string): { text: string; unsafe: boolean } => {
  const scan = scanSqlText(t, 'dbml', 'type');
  // a literal argument is never written bare: DBML reads ''' as a multi-line string, SQL as an escaped quote
  if (scan.ok && !scan.text.includes("'") && /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)?(\([^)]*\))?(\[\])*$/.test(scan.text)) return { text: scan.text, unsafe: false };
  // a refused type is never written, not even quoted: dbml2sql prints quoted types raw for MySQL/MSSQL/Oracle (warning instead)
  // the one exception is a fixed-size array such as INT[3] (letters, digits and brackets only, nothing that can break out)
  if (!scan.ok) return /^[A-Za-z_]\w*(\[\d*\])+$/.test(t.trim()) ? { text: `"${t.trim()}"`, unsafe: false } : { text: 'text', unsafe: true };
  // downstream converters (dbml2sql) unescape \" and \\ without re-escaping them, so neither character is ever written
  return { text: `"${escapeBreaks(scan.text.replace(/["\\]/g, ' '))}"`, unsafe: false };
};

export interface DbmlExport {
  dbml: string;
  issues: Issue[];
}

/** SQL literal / expression -> DBML default value, or undefined when DBML cannot express it. */
export function dbmlDefault(raw: string): string | undefined {
  const d = raw.trim();
  const lit = /^'((?:[^']|'')*)'$/.exec(d);
  // a backslash is an escape on MySQL, `;` and control characters never belong in a value: refuse them like the scanner does
  // a quote inside the value is refused too: DBML writes it as \' and dbml2sql emits that as a bare ' (not re-doubled)
  if (lit && /[\\;'\u0000-\u001F\u007F-\u009F\u2028\u2029]/.test(lit[1]!.replace(/''/g, "'"))) return undefined;
  if (lit) return dbmlString(lit[1]!.replace(/''/g, "'"));
  if (/^[+-]?\d+(\.\d+)?$/.test(d)) return d;
  if (/^(true|false|null)$/i.test(d)) return d.toLowerCase();
  const scan = scanSqlText(d, 'dbml', 'default');
  return scan.ok ? `\`${scan.text}\`` : undefined;
}

/**
 * Characters downstream DBML converters (dbml2sql) unescape or re-quote without escaping: replaced in names and notes. Besides
 * DBML's own quotes this covers the identifier quotes of the SQL it generates (` for MySQL, [ ] for MSSQL) and ' (notes and
 * constraint names become SQL string literals).
 */
const DBML_UNSAFE = /["\\`'[\]]/g;

export function exportDbmlDetailed(source: Readonly<RelationalModel>): DbmlExport {
  const issues: Issue[] = [];
  const dirty = new Set<string>();
  const clean = (s: string, r: Relation): string => {
    if (!DBML_UNSAFE.test(s)) return s;
    DBML_UNSAFE.lastIndex = 0;
    dirty.add(r.id);
    // an apostrophe becomes the typographic one (notes stay readable); every other unsafe character becomes an underscore
    return s.replace(DBML_UNSAFE, (ch) => (ch === "'" ? '\u2019' : '_'));
  };
  const cleanOpt = (s: string | undefined, r: Relation): string | undefined => (s === undefined ? s : clean(s, r));
  // a replaced name may now equal another name (a'b and a’b, x[1] and x_1_): suffix it so the DBML still re-imports
  // (names that need no replacement are reserved first, so only a replaced name ever gets the suffix)
  const unique = (name: string, original: string, taken: Set<string>): string => {
    if (name === original) return name;
    let out = name;
    for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${name}_${n}`;
    taken.add(out.toLowerCase());
    return out;
  };
  const needsClean = (s: string): boolean => /["\\`'[\]]/.test(s);
  const reserve = (names: string[]): Set<string> => new Set(names.filter((n) => !needsClean(n)).map((n) => n.toLowerCase()));
  const tableNames = reserve(Object.values(source.relations).map((r) => r.name));
  const model: Readonly<RelationalModel> = {
    ...source,
    relations: Object.fromEntries(
      Object.entries(source.relations).map(([id, r]) => {
        const columnNames = reserve(r.columns.map((c) => c.name));
        return [
        id,
        {
          ...r,
          name: unique(clean(r.name, r), r.name, tableNames),
          schemaName: cleanOpt(r.schemaName, r),
          description: cleanOpt(r.description, r),
          primaryKeyName: cleanOpt(r.primaryKeyName, r),
          columns: r.columns.map((c) => ({ ...c, name: unique(clean(c.name, r), c.name, columnNames), description: cleanOpt(c.description, r) })),
          uniques: r.uniques.map((u) => ({ ...u, name: cleanOpt(u.name, r) })),
          indexes: r.indexes.map((i) => ({ ...i, name: clean(i.name, r), method: cleanOpt(i.method, r) })),
          checks: r.checks?.map((ch) => ({ ...ch, name: cleanOpt(ch.name, r) })),
        },
      ];
      }),
    ),
    foreignKeys: Object.fromEntries(Object.entries(source.foreignKeys).map(([id, fk]) => [id, { ...fk, name: fk.name === undefined ? fk.name : clean(fk.name, source.relations[fk.sourceRelationId] ?? ({ id: fk.sourceRelationId } as Relation)) }])),
  };
  const drop = (code: DbmlExportCode, title: string, explanation: string, affected: SemanticRef[], params: Record<string, string | number> = {}): void => {
    issues.push(
      makeIssue({
        code: `dbml.export.${code}`,
        severity: 'warning',
        title,
        explanation,
        suggestion: 'DBML cannot express this; it is omitted from the export.',
        affected,
        modelId: model.id,
        params,
      }),
    );
  };
  const rels = Object.values(model.relations).sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
  const colName = (r: Relation, id: string): string => dbmlName(r.columns.find((c) => c.id === id)?.name ?? '?');
  const list = (r: Relation, ids: string[]): string => (ids.length === 1 ? colName(r, ids[0]!) : `(${ids.map((i) => colName(r, i)).join(', ')})`);
  const tableRef = (r: Relation): string => (r.schemaName ? `${dbmlName(r.schemaName)}.${dbmlName(r.name)}` : dbmlName(r.name));

  for (const id of [...dirty].sort()) drop('text', 'Characters replaced in a name or note', 'A name or note contained a quote, backtick, bracket or backslash, which downstream DBML converters do not escape safely: single quotes became ’ and the other characters underscores (a suffix keeps renamed names unique).', [{ kind: 'relation', id }], { relation: model.relations[id]?.name ?? '' });
  const blocks: string[] = [];
  for (const r of rels) {
    const lines: string[] = [];
    // A NAMED single-column PK goes to `indexes { id [pk, name: '…'] }` so the constraint name survives a round trip.
    const singlePk = r.primaryKey.length === 1 && !r.primaryKeyName ? r.primaryKey[0] : undefined;
    // First unnamed single-column UNIQUE of a column is written inline; everything else goes to `indexes`.
    const inlineCols = new Set<string>();
    const inlineUniqueIds = new Set<string>();
    for (const u of r.uniques) {
      if (u.columnIds.length === 1 && !u.name && !inlineCols.has(u.columnIds[0]!)) {
        inlineCols.add(u.columnIds[0]!);
        inlineUniqueIds.add(u.id);
      }
    }

    for (const c of r.columns) {
      const s: string[] = [];
      if (c.id === singlePk) s.push('pk');
      else if (!c.nullable && !r.primaryKey.includes(c.id)) s.push('not null');
      if (inlineCols.has(c.id)) s.push('unique');
      if (c.autoIncrement) s.push('increment');
      if (c.defaultValue?.trim()) {
        const d = dbmlDefault(c.defaultValue);
        if (d !== undefined) s.push(`default: ${d}`);
        else if (/^'(?:[^']|'')*'$/.test(c.defaultValue.trim()) && c.defaultValue.trim().slice(1, -1).includes("'"))
          drop('default-quote', 'Default dropped', `The default of ${r.name}.${c.name} is a text literal containing a single quote; downstream DBML converters cannot write that safely, so it is omitted.`, [{ kind: 'column', relationId: r.id, id: c.id }], { relation: r.name, column: c.name });
        else drop('default', 'Default dropped', `The default of ${r.name}.${c.name} is not a plain SQL expression (only identifiers, numbers, quoted literals, simple operators and parentheses are exported) and cannot be written as a DBML expression.`, [{ kind: 'column', relationId: r.id, id: c.id }], { relation: r.name, column: c.name });
      }
      if (c.description) s.push(`note: ${dbmlString(c.description)}`);
      if (!c.dataType?.trim()) {
        drop('missing-type', 'Column type defaulted to text', `${r.name}.${c.name} has no data type; DBML requires one, so "text" was written.`, [{ kind: 'column', relationId: r.id, id: c.id }], { relation: r.name, column: c.name });
      }
      const ty = dbmlType(columnType(c));
      if (ty.unsafe) drop('type', 'Unsafe data type replaced', `The data type of ${r.name}.${c.name} is not a plain SQL type, so it was replaced by text in the DBML; set a plain type to keep it.`, [{ kind: 'column', relationId: r.id, id: c.id }], { relation: r.name, column: c.name });
      lines.push(`  ${dbmlName(c.name)} ${ty.text}${s.length ? ` [${s.join(', ')}]` : ''}`);
    }
    if (r.description) lines.push('', `  Note: ${dbmlString(r.description)}`);

    const idx: string[] = [];
    if (r.primaryKey.length > 1 || (r.primaryKey.length === 1 && r.primaryKeyName)) idx.push(`    ${list(r, r.primaryKey)} [pk${r.primaryKeyName ? `, name: ${dbmlString(r.primaryKeyName)}` : ''}]`);
    for (const u of r.uniques) {
      if (inlineUniqueIds.has(u.id)) continue;
      idx.push(`    ${list(r, u.columnIds)} [unique${u.name ? `, name: ${dbmlString(u.name)}` : ''}]`);
    }
    for (const i of r.indexes) {
      const ref: SemanticRef = { kind: 'index', relationId: r.id, id: i.id };
      if (i.where) drop('partial-index', 'Partial index predicate dropped', `Index ${i.name} on ${r.name} has a WHERE predicate, which DBML cannot express.`, [ref], { index: i.name, relation: r.name });
      if (i.descendingColumnIds?.length) drop('index-order', 'Index column order dropped', `Index ${i.name} on ${r.name} has DESC columns, which DBML cannot express.`, [ref], { index: i.name, relation: r.name });
      const s = [...(i.unique ? ['unique'] : []), ...(i.name ? [`name: ${dbmlString(i.name)}`] : []), ...(i.method ? [`type: ${BARE.test(i.method.trim()) ? i.method.trim() : dbmlString(i.method)}`] : [])];
      idx.push(`    ${list(r, i.columnIds)}${s.length ? ` [${s.join(', ')}]` : ''}`);
    }
    if (idx.length) lines.push('', '  indexes {', ...idx, '  }');
    if (r.checks?.length) {
      lines.push('', '  checks {');
      for (const ch of r.checks) {
        const scan = scanSqlText(ch.expression.trim(), 'dbml', 'check');
        if (!scan.ok) {
          drop('check', 'CHECK dropped', `A CHECK of ${r.name} is not a plain SQL expression and cannot be written as a DBML expression.`, [{ kind: 'relation', id: r.id }], { relation: r.name });
          continue;
        }
        lines.push(`    \`${scan.text}\`${ch.name ? ` [name: ${dbmlString(ch.name)}]` : ''}`);
      }
      lines.push('  }');
    }
    blocks.push(`Table ${tableRef(r)} {\n${lines.join('\n')}\n}`);
  }

  const fkKey = (fk: ForeignKey): [string, string, number, string, string] => {
    const src = model.relations[fk.sourceRelationId];
    const first = src ? Math.min(...fk.columns.map((p) => src.columns.findIndex((c) => c.id === p.sourceColumnId))) : 0;
    return [src?.name ?? '', model.relations[fk.targetRelationId]?.name ?? '', first, fk.name ?? '', fk.id];
  };
  const fks = Object.values(model.foreignKeys)
    .filter((fk) => {
      const ok = model.relations[fk.sourceRelationId] && model.relations[fk.targetRelationId] && fk.columns.length > 0;
      if (!ok) drop('foreign-key', 'Foreign key skipped', 'A foreign key refers to a missing relation or has no columns.', [{ kind: 'foreignKey', id: fk.id }]);
      return ok;
    })
    .sort((a, b) => {
      const ka = fkKey(a);
      const kb = fkKey(b);
      return cmp(ka[0], kb[0]) || cmp(ka[1], kb[1]) || ka[2] - kb[2] || cmp(ka[3], kb[3]) || cmp(ka[4], kb[4]);
    });
  const refs = fks.map((fk) => {
    const src = model.relations[fk.sourceRelationId]!;
    const tgt = model.relations[fk.targetRelationId]!;
    if (fk.label) drop('fk-label', 'Foreign key label dropped', `The label "${fk.label}" of a foreign key on ${src.name} has no DBML equivalent.`, [{ kind: 'foreignKey', id: fk.id }], { label: fk.label, relation: src.name });
    const op = fkCardinality(model as RelationalModel, fk).childMax === 'one' ? '-' : '>';
    const act = (v: string | undefined): string | undefined => (v && ACTIONS.has(v.trim().replace(/\s+/g, ' ').toUpperCase()) ? v.trim().replace(/\s+/g, ' ').toLowerCase() : undefined);
    const s = [...(act(fk.onDelete) ? [`delete: ${act(fk.onDelete)}`] : []), ...(act(fk.onUpdate) ? [`update: ${act(fk.onUpdate)}`] : [])];
    const left = `${tableRef(src)}.${list(src, fk.columns.map((p) => p.sourceColumnId))}`;
    const right = `${tableRef(tgt)}.${list(tgt, fk.columns.map((p) => p.targetColumnId))}`;
    return `Ref${fk.name ? ` ${dbmlName(fk.name)}` : ''}: ${left} ${op} ${right}${s.length ? ` [${s.join(', ')}]` : ''}`;
  });

  return { dbml: `${[...blocks, ...(refs.length ? [refs.join('\n')] : [])].join('\n\n')}\n`, issues };
}

function columnType(c: RelColumn): string {
  // DBML requires a type; `text` is the least surprising stand-in for an undeclared one.
  return c.dataType?.trim() || 'text';
}

/** DBML text for `model` (issues are available through `exportDbmlDetailed`). */
export function exportDbml(model: Readonly<RelationalModel>): string {
  return exportDbmlDetailed(model).dbml;
}
