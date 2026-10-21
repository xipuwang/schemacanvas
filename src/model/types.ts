/**
 * SchemaCanvas domain model — THE contract shared by every module.
 *
 * Three strictly separated layers (see ARCHITECTURE.md):
 *
 *  1. SEMANTIC MODELS  (`ErModel`, `RelationalModel`)
 *     Database meaning only. No coordinates, no colours, no shapes. Everything has a
 *     stable id; relationships between concepts are expressed by ids, never by names.
 *
 *  2. DIAGRAMS  (`Diagram`, `DiagramNode`, `DiagramEdge`)
 *     Presentation: which semantic elements are shown, in which notation, with which
 *     style / routing overrides. A diagram *references* semantic elements by `SemanticRef`.
 *     A foreign key edge points at a `ForeignKey` id — never at pixels.
 *
 *  3. GEOMETRY
 *     Authoring geometry (x/y, manual sizes, waypoints) is stored on diagram nodes/edges.
 *     DERIVED geometry (text-fitted sizes, anchors, routed polylines) is computed on demand
 *     into a `Scene` (src/scene) and is NEVER persisted.
 *
 * Compatibility rules:
 *  - Plain JSON only (no Map/Set/Date/undefined-sensitive data) so projects serialise losslessly
 *    and work with immer patches.
 *  - Contract changes must be ADDITIVE (new optional fields). Anything else needs a
 *    SCHEMA_VERSION bump plus a migration in src/model/io.
 */

/** Opaque, project-unique, stable identifier, e.g. `ent_k3j9x0a2`. Never derived from names. */
export type Id = string;

export const PROJECT_FORMAT = 'schemacanvas-project' as const;
/** Bump on any breaking change to the persisted shape; add a migration in src/model/io. */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * Points at one semantic element. Ids are unique project-wide, so `id` alone identifies the
 * element; the parent id on nested kinds (participant, column, unique, index) is a lookup
 * accelerator and consistency check, and is always present.
 */
export type SemanticRef =
  | { kind: 'entity'; id: Id }
  | { kind: 'attribute'; id: Id }
  | { kind: 'relationship'; id: Id }
  | { kind: 'participant'; relationshipId: Id; id: Id }
  | { kind: 'relation'; id: Id }
  | { kind: 'column'; relationId: Id; id: Id }
  | { kind: 'unique'; relationId: Id; id: Id }
  | { kind: 'index'; relationId: Id; id: Id }
  | { kind: 'foreignKey'; id: Id };

export type SemanticRefKind = SemanticRef['kind'];

// ---------------------------------------------------------------------------
// Semantic layer 1: conceptual ER model (Chen)
// ---------------------------------------------------------------------------

export interface ErEntity {
  id: Id;
  name: string;
  /**
   * Weak entity: cannot be identified by its own attributes alone; identified through an
   * identifying relationship to one or more owner entities plus its partial key.
   */
  weak: boolean;
  /**
   * Associative entity: this entity "is" the relationship `relationships[associativeOf]` (promoted
   * so it can have its own key and take part in other relationships). Chen: a rectangle enclosing
   * a diamond. RULES (normative, see ARCHITECTURE §2):
   *  - R must exist, be non-identifying, and be pointed at by at most one entity; the entity is never weak.
   *  - The `ErRelationship` R still holds the participants, but R gets NO diagram node of its own:
   *    `nodeIdOfRef(R)` (model/diagramSync) resolves to this entity's node, so R's participant edges and
   *    R-owned attribute edges attach to the entity's node.
   *  - Attributes belong to the ENTITY (relationship-owned attributes of R are treated as the entity's).
   *  - Conversion: exactly ONE relation named after the entity: FK per participant of R + the entity's
   *    own attributes. PK = the entity's primary attributes if any (each candidate key of R then becomes
   *    a UNIQUE), otherwise the chosen key of R. ruleId `associative-entity`.
   */
  associativeOf?: Id;
  description?: string;
}

export type ErAttributeOwner =
  | { kind: 'entity'; id: Id }
  | { kind: 'relationship'; id: Id }
  /** Sub-attribute of a composite attribute (composite = has >= 1 child attribute). */
  | { kind: 'attribute'; id: Id };

/**
 * `primary`: part of the identifier of its entity (several `primary` attributes on one entity
 *            form a composite key; a composite attribute marked `primary` means all of its
 *            atomic leaves are key columns). Rendered with a solid underline.
 * `partial`: partial key (discriminator) of a weak entity. Rendered with a dashed underline.
 *
 * WHERE `key` HAS MEANING (normative; notation is always drawn from the stored data, never inferred —
 * inconsistencies are reported by validation, not hidden by the renderer):
 *  - TOP-LEVEL attributes only (owner.kind `entity` | `relationship`). A sub-attribute's own `key` is
 *    ignored by conversion (its leaves inherit the top-level ancestor's key); validation warns
 *    `er.key-on-subattribute`.
 *  - RELATIONSHIP-owned `primary`: a discriminator appended to every candidate key of the relationship
 *    relation (e.g. `Attends.Date`). If the relationship is folded into an FK (1:N / 1:1) it is ignored
 *    with `conv.relationship-key-attr-folded`.
 *  - On a WEAK entity `primary` is converted exactly like `partial` (`er.weak-primary-key` warning);
 *    on a STRONG entity `partial` is converted as `none` (`er.partial-key-on-strong`).
 *  - A key attribute is never multivalued or derived (`er.key-multivalued` / `er.key-derived` errors)
 *    and is always NOT NULL (`optional` is ignored).
 */
export type ErKeyKind = 'none' | 'primary' | 'partial';

export interface ErAttribute {
  id: Id;
  name: string;
  owner: ErAttributeOwner;
  /** Sibling order among attributes with the same owner (ascending). */
  order: number;
  key: ErKeyKind;
  /** Rendered as a double ellipse. Converts to its own relation. */
  multivalued: boolean;
  /** Rendered as a dashed ellipse. Not stored by default conversion. */
  derived: boolean;
  /** Value may be absent (=> nullable column). Ignored for key attributes. */
  optional?: boolean;
  /** Free-form SQL-ish type text, e.g. `VARCHAR(50)`, `INT`. */
  dataType?: string;
  /** For derived attributes: attributes it is computed from (documentation + explanation). */
  derivedFrom?: Id[];
  description?: string;
}

/**
 * Cardinality & participation conventions (documented once, used everywhere):
 *
 *  - `max` uses LOOK-ACROSS semantics, the classic Chen label placement: the label drawn next to
 *    entity E states how many instances of E can be related to ONE combination of instances of
 *    all the OTHER participants. In `Dept(1) —Works_for— Employee(N)` one Dept has many
 *    Employees, an Employee has at most one Dept. The N-side (`many`) receives the foreign key.
 *  - `participation` uses NEAR-SIDE semantics: `total` = every instance of this entity takes part
 *    in the relationship (double line); `partial` = single line.
 */
export interface ErParticipant {
  /** Stable id: a recursive relationship has two participants with the same `entityId`. */
  id: Id;
  entityId: Id;
  /** Role label, essential for recursive relationships (e.g. `supervisor`, `subordinate`). */
  role?: string;
  max: 'one' | 'many';
  /**
   * Display override of the cardinality label (`1`, `N`, `M`, `P`…) for `letters` style. Only honoured
   * when consistent with `max` (`erSemantics.cardinalityText`); ops clear it whenever `max` changes.
   */
  cardinalityLabel?: string;
  participation: 'partial' | 'total';
  /**
   * Identifying relationships only: marks the IDENTIFIED (weak/dependent) participant; every other
   * participant is an owner. When no participant is flagged, the identified participant is the UNIQUE
   * participant whose entity is weak; if there is not exactly one, the relationship is unresolved
   * (validation `er.identifying-ambiguous`; the converter treats it as non-identifying + warns).
   * See `identifiedParticipants` in model/erSemantics.ts.
   */
  identified?: boolean;
}

export interface ErRelationship {
  id: Id;
  name: string;
  /** Double diamond. Connects a weak entity to its owner(s). */
  identifying: boolean;
  /** >= 2 participants; binary, recursive (same entity twice), ternary and n-ary supported. */
  participants: ErParticipant[];
  /**
   * Optional user decision for n-ary / M:N relationships: the participants whose entity keys form
   * the primary key of the generated relationship relation. MUST contain a candidate key from
   * `relationshipCandidateKeys(rel)` (model/erSemantics) — otherwise validation raises
   * `er.relationship-key-vs-cardinality` and the converter falls back to the first candidate key
   * (with a warning). When absent, the converter uses the first candidate key; every other
   * candidate key becomes a UNIQUE constraint.
   */
  keyParticipantIds?: Id[];
  description?: string;
}

export interface ErModel {
  id: Id;
  kind: 'er';
  name: string;
  entities: Record<Id, ErEntity>;
  /** Flat, normalised: attributes are diagram nodes of their own and reference their owner by id. */
  attributes: Record<Id, ErAttribute>;
  relationships: Record<Id, ErRelationship>;
}

// ---------------------------------------------------------------------------
// Semantic layer 2: relational / logical / physical model
// ---------------------------------------------------------------------------

export type SqlDialect = 'generic' | 'postgresql' | 'sqlite' | 'mysql';
export type ReferentialAction = 'NO ACTION' | 'RESTRICT' | 'CASCADE' | 'SET NULL' | 'SET DEFAULT';

/** Why a generated element exists (conversion provenance). Absent on hand-authored elements. */
export interface Origin {
  /** One of `CONVERSION_RULE_IDS` (model/conversionRules.ts). */
  ruleId: string;
  /**
   * ER elements this element was derived from — the per-element truth that survives edits
   * (`ConversionRecord.trace` is merely an index built from the same data). Conventions:
   *  - relation from an entity: [entity]                    - column from an attribute: [leaf attribute]
   *  - FK + FK columns of an FK-on-entity translation (1:N, 1:1, recursive 1:N):
   *      [holder-side participant (its `participation` decides NOT NULL), referenced-side participant, relationship]
   *  - relationship-relation FK columns: [referenced participant, relationship]
   *  - multivalued relation: [the multivalued attribute]
   */
  sources: SemanticRef[];
  /**
   * Deterministic generation key, unique within one generated model and rebuilt identically on every run
   * from SOURCE IDS ONLY (never names), e.g. `strong-entity:ent_1`, `column:ent_1:att_7`, `fk:rel_3:par_2`.
   * Lets a re-conversion reuse ids of unchanged elements (keeps positions/routes). See ConversionResult.
   */
  key?: string;
  note?: string;
}

export interface RelColumn {
  id: Id;
  name: string;
  /**
   * Dialect-neutral type text. NEVER encodes identity: SERIAL / BIGSERIAL / AUTO_INCREMENT / AUTOINCREMENT /
   * IDENTITY are normalised on import to the base type + `autoIncrement: true`. Compare types only through
   * `parseDataType` / `dataTypesCompatible` (model/relationalFacts). When propagating a key to an FK column,
   * copy the target's `dataType` ONLY — never `autoIncrement` or `defaultValue`.
   */
  dataType?: string;
  /** Primary-key columns are always NOT NULL (enforced by ops; validated). */
  nullable: boolean;
  /** Raw SQL expression emitted verbatim after DEFAULT; string literals keep their quotes: `'active'`, `0`, `CURRENT_TIMESTAMP`. */
  defaultValue?: string;
  autoIncrement?: boolean;
  description?: string;
  origin?: Origin;
}

export interface UniqueConstraint {
  id: Id;
  name?: string;
  /** Ordered; >= 1 column. A single-column unique constraint is how `UNIQUE` on a column is modelled. */
  columnIds: Id[];
  origin?: Origin;
}

export interface RelIndex {
  id: Id;
  name: string;
  columnIds: Id[];
  unique: boolean;
  /** Partial-index predicate (raw SQL). */
  where?: string;
  /** Index method (btree, hash, …), dialect specific. */
  method?: string;
  /** Subset of `columnIds` sorted DESC. */
  descendingColumnIds?: Id[];
}

export interface CheckConstraint {
  id: Id;
  name?: string;
  /** Raw SQL boolean expression. */
  expression: string;
  /** Columns the expression mentions, when known (used to prune on column delete). */
  columnIds?: Id[];
}

/** A table / relation. Columns are NESTED (they are cells of the relation node, not diagram nodes). */
export interface Relation {
  id: Id;
  name: string;
  /** Schema namespace where supported (PostgreSQL schema, MySQL database). */
  schemaName?: string;
  /** Ordered columns. Order is the horizontal cell order / DDL column order. */
  columns: RelColumn[];
  /**
   * Ordered ids of the primary key columns (composite supported; empty = no PK).
   * PK / FK membership is NEVER stored on columns — it is derived (see queries.columnRole).
   */
  primaryKey: Id[];
  primaryKeyName?: string;
  uniques: UniqueConstraint[];
  indexes: RelIndex[];
  checks?: CheckConstraint[];
  description?: string;
  origin?: Origin;
}

export interface ForeignKeyColumnPair {
  sourceColumnId: Id;
  targetColumnId: Id;
}

/**
 * ONE logical constraint, even for composite keys. Rendered as one connector group.
 * `Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName, TradeName)` is a single
 * ForeignKey with two ordered pairs, never two separate foreign keys.
 */
/**
 * Stated design intent of a foreign key, needed by Crow's Foot and DBML. Missing fields are DERIVED
 * (`fkCardinality()` in model/queries): parentMin = 1 iff all FK columns are NOT NULL; childMax = 'one'
 * iff the FK columns cover a PK/UNIQUE of the source relation, else 'many'; childMin = 0.
 */
export interface FkCardinality {
  /** Child rows per parent row: maximum. */
  childMax?: 'one' | 'many';
  /** Child rows per parent row: minimum (1 = "every parent has >= 1 child": total participation on the 1-side; NOT enforceable by FK/NOT NULL). */
  childMin?: 0 | 1;
  /** 1 = every child row must reference a parent (FK columns NOT NULL). */
  parentMin?: 0 | 1;
}

export interface ForeignKey {
  id: Id;
  name?: string;
  /** Referencing (child) relation — owns the columns in `columns[].sourceColumnId`. */
  sourceRelationId: Id;
  /** Referenced (parent) relation — owns the columns in `columns[].targetColumnId`. */
  targetRelationId: Id;
  /** Ordered column correspondence; source[i] references target[i]. */
  columns: ForeignKeyColumnPair[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /** Optional user text shown on the connector (FK label). */
  label?: string;
  cardinality?: FkCardinality;
  origin?: Origin;
}

export interface RelationalModel {
  id: Id;
  kind: 'relational';
  name: string;
  dialect: SqlDialect;
  relations: Record<Id, Relation>;
  /** Flat: a FK touches two relations, and diagram edges reference FKs by id. */
  foreignKeys: Record<Id, ForeignKey>;
  /** Set when generated by ER → relational conversion. */
  derivedFrom?: { erModelId: Id; conversionId: Id };
}

export type Model = ErModel | RelationalModel;

// ---------------------------------------------------------------------------
// Validation issues (produced by src/validation and src/conversion)
// ---------------------------------------------------------------------------

/**
 * error:   definite structural error (e.g. FK references a nonexistent column).
 * warning: probable problem or ambiguity (e.g. weak entity without partial key).
 * info:    design recommendation. Unconventional ≠ invalid; never raise unconventional-but-valid
 *          designs above `info`.
 */
export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  /** Deterministic (`issueId()` in model/issues.ts): same problem => same id across runs. */
  id: string;
  /**
   * Stable machine code, e.g. `rel.no-primary-key`; i18n key `issues.<code>.*`. Namespaces — each is
   * produced ONLY by its owner so the panel never shows duplicates:
   *   `er.*`, `rel.*`  src/validation (static model problems, incl. ER-level ambiguity)
   *   `ddl.<dialect>.*` src/sql       (`ddlIssues(model, dialect)`)
   *   `conv.*`         src/conversion (option-dependent decisions / constraints FKs cannot enforce; lives in
   *                    ConversionRecord.warnings; never re-reports structural ER problems)
   */
  code: string;
  severity: Severity;
  /** English text; the UI prefers the i18n entry for `code` when present. */
  title: string;
  explanation: string;
  suggestion: string;
  /** Click-to-highlight targets. The UI maps refs to nodes/edges via `resolveRefsInDiagram` (model/diagramSync). */
  affected: SemanticRef[];
  /** Model of `affected[0]`; `affected` may span models (conversion warnings). */
  modelId: Id;
  /** Interpolation values for i18n templates. */
  params?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// ER → relational conversion records (stored in the project; src/conversion fills them)
// ---------------------------------------------------------------------------

export type OneToOneStrategy =
  /** Pick the FK side automatically (prefer total participation side; explain the choice). */
  | 'auto'
  | 'fk-on-first'
  | 'fk-on-second'
  /** Merge both entities into one relation. */
  | 'merge'
  /** Separate relationship relation. */
  | 'relation';

/**
 * Default naming of a propagated key column (normative; options below override):
 *   - a column propagated from an ALREADY-propagated column keeps that column's name;
 *   - otherwise name = Cap(participant.role if set else entity name) + Cap(key attribute name)
 *     (`Company.name` → `CompanyName`; role `manager` + `Eid` → `ManagerEid`);
 *   - on a name collision inside the relation, append the role/entity name and emit a decision.
 * (Spec Example D's literal `PreReq(Cid, Req_Cid)` is produced with `columnPrefixes`.)
 */
export interface ConversionOptions {
  /** Default for every 1:1 relationship; prefer 'auto' | 'merge' | 'relation' (positional values are unstable). */
  oneToOne: OneToOneStrategy;
  /** Per-relationship overrides, keyed by ErRelationship id. */
  relationshipOverrides: Record<
    Id,
    {
      oneToOne?: OneToOneStrategy;
      asRelation?: boolean;
      /** The participant whose relation receives the FK; takes precedence over `oneToOne`. */
      fkParticipantId?: Id;
    }
  >;
  /** Derived attributes the user explicitly chose to store as ordinary columns. */
  materializeDerived: Id[];
  /** Copy ER attribute data types to generated columns (`dataType` only — see RelColumn). */
  carryDataTypes: boolean;
  /** Per-participant literal prefix for FK columns generated from that participant's key (`''` = none). */
  columnPrefixes?: Record<Id, string>;
  /** Final column-name overrides keyed by `Origin.key`; survive re-conversion. */
  columnNames?: Record<string, string>;
}

export interface ConversionTraceEntry {
  source: SemanticRef;
  targets: SemanticRef[];
  ruleId: string;
}

export interface ConversionDecision {
  id: string;
  ruleId: string;
  /** English; i18n by `ruleId` where available. */
  title: string;
  explanation: string;
  sources: SemanticRef[];
  targets: SemanticRef[];
  level: 'info' | 'warning';
  /**
   * Values the English text was built from, for translation (src/i18n/issues.ts `localizeDecision`). `kind` selects the
   * catalogue entry `decisions.<kind>` (default: `ruleId`); other keys interpolate. Absent on decisions of older files.
   */
  params?: Record<string, string | number>;
}

export interface ConversionRecord {
  id: Id;
  erModelId: Id;
  relationalModelId: Id;
  /** Set when this conversion regenerated a previous one (id reuse via `Origin.key`). */
  previousConversionId?: Id;
  createdAt: string;
  options: ConversionOptions;
  /** Traceable mapping: ER concept → generated relational elements. */
  trace: ConversionTraceEntry[];
  /** Explanation of major decisions, shown in the Convert dialog. */
  decisions: ConversionDecision[];
  /** Ambiguities and constraints ordinary FKs cannot enforce (`conv.*`). Never silently dropped. */
  warnings: Issue[];
}

/**
 * Result of the PURE `convertErToRelational(project, erModelId, options?, env?)` (src/conversion):
 * it never mutates its input and never touches the store. Completeness invariant (asserted in tests):
 * every ER entity, attribute (composite parents + derived ones included), relationship and participant
 * is the `source` of >= 1 trace entry; omitted elements have `targets: []` plus a decision explaining why.
 * `ops.applyConversionResult(draft, result, opts?)` inserts it into a project in ONE undoable commit.
 */
export interface ConversionResult {
  /** Fresh ids (or reused ones via `env.previous`); `derivedFrom = { erModelId, conversionId: record.id }`. */
  relationalModel: RelationalModel;
  /** `record.relationalModelId === relationalModel.id`. */
  record: ConversionRecord;
  /** `createDiagramForModel(relationalModel, 'relational-schema')`: nodes at provisional grid positions + all FK edges. */
  diagram: Diagram;
}

// ---------------------------------------------------------------------------
// Diagram layer
// ---------------------------------------------------------------------------

/**
 * Notation / diagram family.
 *  - `chen`              Chen ER diagram            (views an `ErModel`)
 *  - `relational-schema` HORIZONTAL single-row relational schema (native type, views a `RelationalModel`)
 *  - `crows-foot`        Crow's Foot ERD, horizontal or vertical tables (views a `RelationalModel`)
 *  - `physical`          Physical model: types, constraints, indexes (views a `RelationalModel`)
 * New families (UML class, FD diagrams, …) plug in through the scene/render registries.
 */
export type DiagramType = 'chen' | 'relational-schema' | 'crows-foot' | 'physical';

export interface Point {
  x: number;
  y: number;
}

export interface NodeStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  textColor?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
}

export interface EdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  dash?: 'solid' | 'dashed' | 'dotted';
}

/**
 * One visual object. A semantic element has AT MOST ONE node per diagram (invariant).
 * Allowed `ref.kind`: chen → entity | attribute | relationship; other diagram types → relation.
 */
export interface DiagramNode {
  id: Id;
  ref: SemanticRef;
  /**
   * Top-left of the node's `NodeGeom.bounds` in world units. INVARIANT for EVERY notation:
   * `geom.bounds.x === node.x && geom.bounds.y === node.y`, where `bounds` includes everything the node
   * paints as part of itself (the h-table's relation name, a weak entity's outer rectangle, …) and excludes
   * stroke thickness. Layout/align/distribute/snap/paste therefore never special-case a notation.
   */
  x: number;
  y: number;
  /**
   * Manual size override; `undefined` = auto-fit (the default). Chen: size of the OUTER outline, clamped to
   * the text-fit minimum. h-table: `height` = row (cell) height of this table (falls back to
   * `options.relational.rowHeight`); `width` = minimum total row width, surplus goes proportionally to cells
   * without a `columnWidths` entry; both exclude the relation name.
   */
  width?: number;
  height?: number;
  style?: NodeStyle;
  /** relational-schema / crows-foot: per-column cell width overrides, keyed by column id. */
  columnWidths?: Record<Id, number>;
  /** Paint order; higher = on top. */
  zIndex?: number;
  locked?: boolean;
}

/**
 * What a diagram edge stands for. The edge never stores endpoints — endpoints derive from the ref.
 * DIRECTION (normative; `waypoints` and anchors are stored in source → target order):
 *   participant: source = relationship node, target = entity node (cardinality label at the target end)
 *   attribute:   source = owner node (entity | relationship | parent attribute), target = attribute node
 *   foreignKey:  source = node of the referencing relation, target = node of the referenced relation
 * Scene builders draw ONLY the edges present in `diagram.edges` and never invent edges; an edge with a
 * dangling ref or a missing endpoint node is skipped with a `Scene.warnings` entry. At most one edge per
 * `edgeRefKey` per diagram. Edges are created/removed by `syncDiagramEdges` (model/diagramSync).
 */
export type EdgeRef =
  /** Chen: relationship ↔ participating entity line (carries cardinality + participation). */
  | { kind: 'participant'; relationshipId: Id; participantId: Id }
  /** Chen: owner (entity / relationship / composite attribute) ↔ attribute line. */
  | { kind: 'attribute'; attributeId: Id }
  /** Relational families: foreign key connector (composite FK = one edge). */
  | { kind: 'foreignKey'; foreignKeyId: Id };

export type AnchorSide = 'auto' | 'top' | 'right' | 'bottom' | 'left';

/**
 * Editable anchor preference for one end of an edge. Never changes WHICH element/column is referenced.
 *  - FK edges (horizontal schema): CELL-relative. `side` ∈ auto|top|bottom; `left` is allowed only on the
 *    first cell of the row and `right` only on the last (anything else is coerced to `auto` with a
 *    Scene warning). `offset` runs 0..1 along that cell's side; the scene clamps the point to
 *    [cell.x+4, cell.x+cell.w-4]. So dragging an anchor can never slide onto a neighbouring field.
 *  - Chen edges: `offset` is measured along the node's outline-rect side and then projected onto the
 *    outline with `boundaryPoint(outline, thatPoint)`.
 */
export interface AnchorSpec {
  side: AnchorSide;
  /** Position along the chosen side, 0..1 (0.5 = centre). Absent = automatic spreading. */
  offset?: number;
}

export interface EdgeRoute {
  /** `auto`: router decides. `manual`: honour `waypoints`. */
  mode: 'auto' | 'manual';
  /**
   * Intermediate bend points in world coordinates, in source→target order. Each waypoint is a CORNER the path
   * passes through exactly; between consecutive points at most one elbow is inserted, continuing the previous
   * segment's axis. Obstacles are avoided only in `auto` mode (manual segments follow user intent).
   * Composite FK, `branches` style: waypoints are the CENTRELINE of the bundle; branch i (pair order) is offset
   * perpendicular to each segment by (i-(n-1)/2)*BRANCH_GAP and keeps its own stubs to its own source/target
   * cells — branches are NEVER merged into a shared trunk. `bracket` style: waypoints apply to the single
   * bracket-to-bracket arrow. `EdgeGeom.autoWaypoints` converts the current auto route to storable waypoints.
   */
  waypoints: Point[];
  /** Defaults for all branches/ends of the edge. */
  sourceAnchor?: AnchorSpec;
  targetAnchor?: AnchorSpec;
  /** Composite FK: per-branch overrides keyed by the branch's SOURCE column id. */
  branchAnchors?: Record<Id, { source?: AnchorSpec; target?: AnchorSpec }>;
}

export interface DiagramEdge {
  id: Id;
  ref: EdgeRef;
  route: EdgeRoute;
  style?: EdgeStyle;
  /** FK connectors: show a label (`label` of the FK, else its generated description). */
  labelVisible?: boolean;
  /** User-dragged label positions: world-space delta from the scene's default label anchor. */
  labelOffsets?: Partial<Record<'main' | 'role' | 'cardinality', Point>>;
}

export interface GridOptions {
  visible: boolean;
  size: number;
  snap: boolean;
}

export interface ChenOptions {
  /** Show role labels on participation lines. */
  showRoles: boolean;
  /** Show attribute data types inside ellipses. */
  showDataTypes: boolean;
  /**
   * `letters` = 1 / N / M. `minmax` = NEAR-side (min,max) per participant (`minMaxOf` in model/erSemantics):
   * min = total ? 1 : 0; max = the OTHER participant's look-across max (binary only). N-ary relationships
   * fall back to `letters` for that relationship (the near-side max is not derivable — no constraint is invented).
   * Minimums other than 0/1 are out of scope for v1.
   */
  cardinalityStyle: 'letters' | 'minmax';
  routing: 'straight' | 'orthogonal';
}

export interface RelationalSchemaOptions {
  rowHeight: number;
  cellPaddingX: number;
  showDataTypes: boolean;
  /** Relation name above (true) or to the left of (false) the single-row table. */
  nameAbove: boolean;
  /** Show FK constraint labels on connectors (global default; per-edge `labelVisible` overrides). */
  fkLabels: boolean;
  /**
   * `branches`: one arrow per column pair, each ending at exactly its referenced column
   *             (grouped visually as one logical constraint).
   * `bracket`:  one arrow between a bracket over the FK columns and a bracket over the target key.
   */
  compositeFkStyle: 'branches' | 'bracket';
  routing: 'orthogonal' | 'straight';
}

export interface CrowsFootOptions {
  orientation: 'horizontal' | 'vertical';
  showTypes: boolean;
  showNullability: boolean;
  routing: 'orthogonal' | 'straight';
}

export interface PhysicalOptions {
  showIndexes: boolean;
  showConstraints: boolean;
  routing: 'orthogonal' | 'straight';
}

export interface DiagramOptions {
  grid: GridOptions;
  typography: { fontFamily: string; fontSize: number };
  /** Type-specific blocks; the one matching `Diagram.type` is always present (see defaults.ts). */
  chen?: ChenOptions;
  relational?: RelationalSchemaOptions;
  crowsFoot?: CrowsFootOptions;
  physical?: PhysicalOptions;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Diagram {
  id: Id;
  name: string;
  type: DiagramType;
  /** The semantic model this diagram is a view of. chen → ErModel, others → RelationalModel. */
  modelId: Id;
  nodes: Record<Id, DiagramNode>;
  edges: Record<Id, DiagramEdge>;
  options: DiagramOptions;
  /**
   * `false`/absent = COMPLETE view: every node-able element of the model has exactly one node
   * (`syncDiagram` adds missing nodes). `true` = the user removed elements from this view
   * ("Remove from diagram"); sync never re-adds nodes and only maintains edges.
   */
  partial?: boolean;
  viewport?: Viewport;
}

// ---------------------------------------------------------------------------
// Project (the document)
// ---------------------------------------------------------------------------

export interface ProjectSettings {
  defaultDialect: SqlDialect;
}

export interface Project {
  schemaVersion: number;
  id: Id;
  name: string;
  description?: string;
  /** ISO-8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  models: Record<Id, Model>;
  diagrams: Record<Id, Diagram>;
  /** Tab order of diagrams. Every key of `diagrams` appears exactly once. */
  diagramOrder: Id[];
  conversions: Record<Id, ConversionRecord>;
  settings: ProjectSettings;
}

/** On-disk / export wrapper for native `.schemacanvas.json` files. */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  /** AUTHORITATIVE version; `Project.schemaVersion` is set to SCHEMA_VERSION after migration. */
  schemaVersion: number;
  savedAt: string;
  app?: { name: string; version: string };
  project: Project;
}
