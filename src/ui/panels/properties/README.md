# Properties panel and diagram-options dialog

`registerPanel('properties', PropertiesPanel)` and `registerDialog('diagram-options', DiagramOptionsDialog)` are in `index.ts`.

## Routing (`PropertiesPanel.tsx`)

| Selection | Form |
|---|---|
| nothing | `DiagramForm`: name, notation, model name / dialect, counts, grid, typography, notation options (`ops.setDiagramOptions`) |
| entity node | `EntityPanel`: name, weak, description, associative, attribute list |
| attribute node / attribute link | `AttributePanel`: key kind, multivalued, derived (+ derivedFrom), optional, data type, owner link, sub-attributes (+ route editor for a link) |
| relationship node | `RelationshipEditor`: identifying (+ identified participant), participants table, derived cardinality sentences, key participants, attributes, make associative |
| participation line | `ParticipantPanel` + `EdgeRouteSection` |
| table node | `RelationPanel`: columns, primary key order, foreign keys (composite editor), referenced by, uniques, indexes, checks |
| table cell (`selection.sub`) | `ColumnPanel` (focused column editor, cell width) |
| FK connector | `FkPanel`: constraint editor + `EdgeRouteSection` (mode, anchors, bends, label, stroke) |
| 2+ elements | `MultiPanel`: align / distribute / match size / order / lock buttons (commands) + shared style |
| any single node | `NodeStyleSection` (fill, stroke, text, font, size, width/height) |

The header speaks the notation (docs/DESIGN.md): a relation is a live miniature single-row table (`Header.tsx`, PK underline + amber, FK italic + sky, PK+FK both, via tokens); Chen
elements show a glyph drawn by the same preview builders as the library.

## Rules

* **Every edit is `runEdit(label, draft => ops...)`** (`edit.ts`) = one `store.commit` = one undo step. An op that throws (`OpError`) discards the commit, leaves the project unchanged and shows
  the message inline (`role=alert`); the field reverts. Text fields commit on blur / Enter (`CommitInput`), Escape reverts; the native colour picker commits once when it closes (`ColorControl`).
* **Pure form logic lives in `forms.ts`** (unit-tested): PK toggling, FK pair mapping with swap semantics (a column may appear once per side, so picking a used column swaps), pair
  defaults by name, effect sentences, identified-participant choice, key participants. Composite FKs are always ONE `ForeignKey` with ordered pairs.
* The referenced table of an existing FK is read-only (the op refuses to change it). "Create columns and key" runs `createFkColumns` + `addForeignKey` in one commit.
* Issue badges (`IssueBadges`, `IssueDot`) read `uiStore.issues` with `groupByAffected({rollUp:true})`, localize with `localizeIssue`; clicking one focuses it and opens the issues dock.
* New attributes are placed beside their owner (`placement.ts`, same `placeNear` as canvas creation).
* No op exists for model name / dialect: `DiagramForm.setModelMeta` is a one-field recipe inside a normal commit.

## Files

`PropertiesPanel` router, `DiagramForm` (+ dialog), `ErPanels` + `AttributeList`, `RelationPanel` + `ColumnForms` + `ConstraintForms` + `FkForms`, `EdgePanels`, `StyleForms`, `Header`, `parts` (atoms),
`edit`, `forms`, `nav`, `placement`, `properties.css`. Strings: `src/i18n/messages/panels-properties.ts` (namespace `properties`, en + zh).

## Tests

`npx vitest run src/ui/panels/properties` (forms logic, jsdom panel edits asserting the PROJECT result via ops, i18n key coverage); e2e: `E2E_PORT=5211 npx playwright test e2e/panels-a --output=.tmp/panels-a/results`.

* Registered lazily (`index.ts` uses `lazyPanel`/`lazyDock`/`lazyDialog` from `../../dialogs/content/lazy`): this panel is its own chunk, loaded right after startup (library) or on demand (issues dock, diagram options dialog) and not part of the entry bundle.
