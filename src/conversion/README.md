# src/conversion — ER → relational engine

```ts
import { convertErToRelational } from '@/conversion';

convertErToRelational(project, erModelId, options?: Partial<ConversionOptions>,
                      env?: { now?: string; previous?: RelationalModel }): ConversionResult
```

PURE: never mutates `project` (tests pass deeply frozen projects), never touches a store. Returns
`{ relationalModel, record, diagram }` (types in `src/model/types.ts`). The caller inserts the result with
`ops.applyConversionResult` and sets `record.previousConversionId`. `relationalModel.id` and `record.id` are always fresh;
`derivedFrom` is set; `diagram = createDiagramForModel(model, 'relational-schema')` (one node per relation, one edge per FK;
a composite FK is ONE edge). `createdAt = env.now ?? nowIso()`. Throws if `erModelId` is not an ER model of the project.

All ER facts come from `model/erSemantics` (identification order, candidate keys, `analyzeRelationship`); nothing is re-derived.

## Files

| File | Role |
|---|---|
| `convert.ts` | entry point, input normalisation (sort by name/id so output is independent of Record order), trace safety net |
| `context.ts` | `Ctx`: id reuse, naming collisions, trace/decisions/warnings, `addColumn/addUnique/addForeignKey`, key propagation (`propagateKey` = the documented naming rule) |
| `merge.ts` | pre-pass resolving every binary 1:1 (fk / relation / merge) |
| `entities.ts` | strong, weak (multi-owner, chains, cycles), merged and associative entities; lazy `buildEntity` |
| `attributes.ts`, `multivalued.ts` | attribute to column rules (composite flatten, derived omit/materialise, keys), multivalued relations |
| `relationships.ts`, `shared.ts` | FK folding (1:N, 1:1), identifying relationships, relationship relations (M:N, n-ary, 1:1/1:N on request), key selection |
| `fixtures.ts`, `testkit.ts` | test-only helpers (spec examples A and E, a kitchen-sink model; `run`, `rel`, `fkList`, ...) |

## Rules (what the tests pin down)

* **Phases**: entities (owners first) then relationships then multivalued relations (last: their host keys must be final).
* **Column order** in an entity relation: owner FK columns, key attributes, other attributes, then FK columns / relationship
  attributes appended by relationships. PK columns are always NOT NULL. Attributes are NOT NULL unless `optional`.
* **Naming**: a propagated column keeps its name; otherwise `Pascal(role ?? entity) + Pascal(key attr)`; `columnPrefixes[participantId]`
  (`''` allowed) gives `prefix + key attribute name`; `columnNames[origin.key]` overrides last. Collision: `<name>_<Role|Entity>`, then
  `_2`, `_3` (recorded as a decision). Relations: `_2`, `_3`. Multivalued relation: `Owner_Attr`. Merged 1:1: `Primary_Other`.
  Composite-leaf collision: `ParentLeaf`; attribute vs. owner collision: `OwnerAttr`.
* **Weak entity**: PK = every owner's full PK (relationship/participant order) + partial (or `primary`) attributes; one composite FK per
  owner; the identifying relationship gets no table (its attributes land on the weak relation). Cycles (incl. self-ownership) are cut:
  relation without the cyclic owner part + decision + `conv.weak-ownership-cycle`.
* **1:N / recursive 1:N**: FK in the *many* participant's relation referencing the *one* participant's key; nullable unless the many
  side is total; one-side total gives `fk.cardinality.childMin = 1` + `conv.total-on-one-side-unenforceable`. Relationship attributes go
  to the many side (nullable when the FK is). A key-flagged relationship attribute is ignored (`conv.relationship-key-attr-folded`).
* **1:1** (`options.oneToOne`, per-relationship `relationshipOverrides`; `fkParticipantId` wins, then `asRelation`): `auto` = FK on the
  total side (NOT NULL + UNIQUE); both total = FK on the first participant + `conv.one-to-one-both-total`; neither = nullable UNIQUE FK
  on the first + `conv.one-to-one-ambiguous-placement`. `merge` (pairwise, plain strong entities only, else FK +
  `conv.one-to-one-merge-ineligible`): one relation `Primary_Other` keyed by the *partially* participating side (so no instance is lost),
  the other key becomes UNIQUE, partner columns are nullable unless the primary side is total; both partial gives
  `conv.one-to-one-merge-lossy`. `relation` = separate relation (PK = first candidate key, the other becomes UNIQUE).
* **M:N / n-ary**: own relation, FK per participant (all NOT NULL, composite FK = one `ForeignKey`), PK = chosen key participants' FKs
  (`keyParticipantIds` when it is a superkey, else the first candidate key + `conv.relationship-key-fallback`) + relationship `primary`
  attributes; other candidate keys become UNIQUE. Total participation gives `fk.cardinality.childMin = 1` +
  `conv.total-participation-unenforceable` (info).
* **Associative entity**: exactly one relation: FK per participant of its relationship + the entity's (and relationship's) attributes;
  PK = own key attributes (every candidate key becomes UNIQUE), else the chosen key.
* **Derived**: omitted (trace `targets: []` + decision) unless in `materializeDerived`. **Multivalued** (also composite, also nested):
  own relation, owner key as ONE FK, PK = owner key + all value columns.
* Every generated relation/column/unique/FK has `origin {ruleId, sources, key}`; keys are built from source ids only, which is what
  `env.previous` id reuse matches on.
* `record.warnings` are `conv.*` only; structural ER problems stay with validation (`er.*`). `record.decisions` carries the English
  explanations (`level: 'warning'` where the user should look).

## Known limits

* A participant whose entity has no key gets no FK (decision only, no `conv` warning).
* Merge groups are pairwise; an entity can be merged through at most one 1:1 relationship.
* A relationship-owned multivalued attribute of an FK-folded relationship references the holder entity's key.
* Only `dataType` is copied to columns (never autoIncrement/defaultValue); no type mapping between dialects.

## Review-fix rules

* Merged 1:1 partner (primary side partial): FK columns and relationship attributes added to the partner's columns by other relationships are nullable too (`EntityInfo.optionalPartner`).
* Multivalued attribute: optional leaves stay nullable and outside the PK when a required leaf exists (`conv.multivalued-optional-leaf`, info); with no required leaf all leaves key the relation.
* Competing 1:1 merges: relationships with a total side (lossless) are merged first, independent of names.
* Relationship relation with a keyless key participant gets no PK (decision at warning level) instead of a shrunken one.
* `conv.total-on-one-side-unenforceable` is `info`; recursive-FK explanations use role names.

## Messages and translation

`codes.ts` lists every warning code (`CONV_WARNING_CODES`) and decision kind (`DECISION_KINDS`); `Ctx.warn()` / `Ctx.decide()` are typed
with them. Every decision carries `params` (the values its English text was built from; `params.kind` selects the catalogue entry when
several decisions share a `ruleId`) and every warning carries `params`, so `src/i18n` can translate them (`localizeDecision`,
`localizeIssue`; see `src/i18n/README.md`). The English text is unchanged.
