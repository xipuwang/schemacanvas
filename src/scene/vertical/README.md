# scene/vertical + render/vertical

Crow's Foot ERD (`crows-foot`) and the physical model (`physical`) on a `RelationalModel`. One builder serves both
(`buildVerticalScene`, registered in `scene/registry.ts`); views register on `import '@/render/vertical'`
(`v-table`, `v-fk`). Geometry-only: every symbol, badge and mark is explicit lines/circles/text (no SVG markers).

## Public API
* `buildVerticalScene(input)`: `SceneBuilder`; emits `VTableGeom` (`kind:'v-table'`) and `VFkEdgeGeom` (`kind:'v-fk'`), types in `types.ts`.
* `childSymbolKind / parentSymbolKind / buildSymbol / SYMBOL_LENGTH` (`symbols.ts`), `VERTICAL_CONSTANTS`.
* `fixtures.ts`: `pharmacyVFixture(type, orientation)`, `cardinalityFixture(type, orientation)` (tests + visual).
* DOM hooks: row/cell `data-column-id` + `data-role`; FK group `data-fk-branch` (attached source column),
  `data-fk-target`, `data-fk-pairs` (`s>t,...`), `data-fk-composite`; symbols `data-symbol="parent|child:<kind>"`;
  composite dots `data-fk-member=<columnId>`; sections `data-section`.

## Tables
* **Vertical** (crow's foot `orientation:'vertical'` and always physical): header (relation name; physical: `schema.name`), then ONE row per
  column in MODEL order (PKs are not grouped). Row = key gutter (`PK` / `FK` / `PK FK` badge) | name | type (right aligned) | `NN UQ` markers.
  Encodings (grayscale safe, same as the horizontal schema): PK = underlined name + key tint, FK = italic + FK tint, PK+FK = both + diagonal two-tone.
  Crow's foot: type only with `showTypes`; markers only with `showNullability` (`NN` only when not implied by the PK, `UQ` for single-column
  unique constraints/indexes unless the column is the sole PK column). Physical always shows type, `NN`, `UQ`, `AI` (auto-increment) and `DEFAULT <expr>`.
* **Physical sections** (below the columns, option-gated): constraints (`UNIQUE (cols)`, `CHECK expr`, `FK (src) -> Target(tgt)` with
  `ON DELETE/UPDATE` flags; FKs ordered by (name,id)) when `showConstraints`; indexes (`name (cols [DESC])` + flags `UNIQUE`, `partial`, method) when `showIndexes`.
  Long text is ellipsised (cap 560px) - the table is as wide as the text it draws.
* **Horizontal** (crow's foot `orientation:'horizontal'`): name above ONE row of bordered cells (like the horizontal schema); line 2 of a cell =
  type + markers. Cells grow to the text; `DiagramNode.columnWidths` may only grow a cell.
* `node.width` / `node.height` are MINIMUM table size (vertical: surplus height is spread over the column rows; horizontal: `height` = row height,
  `width` = minimum row width). `NodeStyle` fontFamily/fontSize/fontWeight/strokeWidth change geometry; fill/stroke/textColor are applied by the view.
  `columnWidths` is ignored in the vertical orientation.
* `node.x/y === bounds.x/y`; `paintBounds` covers strokes and labels.

## Connectors (`v-fk`)
* One edge per FK, even for composite FKs: ONE symbol pair, attached at the FIRST resolvable column pair. The other pairs' rows are marked by a dot
  just outside the border (`memberMarks`) joined to the attached row by a thin bus (`memberLinks`); there are NO per-column branches in this family.
* Vertical tables: ends sit on the LEFT/RIGHT side of the exact row (source = FK row, target = referenced key row); horizontal: TOP/BOTTOM border of the
  exact cell (top borders avoid the relation name). Several ends on one row side are spread (>= 9px apart) inside the row; an explicit `AnchorSpec.offset`
  is clamped inside its own row. Invalid sides (top/bottom for vertical tables, ...) are coerced + `anchor-coerced:<edge>:<end>:<side>` warning.
* Routing: `routeOrthogonal` with every table as obstacle and a keep-out strip in front of every foreign symbol; `routing:'straight'` = stub + line + stub
  (rerouted around foreign tables). Manual routes (`route.mode='manual'`) pass waypoints through; `autoWaypoints` reproduces the auto route exactly.
  Collinear overlaps between connectors (aligned tables) are repaired by sliding ONE end along its own row (bounded; skipped above 80 edges).
* Symbols derive ONLY from `queries.fkCardinality(model, fk)`: PARENT end `exactly-one` (`||`) when parentMin=1 else `zero-or-one` (`o|`);
  CHILD end childMax `many` -> `zero-or-many` (`o{`, childMin 0) / `one-or-many` (`|{`, childMin 1); childMax `one` -> `exactly-one` / `zero-or-one` by childMin.
  `VFkEdgeGeom.childSymbol/parentSymbol/cardinality` expose kinds + which fields were stated for tooltips. The connector is stroked between the symbols'
  `base` points (`strokePoints`); symbols shrink (>= 50%) when the end segment is short.
* Optional label: `edge.labelVisible === true` -> `fk.label` or `describeForeignKey`; draggable via `labelOffsets.main`.
* Warnings: `non-relational-model:`, `missing-relation:`, `duplicate-relation-node:`, `unsupported-edge:`, `dangling-fk-edge:`, `fk-column-missing:<fk>:<i>`, `anchor-coerced:`.

## Known limits
* More than ~3 connectors on one row side overlap their symbols (spacing is capped by the row height).
* Connectors may run close to tables when tables are packed tighter than ~40px; labels then fall back to a spot beside the line.
* Visual check: `VISUAL=1 npx vitest run src/render/vertical/visual` then `node harness/crows/check.mjs` (real Chromium: nothing clipped, text fits rows).

## Draft quality (additive, see ../draft.ts)

`SceneBuildInput.quality: 'draft'` + `previous` (a full scene with its diagram / model): untouched edges are reused by identity and the
others get cheap provisional vertical geometry (no router); `quality` omitted or `'full'` is byte identical to before. Used by the canvas
only while a drag transaction is open; tests in `../draft.test.ts`.
