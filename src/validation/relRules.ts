/**
 * Relational validation rules. FK semantics come from model/queries (`fkCardinality`, `findColumn`,
 * `relationNameKey`) and model/relationalFacts (`fkReferencesKey`, `dataTypesCompatible`); rules never re-derive them.
 * Definite structural errors are `error`; probable problems `warning`; recommendations `info`.
 * Unconventional-but-valid designs (PK-only relations, self-referencing FKs, FKs to UNIQUE keys, FK = whole PK)
 * are never flagged as errors.
 */
import { fkCardinality, findColumn, relationColumn, sqlNameKey } from '@/model/queries';
import { dataTypesCompatible, fkReferencesKey, parseDataType } from '@/model/relationalFacts';
import type { ForeignKey, Id, Project, RelColumn, Relation, RelationalModel, SemanticRef, Severity } from '@/model/types';
import type { IssueDraft, RelRule } from './types';
import { arrayOf, byNameThenId, duplicatesOnly, groupBy, lookup, nameOf, quote, quoteAll } from './util';

type Model = Readonly<RelationalModel>;

const relRef = (r: Relation): SemanticRef => ({ kind: 'relation', id: r.id });
const colRef = (r: Relation, c: RelColumn): SemanticRef => ({
  kind: 'column',
  relationId: r.id,
  id: c.id,
});
const fkRef = (fk: ForeignKey): SemanticRef => ({
  kind: 'foreignKey',
  id: fk.id,
});

/** Own-key relation lookup: a hand-edited `targetRelationId: "toString"` must not find Object.prototype members. */
const relOf = (m: Model, id: unknown): Relation | undefined => lookup(m.relations, id);

/** `schema.name` identity; tolerant of non-string names/schemas (hand-edited files). */
const relNameKey = (r: Relation): string => `${sqlNameKey(nameOf(r.schemaName))}.${sqlNameKey(nameOf(r.name))}`;

const INT_BASES = new Set(['INTEGER', 'SMALLINT', 'BIGINT']);
const NUM_BASES = new Set(['REAL', 'DOUBLE', 'NUMERIC']);

/** `dataTypesCompatible` hardened against non-string types; integer vs numeric is compatible (implicit widening). */
function typeCompat(a: unknown, b: unknown): ReturnType<typeof dataTypesCompatible> {
  const x = typeof a === 'string' ? a : undefined;
  const y = typeof b === 'string' ? b : undefined;
  const r = dataTypesCompatible(x, y);
  if (r !== 'mismatch') return r;
  const pa = parseDataType(x)?.base ?? '';
  const pb = parseDataType(y)?.base ?? '';
  const numeric = (t: string): boolean => INT_BASES.has(t) || NUM_BASES.has(t);
  return numeric(pa) && numeric(pb) ? 'compatible' : r;
}

const relations = (m: Model): Relation[] => Object.values(m.relations);
const foreignKeys = (m: Model): ForeignKey[] => Object.values(m.foreignKeys);
const colName = (r: Relation | undefined, id: Id): string => nameOf((r && relationColumn(r, id))?.name) || '?';

function rule(code: string, severity: Severity, description: string, check: RelRule['check']): RelRule {
  return { code, appliesTo: 'relational', severity, description, check };
}

// ---------------------------------------------------------------------------
// FK pair analysis (shared by several rules)
// ---------------------------------------------------------------------------

type Side = 'ok' | 'missing' | 'wrong-relation';

interface PairInfo {
  sourceColumnId: Id;
  targetColumnId: Id;
  source: Side;
  target: Side;
  sourceCol?: RelColumn;
  targetCol?: RelColumn;
}

function classify(m: Model, relation: Relation, columnId: Id): { side: Side; owner?: { relation: Relation; column: RelColumn } } {
  if (relationColumn(relation, columnId)) return { side: 'ok' };
  const elsewhere = findColumn(m, columnId);
  return elsewhere ? { side: 'wrong-relation', owner: elsewhere } : { side: 'missing' };
}

/** Pair-by-pair classification; undefined relations make the corresponding side 'missing' (reported elsewhere). */
function analyzePairs(m: Model, fk: ForeignKey): PairInfo[] {
  const source = relOf(m, fk.sourceRelationId);
  const target = relOf(m, fk.targetRelationId);
  return fk.columns.map((p) => {
    const s = source ? classify(m, source, p.sourceColumnId) : { side: 'missing' as Side };
    const t = target ? classify(m, target, p.targetColumnId) : { side: 'missing' as Side };
    return {
      sourceColumnId: p.sourceColumnId,
      targetColumnId: p.targetColumnId,
      source: s.side,
      target: t.side,
      sourceCol: source && s.side === 'ok' ? relationColumn(source, p.sourceColumnId) : undefined,
      targetCol: target && t.side === 'ok' ? relationColumn(target, p.targetColumnId) : undefined,
    };
  });
}

/** Source columns that exist in the source relation, in pair order. */
const sourceColumnsOf = (m: Model, fk: ForeignKey): RelColumn[] => analyzePairs(m, fk).flatMap((p) => (p.sourceCol ? [p.sourceCol] : []));

const allSourceColumnsPresent = (m: Model, fk: ForeignKey): boolean =>
  fk.columns.length > 0 && analyzePairs(m, fk).every((p) => p.source === 'ok');

/** Param value the translator replaces with the localised word (the English text keeps its own wording). */
const DELETED = '@i18n:issues.word.deleted';
const DELETED_COLUMN = '@i18n:issues.word.deletedColumn';

const fkLabel = (m: Model, fk: ForeignKey): string => {
  const s = nameOf(relOf(m, fk.sourceRelationId)?.name) || '?';
  const t = nameOf(relOf(m, fk.targetRelationId)?.name) || '?';
  const src = fk.columns.map((c) => colName(relOf(m, fk.sourceRelationId), c.sourceColumnId));
  const tgt = fk.columns.map((c) => colName(relOf(m, fk.targetRelationId), c.targetColumnId));
  const f = (n: string[]): string => (n.length === 1 ? n[0]! : `(${n.join(', ')})`);
  return `${s}.${f(src)} → ${t}.${f(tgt)}`;
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const relationNameEmpty = rule('rel.relation-name-empty', 'error', 'A relation has an empty name.', (m) =>
  relations(m)
    .filter((r) => !nameOf(r.name).trim())
    .map((r) => ({
      title: 'Relation has no name',
      explanation: 'A table cannot be created without a name.',
      suggestion: 'Give the relation a name.',
      affected: [relRef(r)],
    })),
);

const columnNameEmpty = rule('rel.column-name-empty', 'error', 'A column has an empty name.', (m) =>
  relations(m).flatMap((r) =>
    r.columns
      .filter((c) => !nameOf(c.name).trim())
      .map((c) => ({
        title: `Column in ${quote(nameOf(r.name))} has no name`,
        explanation: 'A column cannot be created without a name.',
        suggestion: 'Give the column a name.',
        affected: [colRef(r, c)],
        params: { relation: nameOf(r.name).trim() },
      })),
  ),
);

const relationNameDuplicate = rule(
  'rel.relation-name-duplicate',
  'error',
  'Two relations in the same schema have the same name (case-insensitive).',
  (m) =>
    duplicatesOnly(groupBy(relations(m), (r) => (sqlNameKey(nameOf(r.name)) ? relNameKey(r) : undefined))).map(([, unsorted]) => {
      const group = [...unsorted].sort(byNameThenId);
      return {
        title: `Duplicate relation name ${quote(nameOf(group[0]!.name))}`,
        explanation: `${group.length} relations share this name${nameOf(group[0]!.schemaName) ? ` in schema ${quote(nameOf(group[0]!.schemaName))}` : ''}; table names must be unique.`,
        suggestion: 'Rename one of the relations.',
        affected: group.map(relRef),
        params: {
          name: nameOf(group[0]!.name).trim(),
          count: group.length,
          ...(nameOf(group[0]!.schemaName) ? { variant: 'schema', schema: nameOf(group[0]!.schemaName) } : {}),
        },
      };
    }),
);

const columnNameDuplicate = rule(
  'rel.column-name-duplicate',
  'error',
  'Two columns of one relation have the same name (case-insensitive).',
  (m) =>
    relations(m).flatMap((r) =>
      duplicatesOnly(groupBy(r.columns, (c) => sqlNameKey(nameOf(c.name)) || undefined)).map(([, unsorted]) => {
        const group = [...unsorted].sort(byNameThenId);
        return {
          title: `Duplicate column ${quote(nameOf(group[0]!.name))} in ${quote(nameOf(r.name))}`,
          explanation: `${group.length} columns share this name; a table cannot have two columns with the same name.`,
          suggestion: 'Rename one of the columns.',
          affected: group.map((c) => colRef(r, c)),
          params: {
            relation: nameOf(r.name).trim(),
            name: nameOf(group[0]!.name).trim(),
            count: group.length,
          },
        };
      }),
    ),
);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** A UNIQUE constraint or non-partial unique index whose columns all exist and are NOT NULL (a usable candidate key). */
function hasNotNullCandidateKey(r: Relation): boolean {
  const keys = [
    ...arrayOf<{ columnIds: Id[] }>(r.uniques),
    ...arrayOf<{ columnIds: Id[]; unique?: boolean; where?: string }>(r.indexes).filter((i) => i.unique && !i.where),
  ];
  return keys.some((k) => {
    const ids = arrayOf<Id>(k.columnIds);
    return ids.length > 0 && ids.every((id) => relationColumn(r, id)?.nullable === false);
  });
}

const noPrimaryKey = rule('rel.no-primary-key', 'error', 'A relation has no primary key and no NOT NULL UNIQUE candidate key.', (m) =>
  relations(m)
    .filter((r) => r.primaryKey.length === 0 && !hasNotNullCandidateKey(r))
    .map((r) => ({
      title: `Relation ${quote(nameOf(r.name))} has no primary key`,
      explanation: 'Without a primary key rows cannot be uniquely identified and other relations cannot reference this one reliably.',
      suggestion: 'Mark one or more columns as the primary key.',
      affected: [relRef(r)],
      params: { relation: nameOf(r.name).trim() },
    })),
);

const noPrimaryKeyCandidate = rule(
  'rel.no-primary-key-candidate',
  'info',
  'A relation has no primary key but has a NOT NULL UNIQUE candidate key.',
  (m) =>
    relations(m)
      .filter((r) => r.primaryKey.length === 0 && hasNotNullCandidateKey(r))
      .map((r) => ({
        title: `Relation ${quote(nameOf(r.name))} has no primary key (but a candidate key)`,
        explanation:
          'Rows are uniquely identified by a NOT NULL UNIQUE key, which is valid SQL; most designs still declare one candidate key as the PRIMARY KEY.',
        suggestion: 'Promote the UNIQUE key to PRIMARY KEY.',
        affected: [relRef(r)],
        params: { relation: nameOf(r.name).trim() },
      })),
);

/** Describe ids that are not columns of `r`: a foreign column is named, a vanished one is counted. */
function describeStrayColumns(m: Model, r: Relation, ids: Id[]): string {
  const parts = ids.map((id) => {
    const found = findColumn(m, id);
    return found ? `${quote(nameOf(found.relation.name))}.${quote(nameOf(found.column.name))}` : 'a deleted column';
  });
  return `${parts.join(', ')} ${ids.length === 1 ? 'is' : 'are'} not ${ids.length === 1 ? 'a column' : 'columns'} of ${quote(nameOf(r.name))}`;
}

/** Params for the translated "these are not columns of R" sentence: found foreign columns quoted, vanished ones counted. */
function strayParams(m: Model, ids: Id[]): { strays: string; deleted: number; explanationVariant: string } {
  const found = ids.flatMap((id) => {
    const f = findColumn(m, id);
    return f ? [`${quote(nameOf(f.relation.name))}.${quote(nameOf(f.column.name))}`] : [];
  });
  const deleted = ids.length - found.length;
  const kind = deleted === 0 ? 'found' : found.length === 0 ? 'deleted' : 'both';
  return { strays: found.join(', '), deleted, explanationVariant: `${kind}.${ids.length === 1 ? 'one' : 'other'}` };
}

const keyColumnMissing = rule(
  'rel.key-column-missing',
  'error',
  'A primary key, UNIQUE constraint or index lists a column that does not belong to the relation.',
  (m) =>
    relations(m).flatMap((r) => {
      const own = new Set(r.columns.map((c) => c.id));
      const stray = (ids: readonly Id[]): Id[] => ids.filter((id) => !own.has(id));
      const out: IssueDraft[] = [];
      const pk = stray(r.primaryKey);
      if (pk.length > 0) {
        out.push({
          title: `Primary key of ${quote(nameOf(r.name))} uses unknown columns`,
          explanation: `${describeStrayColumns(m, r, pk)}.`,
          suggestion: 'Remove the stray columns from the primary key and choose columns of this relation.',
          affected: [relRef(r)],
          params: { relation: nameOf(r.name).trim(), kind: 'primary key', variant: 'primary', ...strayParams(m, pk) },
        });
      }
      for (const u of r.uniques) {
        const bad = stray(u.columnIds);
        if (bad.length === 0) continue;
        out.push({
          title: `UNIQUE constraint of ${quote(nameOf(r.name))} uses unknown columns`,
          explanation: `${describeStrayColumns(m, r, bad)}.`,
          suggestion: 'Edit the constraint so that it only lists columns of this relation, or delete it.',
          affected: [{ kind: 'unique', relationId: r.id, id: u.id }, relRef(r)],
          params: { relation: nameOf(r.name).trim(), kind: 'unique', variant: 'unique', ...strayParams(m, bad) },
        });
      }
      for (const i of r.indexes) {
        const bad = stray(i.columnIds);
        if (bad.length === 0) continue;
        out.push({
          title: `Index ${quote(nameOf(i.name))} of ${quote(nameOf(r.name))} uses unknown columns`,
          explanation: `${describeStrayColumns(m, r, bad)}.`,
          suggestion: 'Edit the index so that it only lists columns of this relation, or delete it.',
          affected: [{ kind: 'index', relationId: r.id, id: i.id }, relRef(r)],
          params: { relation: nameOf(r.name).trim(), kind: 'index', variant: 'index', index: nameOf(i.name), ...strayParams(m, bad) },
        });
      }
      return out;
    }),
);

const pkNullable = rule('rel.pk-nullable', 'error', 'A primary-key column is nullable.', (m) =>
  relations(m).flatMap((r) => {
    const bad = r.primaryKey.map((id) => relationColumn(r, id)).filter((c): c is RelColumn => !!c && c.nullable);
    if (bad.length === 0) return [];
    return [
      {
        title: `Nullable primary-key column in ${quote(nameOf(r.name))}`,
        explanation: `${quoteAll(bad.map((c) => nameOf(c.name)))} ${bad.length === 1 ? 'is' : 'are'} part of the primary key but allow NULL; primary-key columns must be NOT NULL.`,
        suggestion: 'Mark the column(s) NOT NULL.',
        affected: bad.map((c) => colRef(r, c)),
        params: {
          relation: nameOf(r.name).trim(),
          columns: bad.map((c) => nameOf(c.name)).join(', '),
          columnsQuoted: quoteAll(bad.map((c) => nameOf(c.name))),
          count: bad.length,
        },
      },
    ];
  }),
);

// ---------------------------------------------------------------------------
// Foreign keys: structure
// ---------------------------------------------------------------------------

const fkRelationMissing = rule('rel.fk-relation-missing', 'error', 'A foreign key references a relation that does not exist.', (m) =>
  foreignKeys(m)
    .filter((fk) => !relOf(m, fk.sourceRelationId) || !relOf(m, fk.targetRelationId))
    .map((fk) => ({
      title: 'Foreign key points at a missing relation',
      explanation: `The ${relOf(m, fk.sourceRelationId) ? 'referenced (target)' : 'referencing (source)'} relation of this foreign key no longer exists.`,
      suggestion: 'Delete the foreign key or reconnect it to existing relations.',
      affected: [fkRef(fk), ...[fk.sourceRelationId, fk.targetRelationId].flatMap((id) => (relOf(m, id) ? [relRef(relOf(m, id)!)] : []))],
      params: { variant: relOf(m, fk.sourceRelationId) ? 'target' : 'source' },
    })),
);

/** The FK's two relations (when they exist): the always-drawn highlight targets of every FK-structure issue. */
const endpointRefs = (m: Model, fk: ForeignKey): SemanticRef[] =>
  [fk.sourceRelationId, fk.targetRelationId].flatMap((id) => {
    const r = relOf(m, id);
    return r ? [relRef(r)] : [];
  });

const fkNoColumns = rule('rel.fk-no-columns', 'error', 'A foreign key has no column pairs.', (m) =>
  foreignKeys(m)
    .filter((fk) => fk.columns.length === 0)
    .map((fk) => ({
      title: `Foreign key ${quote(fkLabel(m, fk))} has no columns`,
      explanation: 'A foreign key must pair at least one referencing column with one referenced column.',
      suggestion: 'Add the column pair(s) or delete the foreign key.',
      affected: [fkRef(fk), ...endpointRefs(m, fk)],
      params: { foreignKey: fkLabel(m, fk) },
    })),
);

const survivingPairColumns = (m: Model, fk: ForeignKey): SemanticRef[] => {
  const source = relOf(m, fk.sourceRelationId);
  const target = relOf(m, fk.targetRelationId);
  return analyzePairs(m, fk).flatMap((p) => [
    ...(source && p.sourceCol ? [colRef(source, p.sourceCol)] : []),
    ...(target && p.targetCol ? [colRef(target, p.targetCol)] : []),
  ]);
};

function pairIssue(
  m: Model,
  fk: ForeignKey,
  bad: Array<{ info: PairInfo; side: 'source' | 'target' }>,
  what: string,
  suggestion: string,
): IssueDraft {
  const source = relOf(m, fk.sourceRelationId);
  const target = relOf(m, fk.targetRelationId);
  const side = (which: 'source' | 'target'): { columns: string; relation: string } => {
    const mine = bad.filter((b) => b.side === which);
    const texts = mine.map(({ info }) => {
      const id = which === 'source' ? info.sourceColumnId : info.targetColumnId;
      const found = findColumn(m, id);
      return found ? `${quote(nameOf(found.relation.name))}.${quote(nameOf(found.column.name))}` : DELETED;
    });
    return { columns: texts.join(', '), relation: nameOf((which === 'source' ? source : target)?.name).trim() };
  };
  const hasSource = bad.some((b) => b.side === 'source');
  const hasTarget = bad.some((b) => b.side === 'target');
  const lines = bad.map(({ info, side }) => {
    const rel = side === 'source' ? source : target;
    const id = side === 'source' ? info.sourceColumnId : info.targetColumnId;
    const found = findColumn(m, id);
    return `${side} column ${found ? `${quote(nameOf(found.relation.name))}.${quote(nameOf(found.column.name))}` : '(deleted)'} of ${quote(nameOf(rel?.name))}`;
  });
  const columnRefs = bad.flatMap(({ info, side }) => {
    const id = side === 'source' ? info.sourceColumnId : info.targetColumnId;
    const found = findColumn(m, id);
    return found ? [colRef(found.relation, found.column)] : [];
  });
  return {
    title: `${what} in ${quote(fkLabel(m, fk))}`,
    explanation: `${lines.join('; ')}.`,
    suggestion,
    // The FK edge alone is not drawn when a column is gone, so always add both tables and every surviving pair column.
    affected: [fkRef(fk), ...endpointRefs(m, fk), ...columnRefs, ...survivingPairColumns(m, fk)],
    params: {
      foreignKey: fkLabel(m, fk),
      count: bad.length,
      variant: hasSource && hasTarget ? 'both' : hasSource ? 'source' : 'target',
      lines: lines.join('; '),
      sourceColumns: side('source').columns,
      sourceRelation: side('source').relation,
      targetColumns: side('target').columns,
      targetRelation: side('target').relation,
    },
  };
}

const badSides = (m: Model, fk: ForeignKey, wanted: Side): Array<{ info: PairInfo; side: 'source' | 'target' }> => {
  const out: Array<{ info: PairInfo; side: 'source' | 'target' }> = [];
  for (const info of analyzePairs(m, fk)) {
    // A missing relation is reported by rel.fk-relation-missing; do not blame its columns.
    if (info.source === wanted && relOf(m, fk.sourceRelationId)) out.push({ info, side: 'source' });
    if (info.target === wanted && relOf(m, fk.targetRelationId)) out.push({ info, side: 'target' });
  }
  return out;
};

const fkColumnMissing = rule('rel.fk-column-missing', 'error', 'A foreign key pair references a column that no longer exists.', (m) =>
  foreignKeys(m).flatMap((fk) => {
    const bad = badSides(m, fk, 'missing');
    return bad.length === 0
      ? []
      : [
          pairIssue(
            m,
            fk,
            bad,
            'Foreign key references a missing column',
            'Re-select the column for each affected pair, or remove the pair.',
          ),
        ];
  }),
);

const fkColumnWrongRelation = rule(
  'rel.fk-column-wrong-relation',
  'error',
  'A foreign key pair uses a column that belongs to a different relation than the one it should come from.',
  (m) =>
    foreignKeys(m).flatMap((fk) => {
      const bad = badSides(m, fk, 'wrong-relation');
      return bad.length === 0
        ? []
        : [
            pairIssue(
              m,
              fk,
              bad,
              'Foreign key column is in the wrong relation',
              'Referencing columns must belong to the referencing relation and referenced columns to the referenced relation. Re-select them.',
            ),
          ];
    }),
);

function describeKeys(r: Relation): string {
  const keys: Array<{ label: string; ids: Id[] }> = [];
  if (r.primaryKey.length > 0) keys.push({ label: 'primary key', ids: r.primaryKey });
  for (const u of r.uniques) keys.push({ label: 'UNIQUE', ids: u.columnIds });
  for (const i of r.indexes) if (i.unique && !i.where) keys.push({ label: 'unique index', ids: i.columnIds });
  return keys.map((k) => `${k.label} (${k.ids.map((id) => colName(r, id)).join(', ')})`).join(' or ');
}

const fkTargetNotKey = rule(
  'rel.fk-target-not-key',
  'error',
  'A foreign key references columns that are neither the primary key nor a UNIQUE key of the target (e.g. an incomplete composite key).',
  (m) =>
    foreignKeys(m).flatMap((fk) => {
      const target = relOf(m, fk.targetRelationId);
      if (!target || fk.columns.length === 0) return [];
      const pairs = analyzePairs(m, fk);
      if (pairs.some((p) => p.target !== 'ok')) return []; // missing / wrong-relation columns are reported separately
      if (fkReferencesKey(target, fk)) return [];
      const refIds = fk.columns.map((c) => c.targetColumnId);
      const names = refIds.map((id) => colName(target, id));
      const repeated = [...new Set(refIds.filter((id, i) => refIds.indexOf(id) !== i))];
      // Headline case: the references are a strict part of a key => name the columns that are missing.
      const keys: Id[][] = [
        target.primaryKey,
        ...target.uniques.map((u) => u.columnIds),
        ...target.indexes.filter((i) => i.unique && !i.where).map((i) => i.columnIds),
      ].filter((k) => k.length > 0);
      const covering = keys.find((k) => refIds.every((id) => k.includes(id)));
      let explanation: string;
      let variant: string;
      const missing = covering ? covering.filter((id) => !refIds.includes(id)).map((id) => colName(target, id)) : [];
      if (repeated.length > 0) {
        variant = 'repeated';
        explanation = `The referenced column(s) ${quoteAll(repeated.map((id) => colName(target, id)))} of ${quote(nameOf(target.name))} appear more than once in this foreign key, so the pairs do not form the key of ${quote(nameOf(target.name))}; its keys are ${describeKeys(target)}.`;
      } else if (covering && missing.length > 0) {
        variant = 'partial';
        explanation = `It references ${quoteAll(names)} of ${quote(nameOf(target.name))}, but that is only part of the key (${covering.map((id) => colName(target, id)).join(', ')}). The missing key column(s): ${missing.join(', ')}.`;
      } else if (keys.length === 0) {
        variant = 'nokeys';
        explanation = `${quote(nameOf(target.name))} has no primary key or UNIQUE constraint, so the referenced columns ${quoteAll(names)} identify nothing.`;
      } else {
        variant = 'generic';
        explanation = `The referenced columns ${quoteAll(names)} are not a key of ${quote(nameOf(target.name))}; its keys are ${describeKeys(target)}.`;
      }
      return [
        {
          title: `Foreign key ${quote(fkLabel(m, fk))} does not reference a key`,
          explanation,
          suggestion:
            'Reference the complete key (add the missing columns to the foreign key), or add a UNIQUE constraint on the referenced columns.',
          affected: [fkRef(fk), ...endpointRefs(m, fk), ...pairs.flatMap((p) => (p.targetCol ? [colRef(target, p.targetCol)] : []))],
          params: {
            foreignKey: fkLabel(m, fk),
            target: nameOf(target.name).trim(),
            variant,
            columns: quoteAll(names),
            repeated: quoteAll(repeated.map((id) => colName(target, id))),
            covering: covering ? covering.map((id) => colName(target, id)).join(', ') : '',
            missing: missing.join(', '),
            keys: describeKeys(target),
            keyColumns: keys.map((k) => `(${k.map((id) => colName(target, id)).join(', ')})`).join(' / '),
          },
        },
      ];
    }),
);

const fkTypeMismatch = rule(
  'rel.fk-type-mismatch',
  'warning',
  'A foreign key pair joins columns of clearly incompatible data types.',
  (m) =>
    foreignKeys(m).flatMap((fk) => {
      const source = relOf(m, fk.sourceRelationId);
      const target = relOf(m, fk.targetRelationId);
      if (!source || !target) return [];
      const bad = analyzePairs(m, fk).filter(
        (p) => p.sourceCol && p.targetCol && typeCompat(p.sourceCol.dataType, p.targetCol.dataType) === 'mismatch',
      );
      if (bad.length === 0) return [];
      const text = bad
        .map(
          (p) =>
            `${quote(nameOf(source.name))}.${quote(nameOf(p.sourceCol!.name))} is ${p.sourceCol!.dataType} but ${quote(nameOf(target.name))}.${quote(nameOf(p.targetCol!.name))} is ${p.targetCol!.dataType}`,
        )
        .join('; ');
      return [
        {
          title: `Type mismatch in ${quote(fkLabel(m, fk))}`,
          explanation: `${text}. Values of such types are not comparable, so the constraint would be rejected or silently cast.`,
          suggestion: 'Give the referencing column the same type as the referenced column.',
          affected: [fkRef(fk), ...bad.flatMap((p) => [colRef(source, p.sourceCol!), colRef(target, p.targetCol!)])],
          params: {
            foreignKey: fkLabel(m, fk),
            count: bad.length,
            variant: bad.length === 1 ? 'single' : 'multiple',
            sourceColumn: `${quote(nameOf(source.name))}.${quote(nameOf(bad[0]!.sourceCol!.name))}`,
            sourceType: String(bad[0]!.sourceCol!.dataType ?? ''),
            targetColumn: `${quote(nameOf(target.name))}.${quote(nameOf(bad[0]!.targetCol!.name))}`,
            targetType: String(bad[0]!.targetCol!.dataType ?? ''),
            pairs: bad
              .map(
                (p) =>
                  `${quote(nameOf(source.name))}.${quote(nameOf(p.sourceCol!.name))} (${p.sourceCol!.dataType}) / ${quote(nameOf(target.name))}.${quote(nameOf(p.targetCol!.name))} (${p.targetCol!.dataType})`,
              )
              .join('; '),
          },
        },
      ];
    }),
);

// ---------------------------------------------------------------------------
// Foreign keys: nullability & participation
// ---------------------------------------------------------------------------

/** Does the FK's conversion Origin name a TOTAL holder-side participant? (HISTORICAL data: may dangle.) */
const FK_ON_ENTITY_RULES = new Set(['one-to-many-fk', 'one-to-one-fk', 'recursive-one-to-many-fk']);
const RELATIONSHIP_RELATION_RULES = new Set([
  'many-to-many-relation',
  'n-ary-relation',
  'recursive-many-to-many-relation',
  'one-to-one-relation',
]);

/**
 * Only FK-on-entity translations list the HOLDER-side participant first (types.ts Origin.sources); for the FK columns
 * of a relationship relation the first participant is the REFERENCED one and says nothing about the FK column.
 */
function originMarksTotal(project: Readonly<Project>, fk: ForeignKey): boolean {
  if (!FK_ON_ENTITY_RULES.has(fk.origin?.ruleId as string)) return false;
  const holder = arrayOf<SemanticRef>(fk.origin?.sources).find((s) => s.kind === 'participant');
  if (!holder || holder.kind !== 'participant') return false;
  for (const model of Object.values(project.models)) {
    if (model.kind !== 'er') continue;
    const p = lookup(model.relationships, holder.relationshipId)?.participants.find((x) => x.id === holder.id);
    if (p) return p.participation === 'total';
  }
  return false;
}

const fkTotalButNullable = rule(
  'rel.fk-total-but-nullable',
  'warning',
  'A foreign key is meant to be mandatory (stated parentMin=1 or a total ER participant) but a column allows NULL.',
  (m, ctx) =>
    foreignKeys(m).flatMap((fk) => {
      const source = relOf(m, fk.sourceRelationId);
      if (!source) return [];
      const nullable = sourceColumnsOf(m, fk).filter((c) => c.nullable);
      if (nullable.length === 0) return [];
      const card = fkCardinality(m, fk);
      const stated = card.stated.includes('parentMin') && card.parentMin === 1;
      const viaOrigin = !stated && fk.cardinality?.parentMin === undefined && originMarksTotal(ctx.project, fk);
      const viaRelationship = !stated && !viaOrigin && RELATIONSHIP_RELATION_RULES.has(fk.origin?.ruleId as string);
      if (!stated && !viaOrigin && !viaRelationship) return [];
      return [
        {
          title: `Mandatory foreign key ${quote(fkLabel(m, fk))} allows NULL`,
          explanation: `${stated ? 'The foreign key is declared mandatory' : viaRelationship ? 'This foreign key column belongs to a relationship relation, where every row records one partner from each participant' : 'The ER participation behind this foreign key is total'}, but ${quoteAll(nullable.map((c) => nameOf(c.name)))} ${nullable.length === 1 ? 'is' : 'are'} nullable, so rows may exist without a parent.`,
          suggestion: viaRelationship
            ? 'Mark the foreign-key column(s) NOT NULL.'
            : 'Mark the foreign-key column(s) NOT NULL, or relax the participation to partial.',
          affected: [fkRef(fk), ...nullable.map((c) => colRef(source, c))],
          params: {
            foreignKey: fkLabel(m, fk),
            source: stated ? 'stated' : viaRelationship ? 'relationship' : 'origin',
            variant: `${stated ? 'stated' : viaRelationship ? 'relationship' : 'origin'}.${nullable.length === 1 ? 'one' : 'other'}`,
            columns: quoteAll(nullable.map((c) => nameOf(c.name))),
          },
        },
      ];
    }),
);

const fkSetNullNotNull = rule(
  'rel.fk-set-null-not-null',
  'error',
  "A foreign key uses 'SET NULL' but one of its columns is NOT NULL.",
  (m) =>
    foreignKeys(m).flatMap((fk) => {
      const source = relOf(m, fk.sourceRelationId);
      if (!source) return [];
      const actions = [fk.onDelete === 'SET NULL' ? 'ON DELETE' : '', fk.onUpdate === 'SET NULL' ? 'ON UPDATE' : ''].filter(Boolean);
      if (actions.length === 0) return [];
      const notNull = sourceColumnsOf(m, fk).filter((c) => !c.nullable);
      if (notNull.length === 0) return [];
      // Making a primary-key column nullable would only trade this error for rel.pk-nullable.
      const inPk = notNull.some((c) => source.primaryKey.includes(c.id));
      return [
        {
          title: `${actions.join(' / ')} SET NULL on NOT NULL column`,
          explanation: `${quote(fkLabel(m, fk))} would have to write NULL into ${quoteAll(notNull.map((c) => nameOf(c.name)))}, which is NOT NULL; the database rejects the deletion or the table definition.`,
          suggestion: inPk
            ? 'Choose another referential action (CASCADE, RESTRICT or NO ACTION); primary-key columns cannot be made nullable.'
            : 'Choose another referential action (RESTRICT, CASCADE) or make the column(s) nullable.',
          affected: [fkRef(fk), ...notNull.map((c) => colRef(source, c))],
          params: {
            foreignKey: fkLabel(m, fk),
            actions: actions.join(', '),
            actionsTitle: actions.join(' / '),
            columns: quoteAll(notNull.map((c) => nameOf(c.name))),
            variant: inPk ? 'pk' : 'plain',
          },
        },
      ];
    }),
);

/** Edges between distinct relations connected by NOT NULL foreign keys (every FK column present and NOT NULL). */
function notNullEdges(m: Model): ForeignKey[] {
  return foreignKeys(m).filter(
    (fk) =>
      fk.sourceRelationId !== fk.targetRelationId &&
      !!relOf(m, fk.sourceRelationId) &&
      !!relOf(m, fk.targetRelationId) &&
      allSourceColumnsPresent(m, fk) &&
      sourceColumnsOf(m, fk).every((c) => !c.nullable),
  );
}

/** Strongly connected components (size > 1) of a graph; iterative Tarjan (no recursion: chains of 10^4+ relations). */
function cyclicComponents(nodes: Id[], edges: Array<[Id, Id]>): Id[][] {
  const adj = new Map<Id, Id[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of edges) adj.get(a)?.push(b);
  let counter = 0;
  const index = new Map<Id, number>();
  const low = new Map<Id, number>();
  const stack: Id[] = [];
  const onStack = new Set<Id>();
  const out: Id[][] = [];
  for (const root of nodes) {
    if (index.has(root)) continue;
    const work: Array<{ v: Id; next: number }> = [{ v: root, next: 0 }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const succ = adj.get(frame.v) ?? [];
      if (frame.next < succ.length) {
        const w = succ[frame.next++]!;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter++);
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, next: 0 });
        } else if (onStack.has(w)) low.set(frame.v, Math.min(low.get(frame.v)!, index.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.v, Math.min(low.get(parent.v)!, low.get(frame.v)!));
      if (low.get(frame.v) === index.get(frame.v)) {
        const comp: Id[] = [];
        let w: Id;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== frame.v);
        if (comp.length > 1) out.push(comp);
      }
    }
  }
  return out;
}

const fkNotNullCycle = rule(
  'rel.fk-not-null-cycle',
  'warning',
  'Relations reference each other through NOT NULL foreign keys in a cycle, so no first row can be inserted.',
  (m) => {
    const edges = notNullEdges(m);
    const nodes = [...new Set(edges.flatMap((fk) => [fk.sourceRelationId, fk.targetRelationId]))].sort();
    const comps = cyclicComponents(
      nodes,
      edges.map((fk) => [fk.sourceRelationId, fk.targetRelationId]),
    );
    return comps.map((comp) => {
      const rels = comp.map((id) => relOf(m, id)!).sort(byNameThenId);
      const members = new Set(comp);
      const inCycle = edges.filter((fk) => members.has(fk.sourceRelationId) && members.has(fk.targetRelationId));
      return {
        title: `Circular NOT NULL references: ${rels.map((r) => nameOf(r.name)).join(' ↔ ')}`,
        explanation: `${quoteAll(rels.map((r) => nameOf(r.name)))} each require a parent row in another table of the group through NOT NULL foreign keys. Whichever row is inserted first has no parent yet, unless constraints are deferred.`,
        suggestion:
          'Make at least one foreign key in the cycle nullable (or use deferred constraints) so that a first row can be inserted.',
        affected: [...rels.map(relRef), ...inCycle.sort((a, b) => (a.id < b.id ? -1 : 1)).map(fkRef)],
        params: {
          relations: rels.map((r) => nameOf(r.name)).join(', '),
          relationsArrow: rels.map((r) => nameOf(r.name)).join(' ↔ '),
          relationsQuoted: quoteAll(rels.map((r) => nameOf(r.name))),
        },
      };
    });
  },
);

const selfReferenceNotNull = rule(
  'rel.self-reference-not-null',
  'info',
  'A self-referencing foreign key is NOT NULL, so the first row cannot be inserted.',
  (m) =>
    foreignKeys(m)
      .filter((fk) => fk.sourceRelationId === fk.targetRelationId && relOf(m, fk.sourceRelationId))
      .filter((fk) => allSourceColumnsPresent(m, fk) && sourceColumnsOf(m, fk).every((c) => !c.nullable))
      .filter((fk) => fk.cardinality?.parentMin !== 0) // the author stated the parent as optional: nothing to hint
      .map((fk) => ({
        title: `Self-reference ${quote(fkLabel(m, fk))} cannot be NOT NULL for the root row`,
        explanation:
          'Every row must reference another row of the same table, so the first (root) row can never be inserted unless the root points at itself.',
        suggestion: 'Make the foreign-key column nullable (NULL = no parent, e.g. the top manager).',
        affected: [fkRef(fk), ...sourceColumnsOf(m, fk).map((c) => colRef(relOf(m, fk.sourceRelationId)!, c))],
        params: { foreignKey: fkLabel(m, fk) },
      })),
);

const fkDuplicate = rule('rel.fk-duplicate', 'info', 'Two foreign keys are identical.', (m) => {
  const sig = (fk: ForeignKey): string =>
    `${fk.sourceRelationId}>${fk.targetRelationId}:${fk.columns
      .map((c) => `${c.sourceColumnId}=${c.targetColumnId}`)
      .sort()
      .join(',')}`;
  const live = foreignKeys(m).filter((fk) => fk.columns.length > 0);
  return duplicatesOnly(groupBy(live, sig)).map(([, unsorted]) => {
    const group = [...unsorted].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      title: `Duplicate foreign key ${quote(fkLabel(m, group[0]!))}`,
      explanation: `${group.length} foreign keys define the same constraint; the database enforces it once per copy, which only costs performance.`,
      suggestion: 'Delete the redundant foreign key.',
      affected: group.map(fkRef),
      params: { foreignKey: fkLabel(m, group[0]!), count: group.length },
    };
  });
});

export const REL_RULES: RelRule[] = [
  relationNameEmpty,
  columnNameEmpty,
  relationNameDuplicate,
  columnNameDuplicate,
  noPrimaryKey,
  noPrimaryKeyCandidate,
  keyColumnMissing,
  pkNullable,
  fkRelationMissing,
  fkNoColumns,
  fkColumnMissing,
  fkColumnWrongRelation,
  fkTargetNotKey,
  fkTypeMismatch,
  fkTotalButNullable,
  fkSetNullNotNull,
  fkNotNullCycle,
  selfReferenceNotNull,
  fkDuplicate,
];
