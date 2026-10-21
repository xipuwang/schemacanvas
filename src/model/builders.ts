/**
 * Fluent builders for constructing WHOLE models programmatically: test fixtures, the example
 * projects, importers. (Interactive editing goes through src/model/ops instead, which maintains
 * diagram invariants and works on immer drafts.)
 *
 *   const b = erBuilder('Pharmacy');
 *   const company = b.entity('Company').key('name').attr('address');
 *   const drug = b.entity('Drug', { weak: true }).partialKey('TradeName').attr('Formula');
 *   b.relate('Makes', company, drug, '1:N', { identifying: true, rightTotal: true });
 *   const er: ErModel = b.build();
 */
import { createErModel, createRelationalModel } from './defaults';
import { newId } from './ids';
import type {
  ErAttribute,
  ErAttributeOwner,
  ErEntity,
  ErModel,
  ErParticipant,
  ErRelationship,
  ForeignKey,
  Id,
  ReferentialAction,
  RelColumn,
  Relation,
  RelationalModel,
  SqlDialect,
} from './types';

// ---------------------------------------------------------------------------
// ER
// ---------------------------------------------------------------------------

export interface AttrOptions {
  dataType?: string;
  optional?: boolean;
  multivalued?: boolean;
  derived?: boolean;
  derivedFrom?: Id[];
  description?: string;
}

export interface CompositeChildSpec extends AttrOptions {
  name: string;
}

class AttributeOwnerHandle {
  constructor(
    protected readonly model: ErModel,
    protected readonly owner: ErAttributeOwner,
  ) {}

  private nextOrder(owner: ErAttributeOwner): number {
    let max = -1;
    for (const a of Object.values(this.model.attributes)) {
      if (a.owner.kind === owner.kind && a.owner.id === owner.id) max = Math.max(max, a.order);
    }
    return max + 1;
  }

  /** Low-level: add an attribute and return it. */
  addAttribute(name: string, extra: Partial<ErAttribute> = {}, owner: ErAttributeOwner = this.owner): ErAttribute {
    const attribute: ErAttribute = {
      id: newId('att'),
      name,
      owner,
      order: this.nextOrder(owner),
      key: 'none',
      multivalued: false,
      derived: false,
      ...extra,
    };
    this.model.attributes[attribute.id] = attribute;
    return attribute;
  }

  /** Simple attribute. */
  attr(name: string, opts: AttrOptions = {}): this {
    this.addAttribute(name, { ...opts });
    return this;
  }

  /** Primary key attribute (call repeatedly for a composite key). */
  key(name: string, opts: AttrOptions = {}): this {
    this.addAttribute(name, { ...opts, key: 'primary' });
    return this;
  }

  /** Partial key (discriminator) of a weak entity. */
  partialKey(name: string, opts: AttrOptions = {}): this {
    this.addAttribute(name, { ...opts, key: 'partial' });
    return this;
  }

  multivalued(name: string, opts: AttrOptions = {}): this {
    this.addAttribute(name, { ...opts, multivalued: true });
    return this;
  }

  derived(name: string, opts: AttrOptions = {}): this {
    this.addAttribute(name, { ...opts, derived: true });
    return this;
  }

  /** Composite attribute with sub-attributes (children may themselves be composite via nested spec). */
  composite(
    name: string,
    children: Array<string | (CompositeChildSpec & { children?: Array<string | CompositeChildSpec> })>,
    opts: AttrOptions & { key?: 'primary' | 'partial' } = {},
  ): this {
    const { key, ...rest } = opts;
    const parent = this.addAttribute(name, { ...rest, ...(key ? { key } : {}) });
    const addChildren = (
      parentId: Id,
      specs: Array<string | (CompositeChildSpec & { children?: Array<string | CompositeChildSpec> })>,
    ): void => {
      for (const spec of specs) {
        const s = typeof spec === 'string' ? { name: spec } : spec;
        const { name: childName, children: grand, ...childOpts } = s as CompositeChildSpec & {
          children?: Array<string | CompositeChildSpec>;
        };
        const child = this.addAttribute(childName, childOpts, { kind: 'attribute', id: parentId });
        if (grand?.length) addChildren(child.id, grand);
      }
    };
    addChildren(parent.id, children);
    return this;
  }
}

export class EntityHandle extends AttributeOwnerHandle {
  constructor(model: ErModel, readonly entity: ErEntity) {
    super(model, { kind: 'entity', id: entity.id });
  }
  get id(): Id {
    return this.entity.id;
  }
}

export class RelationshipHandle extends AttributeOwnerHandle {
  constructor(model: ErModel, readonly relationship: ErRelationship) {
    super(model, { kind: 'relationship', id: relationship.id });
  }
  get id(): Id {
    return this.relationship.id;
  }
}

export interface ParticipantSpec {
  entity: EntityHandle | Id;
  /** Look-across cardinality of this entity (see types.ts). Default `many`. */
  max?: 'one' | 'many';
  participation?: 'partial' | 'total';
  role?: string;
  cardinalityLabel?: string;
}

export type BinaryCardinality = '1:1' | '1:N' | 'N:1' | 'M:N';

export interface RelateOptions {
  identifying?: boolean;
  leftTotal?: boolean;
  rightTotal?: boolean;
  leftRole?: string;
  rightRole?: string;
  keyParticipantIds?: Id[];
}

export class ErBuilder {
  readonly model: ErModel;

  constructor(name: string, id?: Id) {
    this.model = createErModel(name, id);
  }

  entity(name: string, opts: { weak?: boolean; description?: string } = {}): EntityHandle {
    const entity: ErEntity = { id: newId('ent'), name, weak: opts.weak ?? false };
    if (opts.description) entity.description = opts.description;
    this.model.entities[entity.id] = entity;
    return new EntityHandle(this.model, entity);
  }

  /** Associative entity: an entity that stands for the given relationship. */
  associativeEntity(name: string, relationship: RelationshipHandle): EntityHandle {
    const h = this.entity(name);
    h.entity.associativeOf = relationship.id;
    return h;
  }

  /** General n-ary relationship (binary, recursive, ternary, …). */
  relationship(
    name: string,
    participants: ParticipantSpec[],
    opts: { identifying?: boolean; keyParticipantIds?: Id[] } = {},
  ): RelationshipHandle {
    const relationship: ErRelationship = {
      id: newId('rel'),
      name,
      identifying: opts.identifying ?? false,
      participants: participants.map((spec): ErParticipant => {
        const p: ErParticipant = {
          id: newId('par'),
          entityId: typeof spec.entity === 'string' ? spec.entity : spec.entity.id,
          max: spec.max ?? 'many',
          participation: spec.participation ?? 'partial',
        };
        if (spec.role) p.role = spec.role;
        if (spec.cardinalityLabel) p.cardinalityLabel = spec.cardinalityLabel;
        return p;
      }),
    };
    if (opts.keyParticipantIds) relationship.keyParticipantIds = opts.keyParticipantIds;
    this.model.relationships[relationship.id] = relationship;
    return new RelationshipHandle(this.model, relationship);
  }

  /**
   * Binary relationship shorthand. Cardinality is read left-to-right with Chen labels:
   *   '1:N' => left.max = one, right.max = many  (left is the 1-side; FK goes into right)
   *   'N:1' => left.max = many, right.max = one
   *   '1:1' / 'M:N' accordingly. Pass the same entity twice for a recursive relationship.
   */
  relate(
    name: string,
    left: EntityHandle | Id,
    right: EntityHandle | Id,
    cardinality: BinaryCardinality,
    opts: RelateOptions = {},
  ): RelationshipHandle {
    const [l, r] = cardinality.split(':') as [string, string];
    const toMax = (s: string): 'one' | 'many' => (s === '1' ? 'one' : 'many');
    const leftSpec: ParticipantSpec = {
      entity: left,
      max: toMax(l),
      participation: opts.leftTotal ? 'total' : 'partial',
    };
    const rightSpec: ParticipantSpec = {
      entity: right,
      max: toMax(r),
      participation: opts.rightTotal ? 'total' : 'partial',
    };
    if (opts.leftRole) leftSpec.role = opts.leftRole;
    if (opts.rightRole) rightSpec.role = opts.rightRole;
    if (cardinality === 'M:N') {
      leftSpec.cardinalityLabel = 'M';
      rightSpec.cardinalityLabel = 'N';
    }
    return this.relationship(name, [leftSpec, rightSpec], {
      identifying: opts.identifying,
      keyParticipantIds: opts.keyParticipantIds,
    });
  }

  build(): ErModel {
    return this.model;
  }
}

export function erBuilder(name = 'ER Model', id?: Id): ErBuilder {
  return new ErBuilder(name, id);
}

// ---------------------------------------------------------------------------
// Relational
// ---------------------------------------------------------------------------

export interface ColumnSpec {
  name: string;
  type?: string;
  nullable?: boolean;
  default?: string;
  autoIncrement?: boolean;
  unique?: boolean;
  description?: string;
}

export class RelationHandle {
  constructor(
    private readonly model: RelationalModel,
    readonly relation: Relation,
  ) {}
  get id(): Id {
    return this.relation.id;
  }
  /** Column id by name (throws if absent — fixtures should fail loudly). */
  col(name: string): Id {
    const c = this.relation.columns.find((x) => x.name === name);
    if (!c) throw new Error(`Relation ${this.relation.name} has no column ${name}`);
    return c.id;
  }
  cols(...names: string[]): Id[] {
    return names.map((n) => this.col(n));
  }
  /** Append a column and return this handle. */
  addColumn(spec: string | ColumnSpec): this {
    const s: ColumnSpec = typeof spec === 'string' ? { name: spec } : spec;
    const column: RelColumn = {
      id: newId('col'),
      name: s.name,
      nullable: s.nullable ?? true,
    };
    if (s.type) column.dataType = s.type;
    if (s.default !== undefined) column.defaultValue = s.default;
    if (s.autoIncrement) column.autoIncrement = true;
    if (s.description) column.description = s.description;
    this.relation.columns.push(column);
    if (s.unique) this.relation.uniques.push({ id: newId('uq'), columnIds: [column.id] });
    return this;
  }
  /** Set the (possibly composite) primary key by column names; marks the columns NOT NULL. */
  setPrimaryKey(...names: string[]): this {
    this.relation.primaryKey = this.cols(...names);
    for (const id of this.relation.primaryKey) {
      const c = this.relation.columns.find((x) => x.id === id);
      if (c) c.nullable = false;
    }
    return this;
  }
  unique(...names: string[]): this {
    this.relation.uniques.push({ id: newId('uq'), columnIds: this.cols(...names) });
    return this;
  }
  index(name: string, names: string[], unique = false): this {
    this.relation.indexes.push({ id: newId('idx'), name, columnIds: this.cols(...names), unique });
    return this;
  }
}

export interface FkOptions {
  name?: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  label?: string;
}

export class RelationalBuilder {
  readonly model: RelationalModel;

  constructor(name: string, dialect: SqlDialect = 'generic', id?: Id) {
    this.model = createRelationalModel(name, dialect, id);
  }

  /**
   * Add a relation. `columns` are names or specs; `pk` are column NAMES (composite supported).
   * PK columns become NOT NULL.
   */
  relation(name: string, columns: Array<string | ColumnSpec>, opts: { pk?: string[]; schemaName?: string } = {}): RelationHandle {
    const relation: Relation = {
      id: newId('rln'),
      name,
      columns: [],
      primaryKey: [],
      uniques: [],
      indexes: [],
    };
    if (opts.schemaName) relation.schemaName = opts.schemaName;
    this.model.relations[relation.id] = relation;
    const handle = new RelationHandle(this.model, relation);
    for (const c of columns) handle.addColumn(c);
    if (opts.pk?.length) handle.setPrimaryKey(...opts.pk);
    return handle;
  }

  /**
   * Add ONE foreign key (composite when several column names are given; order = pairing).
   *   fk(prescription, ['CompanyName','DrugTradeName'], drug, ['CompanyName','TradeName'])
   */
  fk(
    source: RelationHandle,
    sourceColumns: string[],
    target: RelationHandle,
    targetColumns: string[],
    opts: FkOptions = {},
  ): ForeignKey {
    if (sourceColumns.length !== targetColumns.length) {
      throw new Error('Foreign key column lists must have the same length');
    }
    const fk: ForeignKey = {
      id: newId('fk'),
      sourceRelationId: source.id,
      targetRelationId: target.id,
      columns: sourceColumns.map((name, i) => ({
        sourceColumnId: source.col(name),
        targetColumnId: target.col(targetColumns[i]!),
      })),
    };
    if (opts.name) fk.name = opts.name;
    if (opts.onDelete) fk.onDelete = opts.onDelete;
    if (opts.onUpdate) fk.onUpdate = opts.onUpdate;
    if (opts.label) fk.label = opts.label;
    this.model.foreignKeys[fk.id] = fk;
    return fk;
  }

  build(): RelationalModel {
    return this.model;
  }
}

export function relationalBuilder(name = 'Relational Schema', dialect: SqlDialect = 'generic', id?: Id): RelationalBuilder {
  return new RelationalBuilder(name, dialect, id);
}
