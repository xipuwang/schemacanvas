/**
 * Mutable working state of ONE conversion run (never escapes `convertErToRelational`). It owns every id the run
 * creates, so id reuse (`env.previous`), naming collisions, trace/decision/warning bookkeeping and the creation of
 * relations / columns / uniques / foreign keys all go through here — the rule modules only say WHAT to create.
 */
import { nowIso } from '@/model/clock';
import { newId } from '@/model/ids';
import { makeIssue } from '@/model/issues';
import { refKey, sqlNameKey } from '@/model/queries';
import { attributesOf } from '@/model/queries';
import type { ConversionRuleId } from '@/model/conversionRules';
import type {
  ConversionDecision,
  ConversionOptions,
  ConversionTraceEntry,
  ErEntity,
  ErModel,
  ErParticipant,
  ErRelationship,
  ForeignKey,
  ForeignKeyColumnPair,
  FkCardinality,
  Id,
  Issue,
  RelColumn,
  Relation,
  RelationalModel,
  SemanticRef,
} from '@/model/types';
import type { ConvWarningCode, DecisionKind } from './codes';
import { pascal } from './names';
import type { MergePlan } from './merge';

/** A relation under construction plus the bookkeeping naming needs. */
export interface RelState {
  relation: Relation;
  /** `sqlNameKey` of every column name taken so far. */
  names: Set<string>;
  /** Columns that are source columns of an FK of this relation ("propagated" for the naming rule). */
  fkColumnIds: Set<Id>;
  /** Column id -> name used as `attrName` when this column is propagated with a literal prefix. */
  attrNames: Map<Id, string>;
}

/** A column another relation can reference (read from a finished key). */
export interface KeyCol {
  id: Id;
  name: string;
  attrName: string;
  dataType?: string;
  propagated: boolean;
  originKey: string;
}

/** What other translations need to know about the relation an entity ended up in. */
export interface EntityInfo {
  entity: ErEntity;
  st: RelState;
  /** The columns FKs to this entity reference (PK order; a merged non-primary member's UNIQUE key; [] = keyless). */
  keyColumnIds: Id[];
  /** Non-primary member of a 1:1 merge whose primary side is partial: its columns may be absent in a row, so every column added for it must be nullable. */
  optionalPartner?: boolean;
}

export interface ColumnInit {
  key: string;
  name: string;
  /** Tried in order when `name` is taken, before numeric suffixing. */
  alts?: string[];
  ruleId: ConversionRuleId;
  sources: SemanticRef[];
  dataType?: string;
  nullable: boolean;
  description?: string;
  note?: string;
  attrName?: string;
  isFk?: boolean;
}

export interface DecisionInit {
  ruleId: ConversionRuleId;
  /** Unique within (ruleId); makes the decision id deterministic. */
  tag: string;
  title: string;
  explanation: string;
  sources: SemanticRef[];
  targets?: SemanticRef[];
  level?: 'info' | 'warning';
  /** Values behind the English text; `kind` picks the catalogue entry (see `ConversionDecision.params`). */
  params?: Record<string, string | number> & { kind?: DecisionKind };
}

export interface WarnInit {
  code: ConvWarningCode;
  severity: Issue['severity'];
  title: string;
  explanation: string;
  suggestion: string;
  affected: SemanticRef[];
  params?: Record<string, string | number>;
}

export interface OwnerFkRecord {
  relationshipId: Id;
  weakParticipant: ErParticipant;
  ownerParticipant: ErParticipant;
  fk?: ForeignKey;
}

export const eRef = {
  entity: (id: Id): SemanticRef => ({ kind: 'entity', id }),
  attribute: (id: Id): SemanticRef => ({ kind: 'attribute', id }),
  relationship: (id: Id): SemanticRef => ({ kind: 'relationship', id }),
  participant: (relationshipId: Id, id: Id): SemanticRef => ({ kind: 'participant', relationshipId, id }),
};

export const relRef = (st: RelState): SemanticRef => ({ kind: 'relation', id: st.relation.id });
export const colRef = (st: RelState, col: RelColumn): SemanticRef => ({ kind: 'column', relationId: st.relation.id, id: col.id });
export const fkRef = (fk: ForeignKey): SemanticRef => ({ kind: 'foreignKey', id: fk.id });

export interface RelationInit {
  ruleId: ConversionRuleId;
  sources: SemanticRef[];
  key: string;
  note?: string;
}

export class Ctx {
  readonly er: ErModel;
  readonly options: ConversionOptions;
  readonly now: string;
  readonly relations: Record<Id, Relation> = {};
  readonly foreignKeys: Record<Id, ForeignKey> = {};
  readonly decisions: ConversionDecision[] = [];
  readonly warnings: Issue[] = [];
  readonly infos = new Map<Id, EntityInfo>();
  readonly inProgress = new Set<Id>();
  /** Identifying relationship id -> owner FK records, filled while weak entities are built, read when relationships are translated. */
  readonly ownerRecords = new Map<Id, OwnerFkRecord[]>();
  merge: MergePlan = { groups: [], groupOf: new Map(), plans: new Map() };
  /** Entities that sit in a weak-ownership cycle -> group index. */
  readonly cycleOf = new Map<Id, number>();
  /** Relationships already translated as part of an associative entity's relation. */
  readonly consumed = new Set<Id>();
  readonly mvQueue: Array<() => void> = [];

  private readonly previousIds = new Map<string, Id>();
  private readonly usedIds = new Set<Id>();
  private readonly traces = new Map<string, { source: SemanticRef; targets: Map<string, SemanticRef>; ruleId: string }>();
  private readonly decisionIds = new Set<string>();
  private readonly relationNames = new Set<string>();

  constructor(er: ErModel, options: ConversionOptions, now: string | undefined, previous?: RelationalModel) {
    this.er = er;
    this.options = options;
    this.now = now ?? nowIso();
    if (previous) this.indexPrevious(previous);
  }

  // ----- ids -------------------------------------------------------------------------------------------------

  private indexPrevious(previous: RelationalModel): void {
    const add = (prefix: string, key: string | undefined, id: Id): void => {
      if (key !== undefined) this.previousIds.set(`${prefix}|${key}`, id);
    };
    for (const rel of Object.values(previous.relations)) {
      add('rln', rel.origin?.key, rel.id);
      for (const col of rel.columns) add('col', col.origin?.key, col.id);
      for (const uq of rel.uniques) add('uq', uq.origin?.key, uq.id);
    }
    for (const fk of Object.values(previous.foreignKeys)) add('fk', fk.origin?.key, fk.id);
  }

  /** Reuse the previous id of the element with this origin key (once), else mint a fresh one. */
  idFor(prefix: string, key: string): Id {
    const reuse = this.previousIds.get(`${prefix}|${key}`);
    if (reuse !== undefined && !this.usedIds.has(reuse)) {
      this.usedIds.add(reuse);
      return reuse;
    }
    const reserved = new Set(this.previousIds.values());
    let id = newId(prefix);
    while (this.usedIds.has(id) || reserved.has(id)) id = newId(prefix);
    this.usedIds.add(id);
    return id;
  }

  // ----- trace / decisions / warnings -------------------------------------------------------------------------

  trace(source: SemanticRef, targets: SemanticRef[], ruleId: ConversionRuleId): void {
    const k = `${refKey(source)}|${ruleId}`;
    let entry = this.traces.get(k);
    if (!entry) {
      entry = { source, targets: new Map(), ruleId };
      this.traces.set(k, entry);
    }
    for (const t of targets) entry.targets.set(refKey(t), t);
  }

  isTraced(source: SemanticRef): boolean {
    const prefix = `${refKey(source)}|`;
    for (const k of this.traces.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  traceEntries(): ConversionTraceEntry[] {
    return [...this.traces.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, e]) => ({ source: e.source, targets: [...e.targets.values()], ruleId: e.ruleId }));
  }

  decide(d: DecisionInit): void {
    let id = `${d.ruleId}|${d.tag}`;
    for (let n = 2; this.decisionIds.has(id); n++) id = `${d.ruleId}|${d.tag}#${n}`;
    this.decisionIds.add(id);
    this.decisions.push({
      id,
      ruleId: d.ruleId,
      title: d.title,
      explanation: d.explanation,
      sources: d.sources,
      targets: d.targets ?? [],
      level: d.level ?? 'info',
      ...(d.params ? { params: d.params } : {}),
    });
  }

  warn(w: WarnInit): void {
    const issue = makeIssue({ ...w, modelId: this.er.id, ...(w.params ? { params: w.params } : {}) });
    if (!this.warnings.some((x) => x.id === issue.id)) this.warnings.push(issue);
  }

  // ----- relations / columns / keys ----------------------------------------------------------------------------

  /** Deterministic collision handling shared by relation names (`_2`, `_3` via sqlNameKey). */
  private uniqueRelationName(desired: string): string {
    let name = desired;
    for (let n = 2; this.relationNames.has(sqlNameKey(name)); n++) name = `${desired}_${n}`;
    this.relationNames.add(sqlNameKey(name));
    return name;
  }

  newRelation(desiredName: string, init: RelationInit): RelState {
    const desired = desiredName.trim() || 'Relation';
    const name = this.uniqueRelationName(desired);
    const relation: Relation = {
      id: this.idFor('rln', init.key),
      name,
      columns: [],
      primaryKey: [],
      uniques: [],
      indexes: [],
      origin: { ruleId: init.ruleId, sources: init.sources, key: init.key, ...(init.note ? { note: init.note } : {}) },
    };
    this.relations[relation.id] = relation;
    const st: RelState = { relation, names: new Set(), fkColumnIds: new Set(), attrNames: new Map() };
    if (name !== desired) {
      this.decide({
        ruleId: init.ruleId,
        tag: `relation-renamed:${init.key}`,
        title: `Relation renamed to ${name}`,
        explanation: `The name "${desired}" was already used by another generated relation, so this one was named "${name}".`,
        sources: init.sources,
        targets: [relRef(st)],
        params: { kind: 'relation-renamed', name, desired },
      });
    }
    return st;
  }

  addColumn(st: RelState, init: ColumnInit): RelColumn {
    const override = this.options.columnNames?.[init.key]?.trim();
    const base = override || init.name.trim() || 'Column';
    const candidates = [base, ...(init.alts ?? []).map((a) => a.trim()).filter(Boolean)];
    let name = candidates.find((c) => !st.names.has(sqlNameKey(c)));
    if (name === undefined) {
      for (let n = 2; ; n++) {
        const c = `${base}_${n}`;
        if (!st.names.has(sqlNameKey(c))) {
          name = c;
          break;
        }
      }
    }
    st.names.add(sqlNameKey(name));
    const column: RelColumn = {
      id: this.idFor('col', init.key),
      name,
      nullable: init.nullable,
      origin: { ruleId: init.ruleId, sources: init.sources, key: init.key, ...(init.note ? { note: init.note } : {}) },
    };
    if (init.dataType) column.dataType = init.dataType;
    if (init.description) column.description = init.description;
    st.relation.columns.push(column);
    st.attrNames.set(column.id, init.attrName ?? name);
    if (init.isFk) st.fkColumnIds.add(column.id);
    if (name !== base) {
      this.decide({
        ruleId: init.ruleId,
        tag: `column-renamed:${init.key}`,
        title: `Column ${st.relation.name}.${name} renamed to avoid a collision`,
        explanation: `"${base}" was already a column of ${st.relation.name}; the column was named "${name}" instead. Rename it freely — ids, not names, hold the model together.`,
        sources: init.sources,
        targets: [colRef(st, column)],
        level: 'info',
        params: { kind: 'column-renamed', relation: st.relation.name, column: name, base },
      });
    }
    return column;
  }

  addUnique(st: RelState, init: { key: string; columnIds: Id[]; ruleId: ConversionRuleId; sources: SemanticRef[] }): void {
    st.relation.uniques.push({
      id: this.idFor('uq', init.key),
      columnIds: init.columnIds,
      origin: { ruleId: init.ruleId, sources: init.sources, key: init.key },
    });
  }

  addForeignKey(init: {
    key: string;
    source: RelState;
    target: RelState;
    pairs: ForeignKeyColumnPair[];
    ruleId: ConversionRuleId;
    sources: SemanticRef[];
    cardinality?: FkCardinality;
  }): ForeignKey {
    const fk: ForeignKey = {
      id: this.idFor('fk', init.key),
      sourceRelationId: init.source.relation.id,
      targetRelationId: init.target.relation.id,
      columns: init.pairs,
      origin: { ruleId: init.ruleId, sources: init.sources, key: init.key },
    };
    if (init.cardinality) fk.cardinality = init.cardinality;
    this.foreignKeys[fk.id] = fk;
    return fk;
  }

  /** Mark columns as the primary key (ordered); PK columns are always NOT NULL. */
  setPrimaryKey(st: RelState, columnIds: Id[]): void {
    st.relation.primaryKey = [...columnIds];
    for (const col of st.relation.columns) if (columnIds.includes(col.id)) col.nullable = false;
  }

  keyColsOf(st: RelState, ids: Id[]): KeyCol[] {
    const out: KeyCol[] = [];
    for (const id of ids) {
      const col = st.relation.columns.find((c) => c.id === id);
      if (!col) continue;
      out.push({
        id,
        name: col.name,
        attrName: st.attrNames.get(id) ?? col.name,
        ...(col.dataType ? { dataType: col.dataType } : {}),
        propagated: st.fkColumnIds.has(id),
        originKey: col.origin?.key ?? `column:${id}`,
      });
    }
    return out;
  }

  ownAttributes(kind: 'entity' | 'relationship', id: Id) {
    return attributesOf(this.er, { kind, id });
  }

  // ----- key propagation (the documented default naming rule) --------------------------------------------------

  private fkColumnName(p: ErParticipant, entity: ErEntity, k: KeyCol): { name: string; alts: string[] } {
    const who = p.role?.trim() || entity.name;
    const alt = (name: string): string[] => [`${name}_${pascal(who)}`];
    const prefix = this.options.columnPrefixes?.[p.id];
    if (prefix !== undefined) return { name: prefix + k.attrName, alts: alt(prefix + k.attrName) };
    if (k.propagated) return { name: k.name, alts: alt(k.name) };
    const name = pascal(who) + pascal(k.attrName);
    return { name, alts: alt(name) };
  }

  /**
   * Add FK columns to `holder` copying `target`'s key (names per the documented rule; data type only) and ONE
   * ForeignKey over them. `participant`/`entity` supply the role / entity name used for naming.
   */
  propagateKey(o: {
    holder: RelState;
    target: EntityInfo;
    participant: ErParticipant;
    entity: ErEntity;
    fkKey: string;
    ruleId: ConversionRuleId;
    sources: SemanticRef[];
    nullable: boolean;
  }): { columns: RelColumn[]; fk: ForeignKey } {
    const keys = this.keyColsOf(o.target.st, o.target.keyColumnIds);
    const columns: RelColumn[] = [];
    for (const k of keys) {
      const { name, alts } = this.fkColumnName(o.participant, o.entity, k);
      columns.push(
        this.addColumn(o.holder, {
          key: `${o.fkKey}:${k.originKey}`,
          name,
          alts,
          ruleId: o.ruleId,
          sources: o.sources,
          ...(this.options.carryDataTypes && k.dataType ? { dataType: k.dataType } : {}),
          nullable: o.nullable,
          isFk: true,
        }),
      );
    }
    const fk = this.addForeignKey({
      key: o.fkKey,
      source: o.holder,
      target: o.target.st,
      pairs: columns.map((c, i) => ({ sourceColumnId: c.id, targetColumnId: keys[i]!.id })),
      ruleId: o.ruleId,
      sources: o.sources,
    });
    return { columns, fk };
  }

  relationship(id: Id): ErRelationship | undefined {
    return this.er.relationships[id];
  }
}
