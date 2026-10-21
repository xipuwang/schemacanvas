/**
 * Domain command layer. Every op is a plain function that MUTATES an immer draft `Project` (first parameter) and is meant
 * to be called inside `store.commit(label, (draft) => { ... })`. Semantic ops take the model id second and END with
 * `syncModelDiagrams(draft, modelId)` (via `commitSync`), so every diagram of the model stays consistent. Ops throw `OpError`
 * (a thrown recipe discards the whole commit) when a precondition fails, never leaving a half-applied state.
 *
 * ---------------------------------------------------------------------------------------------------------------------
 * Ops contract — cascade table (normative, ARCHITECTURE 5a)
 * ---------------------------------------------------------------------------------------------------------------------
 * Ops mutate an immer draft `Project`, never set `updatedAt`, never reorder `participants`, clear `cardinalityLabel` when `max`
 * changes, set `participation: 'total'` on the identified participant when a relationship becomes identifying, and END with
 * `syncModelDiagrams(draft, modelId)`. Create-ops accept optional caller-supplied ids and return
 * `{ refs: SemanticRef[]; nodeIds: Record<diagramId, Id[]> }` (the store keeps results in a closure — a recipe must return
 * `undefined` or immer throws).
 *
 * * `deleteColumn`: remove from `primaryKey`; remove from every unique/index (delete those that become empty); for each FK with a pair
 *   touching the column remove that pair and delete the FK only when 0 pairs remain (a partial composite FK stays; validation reports
 *   it); delete `columnWidths[colId]` everywhere. Adding a column to the PK sets `nullable=false`; removing it leaves `nullable`.
 * * `deleteRelation`: delete every FK whose source or target it is. `deleteModel`: delete its diagrams (+ order entries); keep ConversionRecords.
 * * `deleteEntity`: delete its attribute subtree; remove its participants from relationships and from `keyParticipantIds`; KEEP relationships
 *   left with < 2 participants (soft state). `deleteRelationship`: delete its attribute subtree; clear `associativeOf` pointing at it.
 *   `deleteAttribute`: delete the subtree; remove the id from others' `derivedFrom`.
 * * `deleteDiagram` never touches semantics. The editor's Delete key = semantic delete; "Remove from diagram" (context menu) is the
 *   presentation-only `removeFromDiagram(draft, diagramId, nodeIds)` which sets `diagram.partial = true`.
 * * Renames and reorders never touch refs.
 *
 * Name mapping (the table uses the architecture's words): deleteColumn = `removeColumn`, deleteRelation = `removeRelation`,
 * deleteEntity = `removeEntity`, deleteRelationship = `removeRelationship`, deleteAttribute = `removeAttribute`,
 * deleteDiagram = `removeDiagram`, deleteModel = `removeModel`.
 * ---------------------------------------------------------------------------------------------------------------------
 *
 * Families: er.ts (Chen), relational.ts, diagram.ts (presentation), conversion.ts (applyConversionResult), clipboard.ts.
 * Invariants live in `model/invariants.ts` (`checkInvariants`, `repairPresentation`).
 */
export { OpError } from './common';
export type { OpErrorCode, OpResult, PlaceAt } from './common';

export * from './er';
export * from './relational';
export * from './diagram';
export * from './conversion';
export * from './clipboard';
export * from './importModel';
