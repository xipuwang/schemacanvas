# src/validation

Database-aware validation (product specification section 4). Pure and deterministic: input is a (deeply readonly) `Project`, output is
`Issue[]`. It never mutates, never throws on the SOFT states listed in `src/model/invariants.ts` (dangling ids, empty FKs,
missing owners, cycles ...) and only produces the `er.*` and `rel.*` code namespaces (`ddl.*` belongs to src/sql, `conv.*` to
src/conversion).

## Public API (`import ... from '@/validation'`)

```ts
validateProject(project, opts?: { modelId?: Id; severities?: Severity[] }): Issue[]   // all models, or one
validateModel(model, project): Issue[]            // project gives cross-model context (ER Origins of generated FKs)
RULES: readonly Rule[]                            // registry: { code, appliesTo: 'er'|'relational', severity, description, check }
compareIssues(a, b): number                       // the canonical order (below)
summarizeIssues(issues): { error, warning, info, total }
worstSeverity(issues): Severity | undefined
groupByAffected(issues, { rollUp? }): Record<refKey, Issue[]>   // node/cell badges; rollUp files column/unique/index under
                                                                  // `relation:<id>` and participants under `relationship:<id>`
issuesForRef(issues, ref): Issue[]                // issues naming exactly this ref
```

* Order: severity (error > warning > info), then `modelId`, `code`, affected refs, `id` - independent of object key order.
* Every `Issue` is built with `makeIssue` by the engine (`index.ts`); a rule only returns an `IssueDraft`
  (title / explanation / suggestion / affected / params). Code and severity are stamped from the rule, so the registry is
  the single source of truth. `id = issueId(code, affected)`; duplicates with the same id inside one result are dropped.
* `affected` refs that do not resolve in the model are dropped by the engine, and rules always include something that does,
  so click-to-highlight (`resolveRefsInDiagram`) always has a target. Tests assert this for every issue they produce.
* English `title` / `explanation` / `suggestion`; `params` carry the interpolation values for i18n templates
  (`issues.<code>.*`).

## Conventions

* Facts come from `model/erSemantics`, `model/relationalFacts` and `model/queries` (identification, candidate keys,
  `fkReferencesKey`, `dataTypesCompatible`, `fkCardinality`, `sqlNameKey`, `relationNameKey`) - rules never re-derive them.
* Severity policy: `error` = definite structural problem; `warning` = probable problem / the stored data is silently ignored
  or contradicts itself; `info` = design recommendation. Unconventional-but-valid designs are never above `info` and several
  are explicitly NOT flagged (negative tests): FK to a UNIQUE constraint / unique index, FK order different from key order,
  FK covering a whole PK, self-referencing nullable FK, relations with only PK columns, optional FKs without stated
  participation, FK/type pairs whose types are `compatible` or `unknown`, multi-owner weak entities, weak-entity chains
  (with the identified side flagged).
* To avoid double reporting, a more specific rule suppresses a general one: `er.weak-no-owner` is not raised for entities
  in an ambiguous identifying relationship or an ownership cycle; identifying relationships are skipped by
  `er.nary-multiple-keys` / `er.relationship-key-vs-cardinality` (they produce no relationship relation);
  `rel.fk-target-not-key` is skipped when a target column is missing / foreign (those have their own codes).
* Adding a rule: write it in `erRules.ts` / `relRules.ts` with `rule(code, severity, description, check)`, add it to the
  exported list, add one positive and one negative test, and extend this table.

## Rules

| Code | Severity | What it detects |
|---|---|---|
| `er.entity-name-empty` | error | An entity has an empty name. |
| `er.relationship-name-empty` | error | A relationship has an empty name. |
| `er.attribute-name-empty` | error | An attribute has an empty name. |
| `er.entity-name-duplicate` | error | Two entities have the same name (case-insensitive). |
| `er.relationship-name-duplicate` | warning | Two relationships have the same name (case-insensitive). |
| `er.attribute-name-duplicate` | error | Two attributes of the same owner have the same name (case-insensitive). |
| `er.entity-no-key` | warning | A strong entity has no key attribute, so its relation would have no primary key. |
| `er.key-optional` | warning | A key attribute is marked optional; the flag is ignored (key columns are NOT NULL). |
| `er.key-on-subattribute` | warning | A sub-attribute of a composite attribute is marked as a key; the flag is ignored. |
| `er.weak-primary-key` | warning | A weak entity has attributes marked as primary key; they are treated as partial keys. |
| `er.partial-key-on-strong` | warning | A strong entity has a partial-key attribute; it is treated as an ordinary attribute. |
| `er.key-multivalued` | error | A key attribute is multivalued. |
| `er.key-derived` | error | A key attribute is derived. |
| `er.weak-no-owner` | error | A weak entity has no identifying owner. |
| `er.weak-no-partial-key` | warning | A weak entity has no partial key (discriminator); not raised when every identifying participation of the weak entity has max `one` (owner key alone identifies it). |
| `er.identifying-ambiguous` | error | An identifying relationship has several weak participants and none is marked as the identified one. |
| `er.identifying-identifies-nothing` | error | An identifying relationship has no weak entity to identify. |
| `er.identified-not-weak` | warning | The identified participant of an identifying relationship is not a weak entity. |
| `er.identifying-partial` | error | The identified (weak) side of an identifying relationship does not participate totally. |
| `er.identifying-owner-many` | warning | An owner of an identifying relationship has cardinality 'many': one weak instance would have several owners. |
| `er.weak-ownership-cycle` | error | Weak entities identify each other in a cycle (including self-ownership). |
| `er.relationship-too-few-participants` | error | A relationship connects fewer than two participants. |
| `er.participant-missing-entity` | error | A relationship participant points at an entity that does not exist. |
| `er.relationship-key-vs-cardinality` | error | The chosen key participants of a relationship are not a superkey implied by its cardinalities. |
| `er.cardinality-label-conflict` | warning | A participant's cardinality label contradicts its maximum cardinality. |
| `er.recursive-no-roles` | info | A recursive relationship has participants without role names. |
| `er.associative-dangling` | error | An associative entity refers to a relationship that does not exist. |
| `er.associative-duplicate` | error | Two entities claim to be the associative entity of the same relationship. |
| `er.associative-weak` | error | An associative entity is also marked weak. |
| `er.associative-identifying` | error | An associative entity stands for an identifying relationship. |
| `er.composite-single-child` | info | A composite attribute has only one sub-attribute. |
| `er.derived-no-source` | info | A derived attribute does not say which attributes it is computed from. |
| `er.one-to-one-ambiguous-placement` | info | A 1:1 relationship has no total side, so the foreign key can go on either side. |
| `er.nary-multiple-keys` | info | An n-ary relationship has several 'one' participants, so several candidate keys are implied. |
| `er.total-on-one-side` | info | Total participation on the 'one' side of a 1:N relationship cannot be enforced by foreign keys. |
| `rel.relation-name-empty` | error | A relation has an empty name. |
| `rel.column-name-empty` | error | A column has an empty name. |
| `rel.relation-name-duplicate` | error | Two relations in the same schema have the same name (case-insensitive). |
| `rel.column-name-duplicate` | error | Two columns of one relation have the same name (case-insensitive). |
| `rel.no-primary-key` | error | A relation has no primary key and no NOT NULL UNIQUE candidate key. |
| `rel.no-primary-key-candidate` | info | No primary key, but a NOT NULL UNIQUE (or unique index) candidate key exists: valid SQL, recommend promoting it. |
| `rel.key-column-missing` | error | A primary key, UNIQUE constraint or index lists a column that does not belong to the relation. |
| `rel.pk-nullable` | error | A primary-key column is nullable. |
| `rel.fk-relation-missing` | error | A foreign key references a relation that does not exist. |
| `rel.fk-no-columns` | error | A foreign key has no column pairs. |
| `rel.fk-column-missing` | error | A foreign key pair references a column that no longer exists. |
| `rel.fk-column-wrong-relation` | error | A foreign key pair uses a column that belongs to a different relation than the one it should come from. |
| `rel.fk-target-not-key` | error | A foreign key references columns that are neither the primary key nor a UNIQUE key of the target (e.g. an incomplete composite key). |
| `rel.fk-type-mismatch` | warning | A foreign key pair joins columns of clearly incompatible data types. |
| `rel.fk-total-but-nullable` | warning | A foreign key is meant to be mandatory (stated parentMin=1 or a total ER participant) but a column allows NULL. |
| `rel.fk-set-null-not-null` | error | A foreign key uses 'SET NULL' but one of its columns is NOT NULL. |
| `rel.fk-not-null-cycle` | warning | Relations reference each other through NOT NULL foreign keys in a cycle, so no first row can be inserted. |
| `rel.self-reference-not-null` | info | A self-referencing foreign key is NOT NULL, so the first row cannot be inserted. |
| `rel.fk-duplicate` | info | Two foreign keys are identical. |

Notes on specific rules:

* `rel.fk-target-not-key` fires only when `!fkReferencesKey`. The headline case (an incomplete composite key) names the
  missing key columns: `... only part of the key (CompanyName, TradeName). The missing key column(s): TradeName.`
* `rel.fk-total-but-nullable` fires when `fkCardinality(...).stated` contains `parentMin` with value 1, or (when parentMin is
  not stated) when the FK's `Origin.sources` holder-side participant is `total` in an ER model of the project. Dangling
  Origins are ignored (HISTORICAL data). An optional FK with nothing stated is never flagged.
* `rel.fk-not-null-cycle` finds strongly connected groups (>= 2 relations) over NOT NULL FKs; a self-reference is reported
  separately and only as `info` (`rel.self-reference-not-null`).
* `er.weak-primary-key` and `er.key-on-subattribute` are warnings (not errors) because types.ts documents them as such: the
  converter handles them deterministically.
* `er.identifying-partial` is an error: a weak entity cannot exist without its owner, so partial participation contradicts
  the definition (the ops set `total` automatically; imported/hand-edited files can violate it).

## Tests

`npx vitest run src/validation` - rule tests with positive and negative cases (`erRules.test.ts`, `relRules.test.ts`), the
pharmacy example plus mutated copies that each yield exactly the expected codes (`index.test.ts`), sorting / filtering /
determinism / helpers, and a seeded fuzz of corrupted projects (`robustness.test.ts`). `fixtures.ts` holds the pharmacy
fixtures and `check()` (validates a frozen copy and asserts every issue is clickable on its diagram); it is test support,
not public API.

## Review-fix notes

* FK-structure issues (`rel.fk-column-missing`, `-wrong-relation`, `-no-columns`, `-target-not-key`) always name both relations
  plus every surviving pair column: the FK edge alone is not drawn when a column is gone. `fixtures.check()` counts only edges the
  scene draws.
* Defensive reads: records are looked up with own-key lookups (`util.lookup`) and optional array/string fields are coerced
  (`arrayOf`, `typeof` guards), so hand-edited files that pass the structural loader cannot crash validation.
* Determinism: duplicate groups and identification cycles are sorted by `(name, id)` (cycle members are listed sorted, not in
  path order); no title/param/affected order depends on record key order.
* `rel.fk-total-but-nullable` reads the ER participant only for FK-on-entity origins (`one-to-many-fk`, `one-to-one-fk`,
  `recursive-one-to-many-fk`); FK columns of relationship relations are flagged on their own grounds.
* int/numeric families are treated as compatible in `rel.fk-type-mismatch`.
* Performance: iterative Tarjan; ER rules share a per-pass attribute index and `identificationOrder` result (cleared at the start of each
  `validateModel`). Remaining super-linear cost lives in model/erSemantics (`identificationOrder`, `weakEntityOwners`).
