# src/model/ops: the domain command layer

Every interactive edit, importer and the converter-applier goes through these functions. They are the only
code that mutates semantic models (ARCHITECTURE rule 7).

```ts
store.commit('Add entity', (draft) => {
  ops.addEntity(draft, modelId, { name: 'Student' }, { diagramId, x: 120, y: 80 });
});                                   // a recipe must return undefined: keep results in a closure
```

## Conventions

* **Draft in, mutate, sync.** First parameter is an immer draft `Project`; semantic ops take `modelId` second and end
  with `commitSync` (= `syncModelDiagrams` + `pruneStaleBranchAnchors`), so every diagram of the model is
  complete and edge-consistent. Ops never set `updatedAt`, never reorder `participants`.
* **Failure = throw `OpError`** (`code`: `not-found | wrong-kind | invalid | id-in-use | cycle | foreign-key-invalid |
  paste-kind-mismatch`). Inside `commit` a throw discards the whole edit; validate before mutating is NOT required
  by callers. Soft model states (FK to a non-key, no PK, relationship with < 2 participants) are never refused.
* **Create-ops** accept optional caller ids (refused if already used anywhere in the project) and return
  `OpResult = { refs: SemanticRef[]; nodeIds: Record<diagramId, Id[]> }`; `nodeIds` = nodes this op added to each
  diagram of the model. `refs[0]` is the primary element.
* **Placement**: `addEntity | addAttribute | addRelationship | addRelation` take `place?: { diagramId, x, y }`.
  x/y are the **bounds origin** (ARCHITECTURE rule 11). Only that diagram gets the position; other diagrams of the
  model get provisional nodes from sync. A *partial* target diagram gets the node explicitly.
* **Patches**: in `update*` ops a key present with value `undefined` clears an optional field; an absent key is left
  alone. Required fields (`name`, `weak`, ...) ignore `undefined`.
* New nodes get `zIndex = max + 1`; `bringToFront`/`sendToBack` keep relative order (back may go negative).
* Locked nodes are skipped by `setNodePositions` / `moveNodesBy` unless `{ includeLocked: true }`.

## Exports (`ops/index.ts`; its header holds the cascade table verbatim)

| Family | Functions |
|---|---|
| ER (`er.ts`) | `addEntity updateEntity removeEntity` `addAttribute updateAttribute reorderAttribute moveAttribute removeAttribute` `addRelationship updateRelationship setIdentifying removeRelationship` `addParticipant updateParticipant removeParticipant` `makeAssociative clearAssociative` |
| Relational (`relational.ts`) | `addRelation updateRelation removeRelation` `addColumn updateColumn reorderColumn removeColumn` `setPrimaryKey setColumnUnique addUnique updateUnique removeUnique addIndex updateIndex removeIndex addCheck removeCheck` `addForeignKey updateForeignKey removeForeignKey createFkColumns` |
| Diagram (`diagram.ts`) | `createDiagram removeDiagram removeModel renameDiagram setDiagramOptions` `setNodePositions moveNodesBy setNodeSize setNodeStyle setColumnWidth setNodeLocked bringToFront sendToBack` `setEdgeRoute resetEdgeRoute setEdgeStyle setEdgeLabelVisible setEdgeLabelOffset` `removeFromDiagram showInDiagram` |
| Conversion (`conversion.ts`) | `applyConversionResult(draft, result, { positions?, replaceModelId? }) -> ApplyConversionReport` |
| Clipboard (`clipboard.ts`) | `ClipboardPayload extractClipboard remapIds pasteClipboard duplicateNodes` |

Semantics worth knowing:

* **Identifying**: `setIdentifying(on)` makes the identified participant `total`; the `identified` flag is stored only
  when the weak-entity rule alone cannot single it out (pass `identifiedParticipantId` to choose). Turning it off clears
  all flags. Associative relationships cannot be identifying.
* **Participants**: `updateParticipant` clears `cardinalityLabel` only when `max` actually changes (a label passed in
  the same patch wins).
* **Associative entities**: `makeAssociative` creates the entity, moves R's attributes to it and lets it take over R's
  node position. `clearAssociative` removes the entity (attributes go back to R, its other participations disappear
  with it), or with `{ keepEntity: true }` just demotes it.
* **Columns**: PK columns are always NOT NULL (`setPrimaryKey` forces it; `updateColumn({nullable:true})` on a PK
  column is coerced to false). `removeColumn` follows the cascade table; checks mentioning the column are deleted.
* **Foreign keys**: composite = ONE FK with ordered pairs. `addForeignKey` throws `foreign-key-invalid` unless both
  relations exist in the model, every column belongs to the right relation, and no column repeats per side.
  `createFkColumns` copies ONLY the target `dataType`; feed its `pairs` to `addForeignKey`.
* **Moving nodes and manual routes**: `moveNodesBy` / `setNodePositions` translate the stored waypoints of every MANUAL-route edge whose BOTH
  endpoints move by the same delta (group drag, nudge, an edge on one node); an edge with one fixed endpoint or endpoints moving by different
  deltas (auto-layout) keeps its waypoints, which are absolute world corners. Label offsets are relative and never change.
* **Edge routes** only store mode/bends/anchor preferences; `branchAnchors` keys must be source columns of the FK and
  are pruned automatically when a pair disappears.
* **`applyConversionResult`**: default adds model + record + `relational-schema` diagram (positions keyed by node id
  OR relation id). With `replaceModelId` the old model keeps its id; nodes/routes/column widths of reused ids survive,
  vanished ones are pruned, new relations get nodes (positioned from `positions`), and hand-added elements (no
  `origin`) are carried over. The report lists `kept` / `dropped`, and the stored record gets
  `conv.hand-added-kept` (info) / `conv.hand-added-dropped` (warning) issues.
* **Clipboard**: payload is plain JSON. Paste remaps every id (incl. FK pairs, `primaryKey`, `keyParticipantIds`,
  `derivedFrom`, `associativeOf`, attribute owners, `columnWidths`/`branchAnchors` keys), strips `origin` and
  `locked`, suffixes colliding relation/constraint names (`_2`...), and refuses a different model kind
  (`paste-kind-mismatch`). References to elements outside the payload survive only when pasting into the same model
  and the target still exists (otherwise the participant/attribute is dropped; a relationship that loses all
  participants is dropped). FKs are copied only when both relations are copied. Templates use the same path.

## Invariants (`src/model/invariants.ts`)

`checkInvariants(project)` returns the HARD violations (structural vs presentation, codes in the file);
`repairPresentation(project)` fixes only presentation ones (dangling/duplicate nodes and edges, missing option blocks,
`columnWidths` keys, `diagramOrder`), idempotently, never touching models, and never adding nodes/edges.
`forEachId` and `nodeKindsFor` are exported helpers.

## Testing

`testUtils.ts`: `run(project, fn)` freezes the input, applies `fn` through immer and asserts
`checkInvariants(p) == []` plus "every diagram is a fixed point of `syncDiagram`" (complete, no strays).
`random.test.ts` runs seeded 300-op sequences (ER and relational, two diagrams per model).
Run: `npx vitest run src/model/ops src/model/invariants.test.ts`.
