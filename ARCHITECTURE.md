# SchemaCanvas — Architecture

Browser-based database modeling studio. React 19 + TypeScript 7 + Vite 8; **custom SVG** canvas (not React Flow);
Zustand + immer for state/undo; ELK (in a Web Worker) for auto-layout; jsPDF + svg2pdf for vector PDF; Vitest + Playwright.
Fully client-side: no backend, no accounts, no paid APIs. Setup, commands and deployment: `README.md`; test tiers: `docs/TESTING.md`.

> What the product does is described in `README.md` and `docs/USER-GUIDE.md`. This file explains *how the code is organised* and fixes the contracts
> between modules. If code and this file disagree, fix one of them in the same change.

## 1. Why custom SVG instead of React Flow

Chen notation (double rectangles, double ellipses, double diamonds, dashed underlines, double lines) and
horizontal single-row tables with **column-level connector anchors** need exact geometry. Owning the SVG means
(a) shapes are drawn exactly to notation, (b) the *same* component tree renders the canvas and the SVG/PNG/PDF
exports (they match by construction), (c) hit-testing/routing work against the same derived geometry.

## 2. Three layers (model-first)

```
 Project (plain JSON, versioned)                       src/model/types.ts   ← THE CONTRACT
 ├─ models: ErModel | RelationalModel                  LAYER 1  semantics only (ids, no pixels)
 ├─ diagrams: Diagram {nodes, edges, options}          LAYER 2  presentation (refs to semantics)
 │            node: {ref, x, y, width?, height?, style?, columnWidths?}      LAYER 3 authoring geometry
 │            edge: {ref, route{mode, waypoints, anchors}}                   (stored on node/edge)
 └─ conversions: traceable ER → relational records

 Scene (DERIVED, never persisted)                      src/scene/*          buildScene(project, diagramId)
 └─ NodeGeom / EdgeGeom: text-fitted sizes, anchors, routed polylines, resolved TextLabels
 Render (pure React → SVG)                             src/render/*         SceneSvg, renderSceneToSvgString
```

Hard rules:

1. **Semantics never contain geometry; geometry never contains semantics.** A foreign key is
   `{sourceRelationId, targetRelationId, columns:[{sourceColumnId,targetColumnId}]}`. A diagram edge only has
   `ref:{kind:'foreignKey', foreignKeyId}`. Connector endpoints are *computed* from column ids — so moving a table,
   renaming a column or reordering columns can never make an arrow point at an unrelated field.
2. **Ids are stable and opaque** (`newId('ent')`); names are never used as keys. PK/FK membership is *derived*
   (`columnRole()` in `model/queries.ts`), never stored on columns.
3. **A semantic element has at most one node per diagram.** Edges are derived from semantics
   (participants, attribute ownership, FKs) and merely carry presentation overrides (route, style).
4. **Plain JSON only** (no Map/Set/class instances/Date objects) → lossless serialisation and immer patches.
5. **Contract changes are additive** (new optional fields). Breaking changes bump `SCHEMA_VERSION` + migration.
6. **All derived geometry comes from `buildScene()`**; nobody else computes node sizes or connector paths.
7. **All semantic mutation goes through `src/model/ops`** (immer-draft functions) inside `store.commit(label, fn)`,
   so every edit is undoable, keeps diagrams consistent, and preserves invariants.
8. **Text metrics are deterministic**: `scene/measure.ts` uses Helvetica AFM tables (identical to Arial / Liberation
   Sans / jsPDF Helvetica). No canvas measuring in the default path → same scene in Node tests, browser and exports.
9. **SVG hygiene** (so SVG = PNG = PDF): concrete colours (no CSS vars) in render output; underlines are explicit
   `<line>`s, never `text-decoration`; no `dominant-baseline` (use `baselineY()`); no filters/masks/foreignObject;
   explicit `font-family` on every `<text>`; **no `<marker>`** (arrowheads are `ArrowGeom` polygons); double lines are
   two real strokes (`rails`), never a background-coloured overstroke; labels are drawn in a layer above all nodes.
10. **Edges are materialised, not invented.** Scene builders draw ONLY `diagram.edges` (skipping dangling ones with a
    `Scene.warnings` entry). `src/model/diagramSync.ts` (implemented, tested) creates/removes edges and adds missing nodes:
    `createDiagramForModel`, `syncDiagram(Nodes|Edges)`, `syncModelDiagrams`. Conversion, importers and examples MUST use it;
    every semantic op ends with `syncModelDiagrams(draft, modelId)`; `store.commit` performs no implicit sync.
11. **Node x/y = `geom.bounds` top-left, always** (bounds include e.g. the h-table's relation name, exclude strokes).
    Layout, align, distribute, snap and paste write `node.x += target.x - geom.bounds.x`. `paintBounds` (strokes, overhang) and
    edge `bounds` (arrowheads, rails, labels) feed `Scene.bounds`, which is what guarantees clip-free exports.
12. **Notation is drawn strictly from stored data, never inferred** (double rectangle ← `weak`, double line ← `participation`,
    double diamond ← `identifying`). Inconsistencies are reported by validation (`er.identifying-partial`), not hidden.
13. **Shared ER/relational interpretation lives in neutral modules**: `model/erSemantics.ts` (identification, candidate keys,
    cardinality text, near-side min/max), `model/relationalFacts.ts` (FK target key, data-type compatibility),
    `queries.fkCardinality`, `model/issues.ts`, `model/conversionRules.ts`. Nobody re-derives these.
14. **Pure modules treat inputs as deeply readonly** (the app freezes state). Test with `src/test/deepFreeze.ts`.
15. **Determinism**: timestamps via `model/clock.nowIso()`; no output may depend on Record key order — DDL/DBML/listings/
    layout input sort by `(name, id)`; ops give every new node an explicit `zIndex = max + 1`; duplicate-name checks and
    collision suffixing (`_2`, `_3`) use `sqlNameKey` / `relationNameKey`. Only `store.commit` sets `Project.updatedAt`.

## 3. Directory map

Every `src/<module>/` listed here has an `index.ts` public surface; import from the module root (`@/store`, `@/layout`, ...) rather than its internals.
Modules with their own `README.md` (API + gotchas) are marked with `(R)`.

| Path | Responsibility |
|---|---|
| `src/main.tsx`, `src/App.tsx`, `index.html` | Entry: fonts, tokens, `@/i18n`, `@/ui/register` (side-effect registration of panels/docks/dialogs/tools), `AppShell`. `index.html` carries the pre-paint theme script. |
| `src/model/types.ts` | The contract (semantic + diagram + project types, `SCHEMA_VERSION = 1`). |
| `src/model/{ids,defaults,queries,builders,clock}.ts` | Id generation, factories, read helpers (`columnRole`, `weakEntityOwners`, ...), fluent fixture builders, injectable clock. |
| `src/model/{erSemantics,relationalFacts,conversionRules,issues,diagramSync,invariants}.ts` | Shared interpretation of ER / relational semantics, closed conversion-rule vocabulary, `Issue` type, diagram sync, invariants + `repairPresentation`. |
| `src/model/ops/**` (R) | Domain commands on immer drafts: `er.ts`, `relational.ts`, `diagram.ts`, `conversion.ts` (`applyConversionResult`), `clipboard.ts`, `importModel.ts`. |
| `src/model/io/**` | Versioned JSON (de)serialisation (`serializeProject`, `parseProjectFile`, `loadProjectData`), migrations (registry empty while `SCHEMA_VERSION === 1`), structure validation. |
| `src/store/**` (R) | Zustand editor store (project, selection, tool, transactions, undo/redo, `markSaved`, `replaceProject`) and the per-browser settings store (`schemacanvas:settings:v1`). |
| `src/persistence/**` | IndexedDB key-value layer, debounced autosave, recent-project records, `.schemacanvas.json` file helpers, persistence status. |
| `src/scene/**` (R per family) | `buildScene` (`registry.ts`), geometry helpers, Helvetica text measurement (`measure.ts`), per-notation builders `chen/`, `horizontal/`, `vertical/` (also used for Crow's Foot and physical), orthogonal router `routing/`. |
| `src/render/**` (R chen) | Pure SVG React components per notation family (`chen/`, `horizontal/`, `vertical/`), `SceneSvg` / `SceneSvgCore`, `standalone*` (`renderSceneToSvgString`, loaded lazily), palettes. |
| `src/editor/**` (R) | Canvas interaction: `DiagramCanvas`, pan/zoom, hit-testing, selection, drag, `commands/` (the command registry + shortcuts), `keyboard/` (cell mode, connector keyboard editing), `tools/` (connect, FK tool, resize, route handles, attribute ports), context menu, clipboard wiring. |
| `src/ui/**` (R) | App chrome and design system: `shell/` (toolbar, sheet tabs, docks, status bar, palette, startup, project replacement), `panels/` (library, properties, issues), `dialogs/` (registry + lazy dialog content: convert, export, import, examples, SQL, recent, diagram options), `components/`, `icons/`, `theme/` (tokens), `uiStore.ts`. |
| `src/conversion/**` (R) | ER -> relational engine (rules, trace, decisions, warnings). Pure. |
| `src/validation/**` (R) | Rule-based validators (`ER_RULES`, `REL_RULES`) producing `Issue`s. |
| `src/layout/**` (R) | ELK auto-layout (worker + in-thread fallback, lazily loaded), Chen layout engine, alignment / distribution / snapping helpers. |
| `src/export/**` (R) | SVG / PNG / PDF / project-JSON export from the same scene. |
| `src/sql/**` (R) | DDL generation (PostgreSQL / SQLite / MySQL / generic), hand-written DDL parser, DBML import/export. |
| `src/examples/**` (R) | Seven examples (A-D, Pharmacy, University, Company; also correctness fixtures) with frozen layouts, and the library templates. |
| `src/i18n/**` (R) | Per-feature catalogues `messages/*.ts` (en + zh), `t()` / `useT()`, localisation of validation/conversion/SQL messages, `GLOSSARY.md`. |
| `src/integration/**` (R) | Cross-module pipeline tests (model -> store -> convert -> validate -> layout -> scene -> render -> sql); optional browser and PostgreSQL tiers. |
| `e2e/**` | Playwright specs on the real app, one folder per area, plus `acceptance/` (the product specification, section 14, as user scenarios) and `perf/` (own config). |
| `harness/**` | Small Vite pages used while developing the editor / tools / export / crows-foot in isolation. Not part of the product build. |
| `scripts/**` | `serve-static.mjs`, `bundle-size.mjs`, `svg2png.mjs`, `gen-shortcuts.mjs`, `docs-screenshots.mjs`. |
| `docs/**` | `USER-GUIDE.md`, `TESTING.md`, `SHORTCUTS.md` (generated), `DESIGN.md`, `PERFORMANCE.md`, `KNOWN-LIMITATIONS.md`, `img/`. |

## 4. Notation specifications (must be drawn exactly like this)

### Chen ER

| Concept | Rendering |
|---|---|
| Strong entity | single rectangle, centred name |
| Weak entity | **double rectangle** (outer + inset inner rectangle) |
| Associative entity | rectangle enclosing a diamond (`ErEntity.associativeOf`) |
| Simple attribute | single ellipse |
| Key attribute | ellipse, name with **solid underline** |
| Partial key | ellipse, name with **dashed underline** |
| Multivalued | **double ellipse** |
| Derived | **dashed ellipse** |
| Composite | ellipse connected to child ellipses (hierarchy); children may nest |
| Relationship | diamond; **identifying = double diamond** |
| Relationship attributes | ellipses attached to the diamond |
| Participation | **total = double line**, partial = single line (between relationship and entity) |
| Cardinality | `1` / `N` / `M`(/`P`) text next to the entity end (look-across semantics, see types.ts) |
| Roles | text at the middle of the participation line (essential for recursive relationships) |
| Recursive | two participation lines between the same entity and diamond, attached at different sides, routed so they never overlap |
| Ternary / n-ary | diamond with 3+ lines |

Lines attach where the ray from shape centre to the peer meets the outline (`boundaryPoint`).
Weak entity ↔ identifying relationship participation is total (double line).

### Horizontal relational schema (native diagram type `relational-schema`)

```
 Student                               <- relation name above the table (option: left)
 ┌─────┬───────────┬──────────┬─────┬─────┐
 │ SID │ FirstName │ LastName │ GPA │ DOB │   <- ONE row, one bordered cell per attribute
 └─────┴───────────┴──────────┴─────┴─────┘
```

* Cells: width = text + padding (min width), overridable per column (`DiagramNode.columnWidths`), row height from options.
* Optional data-type annotation (second line or inline) per `showDataTypes`.
* **PK / FK / PK+FK / plain must be distinguishable in grayscale print**: PK = solid underline (+ tint);
  FK = italic (+ different tint); PK+FK = underline **and** italic; plain = regular. Composite PK underlines every PK cell.
* **FK connector** (`FkEdgeGeom`): leaves from the border of the FK cell(s) (top or bottom edge, orthogonal), ends with
  a clear arrowhead whose tip touches the border of the *exact referenced* cell, perpendicular to it. Direction:
  referencing → referenced. Orthogonal routing with obstacle avoidance (never through other tables), anchor spreading
  when several connectors share a border, optional label (`label` or `describeForeignKey`).
* **Composite FK = one logical constraint**, one `DiagramEdge`. `compositeFkStyle: 'branches'` draws one arrow per column
  pair, each ending at *its own* target cell, visually grouped; `'bracket'` draws a bracket over the FK cells and one over
  the target key cells joined by one arrow.
* Manual routing: `route.mode='manual'` + `waypoints` (orthogonalised between bends); editable anchors via `AnchorSpec`.
  Endpoints always derive from column ids, never from stored pixels.
* **Anchors are CELL-relative** (`AnchorSpec`): side ∈ auto|top|bottom (left only on the first cell, right only on the last; anything else is
  coerced to `auto` + a `Scene.warnings` entry); `offset` runs along that cell's side and is clamped inside it, so dragging an anchor can never
  slide an arrow onto a neighbouring field. Per-branch overrides: `EdgeRoute.branchAnchors[sourceColumnId]`.
* **Arrowheads are geometry** (`ArrowGeom`): `branch.points[last] === arrow.tip` exactly, tip touches the target cell border perpendicular to it;
  strokes end at `arrow.base`. No SVG markers.
* **`bracket` style is honest or not drawn**: only when the source cells are contiguous, the target cells are contiguous and pair order matches
  left-to-right order on both sides; otherwise the FK is drawn in `branches` style and `Scene.warnings` gets `fk-bracket-fallback:<fkId>`
  (`FkEdgeGeom.style` is the style actually drawn).
* `branches` style: branches are never merged into a shared trunk; every branch keeps its own stubs to its own source and target cell.
* Node `x/y` = top-left of `bounds` **including the relation name**; `height` = this table's row height, `width` = minimum total row width.

## 5. Cross-module interfaces

```ts
// scene
buildScene(project, diagramId, measure = defaultMeasure, opts?): Scene   // src/scene/registry.ts
// render
<SceneSvg scene project diagram ctx/>                                    // src/render/SceneSvg.tsx (interactive canvas)
renderSceneToSvgString(scene, project, diagram, opts): string            // src/render/standalone.tsx (lazy; exports and thumbnails)
// ops (all MUTATE the passed draft Project; call inside store.commit)
//   see src/model/ops/index.ts for the authoritative export list
// store
useEditorStore(selector)  +  store.commit(label, (draft: Project) => void), undo(), redo()
// conversion
convertErToRelational(project, erModelId, options?, env?) → ConversionResult   // src/conversion, pure
// validation
validateProject(project, { modelId? }) → Issue[]                         // src/validation
// layout (lazy wrappers; ELK loads on first use)
autoLayout(scene, project, diagramId, opts?) → Promise<Record<nodeId, {x,y}>>   // src/layout
// export
exportDiagram(project, diagramId, 'svg'|'png'|'pdf'|'json', options?) → Promise<ExportResult>   // src/export
// sql
generateDdl(relationalModel, dialect, opts?), ddlIssues(...), parseDdl / parseDdlSafe, exportDbml / importDbml   // src/sql
// examples
EXAMPLES: ExampleDefinition[]; buildExample(id): Project; TEMPLATES; insertTemplate(...)           // src/examples
```

The ops, the store and the editor are documented by what they actually export: read `src/model/ops/index.ts` and `src/store/index.ts`
rather than assuming signatures.

### 5a. Ops contract (`src/model/ops`) — cascade table (normative)

Ops mutate an immer draft `Project`, never set `updatedAt`, never reorder `participants`, clear `cardinalityLabel` when `max`
changes, set `participation: 'total'` on the identified participant when a relationship becomes identifying, and END with
`syncModelDiagrams(draft, modelId)`. Create-ops accept optional caller-supplied ids and return
`{ refs: SemanticRef[]; nodeIds: Record<diagramId, Id[]> }` (the store keeps results in a closure — a recipe must return
`undefined` or immer throws).

* `removeColumn`: remove from `primaryKey`; remove from every unique/index (delete those that become empty); for each FK with a pair
  touching the column remove that pair and delete the FK only when 0 pairs remain (a partial composite FK stays; validation reports
  it); delete `columnWidths[colId]` everywhere. Adding a column to the PK sets `nullable=false`; removing it leaves `nullable`.
* `removeRelation`: delete every FK whose source or target it is. `removeModel`: delete its diagrams (+ order entries); keep ConversionRecords.
* `removeEntity`: delete its attribute subtree; remove its participants from relationships and from `keyParticipantIds`; KEEP relationships
  left with < 2 participants (soft state). `removeRelationship`: delete its attribute subtree; clear `associativeOf` pointing at it.
  `removeAttribute`: delete the subtree; remove the id from others' `derivedFrom`.
* `removeDiagram` never touches semantics. The editor's Delete key = semantic delete; "Remove from diagram" (context menu) is the
  presentation-only `removeFromDiagram(draft, diagramId, nodeIds)` which sets `diagram.partial = true`.
* Renames and reorders never touch refs.

### 5b. Store contract (`src/store`)

```ts
commit<T>(label: string, fn: (draft: Project) => T, opts?: { select?: Id[] }): T   // sets updatedAt INSIDE the recipe, so undo restores it
beginTransaction(label: string): void
updateTransaction(fn: (draft: Project) => void): void   // applied live, no history entry
endTransaction(): void                                   // ONE history entry with the merged patches
cancelTransaction(): void                                // applies the accumulated inverse patches (Esc during a drag)
setViewState(diagramId: Id, viewport: Viewport): void    // writes diagrams[id].viewport WITHOUT history; still autosaved
undo(): void; redo(): void
replaceProject(project: Project, label?: string): void   // swaps the whole project (history cleared); the UI goes through ui/shell/replace.ts
markSaved(savedAt?: string, project?: Project): void     // autosave / explicit save report success; drives the dirty flag
```
History entry `{label, patches, inversePatches, selectionBefore: Id[], selectionAfter: Id[]}`; after undo/redo the selection is the stored
list filtered to ids that still exist. Selection state = `{ ids: Id[]; sub?: SemanticRef }`.

### 5c. File format (`src/model/io`)

```ts
type LoadError = { code: 'not-json'|'wrong-format'|'newer-version'|'unsupported-version'|'invalid-structure'; message: string; path?: string }
type LoadResult = { ok: true; project: Project; migratedFrom?: number; repairs: string[] } | { ok: false; error: LoadError }
serializeProject(p, savedAt?): string          // ProjectFile JSON
parseProjectFile(text): LoadResult
loadProjectData(raw: unknown): LoadResult      // SAME path for IndexedDB records (they store the ProjectFile envelope)
migrations: Record<number, (raw: unknown) => unknown>   // n → n+1, pure, on raw JSON
```
`ProjectFile.schemaVersion` is authoritative; a newer version is rejected (`newer-version`). Structure check validates required fields/types only
and PRESERVES UNKNOWN PROPERTIES verbatim (never strip — other modules add optional fields); then missing option blocks are filled from
`defaultDiagramOptions` and `repairPresentation` runs. Semantic problems are never rejected or repaired.

### 5d. Clipboard (`src/model/ops/clipboard`)

`extractClipboard(project, diagramId, nodeIds) → ClipboardPayload` (self-contained: attribute subtrees of copied owners; relationships/FKs when
their endpoints are copied) and `pasteClipboard(draft, diagramId, payload, offset) → { nodeIds, idMap }` remap EVERY id-bearing field (nested ids,
`primaryKey`, FK pairs, `keyParticipantIds`, `derivedFrom`, `associativeOf`, attribute owner, `columnWidths` keys, edge refs), strip `origin`, paste only
into the same model kind; references outside the payload survive only when pasting into the same model and the target still exists. Templates use the same path.

### 5e. Conversion API

```ts
convertErToRelational(project: Readonly<Project>, erModelId: Id, options?: Partial<ConversionOptions>,
                      env?: { now?: string; previous?: RelationalModel }): ConversionResult   // PURE (see types.ts)
ops.applyConversionResult(draft, result, opts?: { positions?: Record<Id, Point>; replaceModelId?: Id }): void
```
Converting ALWAYS adds a NEW relational model + `relational-schema` diagram in one undoable commit; with `replaceModelId`, element ids are reused where
`Origin.key` matches `env.previous` (positions/routes survive) and hand-added elements are kept and reported. The caller runs `buildScene` +
`autoLayout` on a temporary project and passes `positions`.

## 6. Testing & verification

Full description of the tiers, commands and how to read failures: `docs/TESTING.md`. In short:

* Unit: `npx vitest run <path>`; `*.test.ts(x)` are co-located with the code (jsdom tests opt in with a `// @vitest-environment jsdom` docblock).
  Conversion/validation/scene logic have example-driven tests derived from the spec's Examples A-E.
* **Geometry assertions beat eyeballing**: e.g. "the FK arrow's last point lies on the border of the target column's cell
  and its direction is perpendicular to that border".
* Visual: `VISUAL=1 npx vitest run <file>` writes SVGs under `.tmp/<module>/`; rasterise with
  `node scripts/svg2png.mjs in.svg out.png` (real Chromium) and LOOK at the PNG. Check for: wrong symbols, overlapping nodes,
  connectors crossing text, clipped content, arrow tips not touching cells.
* E2E: Playwright (`npm run test:e2e`, default port 5199, `E2E_PORT` to override) exercises real pointer interactions;
  `e2e/acceptance` drives the whole product through the UI only.
* Never claim a test or visual check passed unless it actually ran.

### Contributor rules that follow from the architecture

1. Notation families (`render/<family>/**`) import ONLY leaf modules (`../registry`, `../svgText`, `../OutlineShape`, `../palette`,
   `../types`, `@/scene/**`, `@/model/**`) - never `@/render`, `../SceneSvg`, `../standalone`, `../families`. Never create
   `index.tsx` next to `index.ts` (Vite resolves `.ts` first and the stub would win): keep JSX in sibling `.tsx` files and register in `index.ts`.
2. Family tests call the family builder directly (`buildChenScene({project, diagram, model, measure: defaultMeasure})`, never `buildScene`)
   and render with `import '@/render/<family>'` + `renderSceneToSvgStringCore`.
3. Visual artifacts and scratch output go under `.tmp/` only (it is not part of the product).
4. Tests that call `useDeterministicIds()` / `useFixedClock()` restore in `afterEach`; freeze fixtures (`src/test/deepFreeze.ts`) in tests of pure modules.
5. Every user-visible string goes through `t()` with real `en` and `zh` text (`src/i18n/README.md`); chrome colours come from `src/ui/theme/tokens.css`.
6. Dependencies are added deliberately (the runtime set is: react, react-dom, zustand, immer, elkjs, jspdf, svg2pdf.js and two bundled fonts).

## 7. Known decisions

* TypeScript 7 (no `baseUrl`; alias `@/*` -> `src/*` via `paths`); Vite 8 with Rolldown (`build.rolldownOptions`), Vitest 5, React 19.
* IDs: `<prefix>_<10 base36 chars>`; tests use `useDeterministicIds()`.
* **Helvetica metrics, no canvas measuring** by default (rule 8): the same scene in Node tests, the browser, SVG, PNG and PDF.
  Fonts without a metric table fall back to canvas measurement (`measure.ts`).
* **ELK runs in a dedicated Web Worker** in the browser (`src/layout/elkRunner.ts`), with the same ELK build in-thread as a fallback
  (Node, vitest, no `Worker`, dead worker). ELK itself is 1.4 MB raw and is never in the entry bundle.
* **Lazy chunks**: dialogs (`ui/dialogs/content/lazy.tsx`), the layout engines, `react-dom/server` (`render/standalone*`), jsPDF + svg2pdf (first PDF export)
  load on first use; `vite.config.ts` pins `vendor-react`, `vendor-state` and `render-standalone` chunks. Details and numbers: `docs/PERFORMANCE.md`.
* The i18n catalogues (en + zh) are eager and part of the entry chunk (splitting them is the main remaining initial-size saving).
* `base: './'`: the build is a static site that works from any path; no router, no SPA fallback needed.
* PDF text uses Helvetica (jsPDF built-in, WinAnsi). Labels containing glyphs outside WinAnsi (for example CJK) make the PDF a raster-image PDF with an explicit warning.
* SQL import uses a hand-written tokenizer + recursive-descent parser for a documented DDL subset with explicit
  errors for anything unsupported (never silent mis-parses).
* Persistence: IndexedDB database `schemacanvas` (store `kv`) for projects; `localStorage` only for per-browser UI preferences.

## 8. Editor / UI architecture (contracts for the interactive layer)

```
 src/editor/            interaction engine                       src/ui/            application chrome
   DiagramCanvas.tsx    the interactive SVG canvas                 shell/            AppShell, toolbar, tabs, theme, dialogs host, toasts
   canvasHandle.ts      imperative API (viewport, fit, armItem…)   panels/           library, templates, properties forms, issues dock, dialogs
   commands/            ONE command registry (+ shortcuts)         uiStore.ts        dialog / toasts / issues / dock state (not project data)
   dnd.ts               library → canvas drag payload              src/i18n/         core.ts t()/useT(); messages/<feature>.ts per feature
```

* **Single command registry** (`editor/commands/registry.ts`): toolbar buttons, menus, context menus, keyboard shortcuts and the command
  palette all call `runCommand(id)` / `useCommand(id)`. The editor registers edit/view/arrange/layout commands; the UI registers file and
  dialog commands (`file.new|open|save|export|import`, `diagram.validate|convert|options`, `help.shortcuts`). Labels are i18n keys
  `commands.<id>`; shortcuts use platform-neutral strings (`Mod+Z`). Nothing hard-codes a shortcut anywhere else.
* **All edits are `store.commit` + `ops.*`** (drags use `beginTransaction/updateTransaction/endTransaction`, Esc = `cancelTransaction`);
  the canvas never mutates anything else. View state (viewport) goes through `setViewState` (no history). Selection and tool are store UI state.
* **Scene is derived on every render from `buildScene(project, diagramId)`** (memoised by project identity); during a drag the transaction
  updates `project`, so the scene follows the pointer. Hit-testing, handles and the marquee run against the scene — never against DOM bboxes.
  Notation views never draw selection chrome; `SceneSvgCore` draws halos; the editor draws handles/marquee/guides in an overlay `<g>`.
* **Library → canvas**: items are `LibraryItem` (editor/dnd.ts), dragged with MIME `LIBRARY_MIME`; click-to-arm uses `canvas.armItem`.
  Dropping an attribute item onto an entity/relationship/composite attribute adds it to that owner (otherwise a toast explains).
* **Flows that span modules** (each implemented as a command, never inline in a component):
  - *Auto-layout*: `buildScene` → `autoLayout(scene, project, diagramId, opts)` → `commit('Auto-layout', d => ops.setNodePositions(d, …))` (one undo step).
  - *Validate*: `validateProject(project, {modelId})` (+ `ddlIssues` for relational models) → `uiStore.setIssues` → dock opens; clicking an issue
    selects `resolveRefsInDiagram(...)` results and fits them; any later commit marks issues stale.
  - *Convert* (dialog → options → preview of `record.decisions`/`warnings`): `convertErToRelational` → build a TEMP project containing the result
    diagram → `buildScene` → `autoLayout` → ONE `commit('Convert ER → relational', d => ops.applyConversionResult(d, result, {positions}))`, activate the new
    diagram. The ER model is never touched.
  - *Export*: `exportDiagram(project, diagramId, format, options)` (src/export) → `ExportResult` (blob, filename, warnings) → download; exports render the same scene (`SceneSvgCore` +
    `lightPalette` unless `darkPalette` is requested, `interactive:false`) so they match the editor; `Scene.bounds` guarantees no clipping.
  - *Open example*: examples (src/examples) return complete `Project`s containing BOTH the ER diagram and the converted relational diagram; the UI swaps the project through `ui/shell/replace.ts` (snapshot of the previous project -> Recent, toast "Reopen previous").
* **Accessibility**: landmarks (`header`, `nav`, `main`, `aside`), every control labelled, visible focus rings, full keyboard operation of toolbar/menus/dialogs
  (focus trap + Escape), canvas `role="application"` with an `aria-live` announcer for selection changes, `prefers-reduced-motion` respected, contrast ≥ 4.5:1 in both themes.
* **Responsive**: ≥1100px three columns; 700–1100px side panels become overlays/drawers toggled from the toolbar; <700px canvas + bottom sheet. No horizontal page scroll.
* **Theme**: CSS variables on `:root[data-theme]` for chrome; the SVG canvas uses `lightPalette`/`darkPalette` (concrete colours). `system` follows `prefers-color-scheme`.
