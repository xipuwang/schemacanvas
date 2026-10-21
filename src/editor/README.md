# src/editor: the interactive canvas and interaction engine

Owner: EDITOR-CORE. Contracts: ARCHITECTURE section 8. Import from `@/editor` (`index.ts`); importing it registers every
editor command. The canvas is a custom SVG surface: all geometry comes from `buildScene`, all edits are `store.commit` + `ops`.

```
DiagramCanvas.tsx   the canvas (forwardRef<DiagramCanvasHandle>): viewport, pointer/keyboard engine, overlay, DnD, inline edit
hit.ts              hitTest(scene, worldPoint, zoom, opts) / marqueeSelect(scene, rect, opts)         (pure, tested)
plugins.ts          canvas plugin API + PluginDispatcher + context-menu providers                       (tested)
creation.ts         createFromLibraryItem(store, diagramId, item, at) (ONE commit) + template hook      (tested)
editSpec.ts         resolveEditSpec(): what an inline edit changes and where the <input> goes           (tested)
semanticDelete.ts   selectionRefs()/removeRefs(): Delete key = semantic delete via ops
clipboardStore.ts   internal clipboard record + best-effort system clipboard
viewport.ts         pure viewport math (zoomAround, fitRect, ...)
canvasState.ts      useViewportInfo(), useArmedItem(), canvasUiStore (armed item, keyboard focus node)
announce.ts         aria-live selection text
ContextMenu.tsx / contextMenuModel.ts   accessible menu + which commands it offers per target
InlineEdit.tsx      the font-matched <input> overlay
commands/           registry.ts, shortcuts.ts (contract) + edit/view/arrange/layout/tool.ts (registered on import)
```

## Conventions

* **Viewport**: `screen = world * zoom + {x, y}`, screen = pixels relative to the canvas container. Zoom is clamped to 0.1-4.
  `DiagramCanvasHandle.zoomBy/zoomTo(.., around)`: `around` is a container-relative SCREEN point (default: container centre).
  `clientToWorld/worldToClient` take page (client) coordinates. `visibleRect()` was added to the handle (additive).
* **Selection** = store `selection {ids, sub?}`: `ids` are `DiagramNode` / `DiagramEdge` ids. Clicking a table cell selects
  `{ids:[nodeId], sub:{kind:'column', relationId, id}}`; clicking an FK connector selects `{ids:[edgeId], sub:{kind:'foreignKey', id}}`.
  `sub` is also what the renderers receive as `ctx.selectedRefs`.
* **Moving**: one `begin/update/endTransaction` per drag (`ops.setNodePositions` with absolute positions computed from the drag
  start, so it is idempotent per frame). Grid snap + smart guides (`src/layout snapRect`, 6 px threshold) apply when
  `diagram.options.grid.snap` is on; Alt disables both; Shift constrains to an axis; locked nodes never move; Esc / pointercancel /
  window blur = `cancelTransaction`; a drag that moved nothing records no history (store behaviour).
* **Marquee**: nodes by intersection (Alt = containment); edges only when completely inside (`marqueeSelect` option `edges`).
* **Keyboard** (canvas focused): arrows nudge by the grid (Shift x10, Alt 1 px; a burst inside a 400 ms idle window is ONE undo step,
  see `nudge.ts`; with nothing selected they pan), Tab/Shift+Tab walk nodes in reading order THEN connectors and select them (focus ring
  drawn in the overlay), Enter on a table = cell mode (see "Keyboard layer"), F2 renames (Enter renames every other node),
  Shift+F10/ContextMenu opens the menu, Space pans, Esc = cancel gesture -> disarm -> tool back to select -> clear selection.
  One global handler: React `onKeyDown` on the canvas plus a `document` listener; it never acts on inputs/textareas/contenteditable,
  while a dialog is open, or inside `[role=dialog|menu|listbox]`. Bare-key shortcuts (V, H, Delete, Shift+1) only act at document
  level when focus is on `<body>`. Commands are dispatched through `findCommandForEvent`, so every registered command's shortcut works
  (the UI shell must NOT install a second global shortcut handler).
* **Delete** (`edit.delete`): by selection kind, semantic, one undo step: node -> `removeEntity|removeAttribute|removeRelationship|removeRelation`;
  FK edge -> `removeForeignKey`; participation line -> `removeParticipant`; attribute link -> `removeAttribute`; column sub-selection
  -> `removeColumn`. Elements already removed by a cascade are skipped. `edit.removeFromDiagram` is presentation only.
* **Creation** (`creation.ts`): drop or armed click -> `createFromLibraryItem`; the new element is centred on the point (snapped when
  grid snap is on), selected, then inline rename starts. Attributes need an owner under the cursor (entity / relationship / any
  attribute) and are placed in the nearest free spot beside it; key flavours on non-entities degrade to a simple attribute (toast).
  Failures return `{ok:false, reason}` and `reportCreation` toasts them. Templates: `registerTemplateInserter(fn)` (hook for EXAMPLES;
  `fn({store, diagramId, templateId, at})` does one commit and returns the node ids to select).
* **Inline edit**: `canvas.startInlineEdit({nodeId?, columnId?, edgeId?})` or double-click. Entity / attribute / relationship / relation /
  column names (empty names are refused), FK label (`ForeignKey.label`) and participant role (`ErParticipant.role`), both clearable.
  Enter/blur commit, Esc cancels, Tab/Shift+Tab on a column cell commit and move to the next/previous cell.
* **Viewport persistence**: `store.setViewState` debounced 300 ms (+ flushed on diagram switch/unmount); a diagram without a stored
  viewport is fitted on first open (max 100%), an empty one is centred at the origin at 100%.
* **Scene memo**: rebuilt only when `project.models`, the diagram's nodes/edges/options change, so viewport writes never trigger a rebuild.
* **Issue highlights**: `uiStore.focusedIssueId` -> `resolveRefsInDiagram` -> halos by severity and per-cell/FK highlights.
* Strings: `src/i18n/messages/editor.ts` (namespace `editor`) and `commands-editor.ts` (merges into `commands`), en + zh.
* Overlay colours come from the diagram palette (theme aware); chrome (menu, inline input, empty hint) uses the design tokens (`editor.css`).

## Drag performance: DRAFT scene mode (`src/scene/draft.ts`)

`buildScene(project, diagramId, measure?, { quality: 'draft', previous: { scene, diagram, model } })` (additive; full quality is byte
identical and ignores both options). While `store.inTransaction` the canvas builds DRAFT scenes against the last FULL build it made
(`fullBaseline`): an edge whose `DiagramEdge`, both endpoint `DiagramNode`s, the model and the diagram options are IDENTICAL (immer
structural sharing) keeps its previous geometry object; every other edge gets provisional geometry between its exact planned anchors
(h-table / vertical: stub, one elbow, stub, no router / nudge / label search; manual routes still pass through their waypoints;
Chen: direct Z/L or one elbow, labels only against the live edges). Chen node geometry of untouched nodes is reused too. The scene
carries `quality: 'draft'`; on drop (`inTransaction` -> false) the memo runs again and builds FULL, so the end state is a fresh full build.
`window.__scPerf = []` records one `{mode, buildMs}` sample per build, `window.__scForceFull = true` restores the old always-full
behaviour (used by the perf spec for the "before" numbers). Measured numbers: `e2e/editor2/perf.spec.ts`, `src/editor/dragPerf.test.ts`.

## Auto-pan, nudge bursts, eased zoom

* **Auto-pan** (`autoPan.ts`, pure): while a node move, a marquee or a plugin gesture (connect / FK / handles) runs and the pointer is within
  48 px of the canvas edge (or outside it, captured), a rAF loop scrolls the view (quadratic ramp up to 900 px/s) and re-runs the gesture with the
  last pointer position so the dragged thing follows. Stops on release / cancel / unmount. Under prefers-reduced-motion it still works with one
  constant speed (no ramp).
* **Nudge bursts** (`nudge.ts`, `sharedNudger`): the first arrow press opens ONE store transaction, further presses inside the 400 ms idle window
  update it; any other key, a pointer press, blur, a diagram switch or unmount closes it first, so no other edit meets an open transaction.
  The keyboard connector editing uses the same coalescer (`edit(key, recipe)`).
* **Eased zoom / fit**: `zoomBy / zoomTo / fitToContent / fitToNodes` tween 150 ms (ease-out cubic, geometric zoom). `viewRef` / `getViewport()` /
  `data-zoom` are the TARGET at once; `data-animating="true"` is set while drawn state differs; pointer press / wheel snaps to the target. Skipped
  under prefers-reduced-motion and under browser automation (`navigator.webdriver`) unless `window.__scForceAnimate = true` (e2e geometry reads).

## Keyboard layer (`keyboard/`)

Everything the pointer can do on a table / connector / Chen shape has a key path. Plugin `editor.keyboard` (priority 95) + commands (all listed in
the shortcuts dialog) + canvas Tab order. State: `kbStore` (cell mode, connector focus, keyboard connect, aria-live text; never project data).
Announcements go to `[data-testid=canvas-live-kb]` inside the canvas live region.

| Keys | Does |
|---|---|
| Tab / Shift+Tab | nodes in reading order, then connectors (a connector announces `Foreign key Patient.DoctorSSN to Doctor.SSN`) |
| Enter on a table (`table.cellMode`) | CELL MODE: announces `Column DoctorSSN, foreign key to Doctor.SSN` |
| Left / Right, Home / End | move the cell cursor (`cell.next/prev/first/last`); Up/Down never nudge the table |
| Shift+Left / Shift+Right | extend a contiguous mark range (composite FK source); Space marks / unmarks the cursor cell |
| F2 | rename the cell inline; Escape leaves cell mode |
| Shift+F (`fk.fromSelection`) | arm the FK tool from the marked cells (or the selected column); arrows choose the referenced table, Enter opens the mapping popover (keyboard), Enter creates |
| `[` / `]` (`edge.prevBend/nextBend`) | walk the focused connector's handles: source end(s), bends, segments, target end(s), labels |
| Arrows / Shift+arrows | nudge the focused bend (waypoint), end (anchor along its side) or label by the grid (x10); one undo step per burst |
| I (`edge.insertBend`) | bend at the midpoint of the focused (else longest) segment, focused afterwards; Delete removes the focused bend; R (`edge.resetRoute`) resets the route |
| E / Shift+R / T | new entity / relationship / table at a free spot near the view centre, selected, rename starts |
| L (`chen.linkFromSelection`) | connect the selected entity / relationship: arrows choose the other shape, Enter connects (`performConnect`: participant, new relationship, recursive), Escape cancels |
| A (existing) | add an attribute to the selected entity / relationship / composite attribute, rename starts |

Chen path without a mouse: `E` (type name, Enter) twice, `L` + arrow + Enter between the entities (creates the relationship, rename starts), `A` for
attributes, `Shift+R` for another relationship and `L` onto an entity for participants (`e2e/editor2/keyboard.spec.ts`).
`findCommandForEvent` now prefers the first ENABLED command among those sharing a key, and a disabled bare-key command falls through to the canvas keys.

## Commands (all registered on import; labels `commands.<id>`)

`edit.undo (Mod+Z) redo (Mod+Shift+Z, Mod+Y) cut copy paste duplicate (Mod+X/C/V/D) delete (Delete, Backspace) removeFromDiagram selectAll (Mod+A) deselect (Mod+Shift+A)`
`view.zoomIn (Mod+=) zoomOut (Mod+-) zoomReset (Mod+0) fit (Shift+1) fitSelection (Shift+2) toggleGrid toggleSnap` (checkable, via `ops.setDiagramOptions`)
`arrange.alignLeft|Center|Right|Top|Middle|Bottom distributeH|V (>= 3) matchWidth|Height bringToFront sendToBack lock unlock`
`layout.auto (Mod+Shift+L) layout.autoSelection edge.resetRoute tool.select (V) tool.hand (H)`
Matching sizes: Chen nodes use their shape box; h-tables use the row width / row height (`DiagramNode.width/height` semantics).
Paste: internal clipboard first (also written to the system clipboard as JSON with the `schemacanvas-clipboard` marker; read from the
system clipboard only when the internal one is empty); the offset grows with each paste; an off-screen source lands at the visible centre.
`shortcuts.ts` gained an optional `code` on `KeyEventLike` so `Shift+1` matches although the key reads `!`.

## Plugin API (EDITOR-TOOLS builds on this; `plugins.ts`)

```ts
const off = registerCanvasPlugin({
  id: 'connect-tool',
  priority: 10,                       // higher first; default select behaviour runs after every plugin
  onPointerDown(cx, e) { return 'capture' | 'handled' | undefined },
  onPointerMove(cx, e) {},            // captured drag, or hover when nothing is captured ('handled' stops the hover chain)
  onPointerUp(cx, e) {},
  onPointerCancel(cx) {},             // Esc / pointercancel / blur / unmount while this plugin owns the sequence
  onDoubleClick(cx, e) { return 'handled' },
  onKeyDown(cx, ev) { return 'handled' },   // before the canvas' own keys, Escape included
  cursorAt(cx, e) { return 'crosshair' },
  overlay(cx) { return <g>...</g> },        // WORLD coordinates, above the scene (use vectorEffect="non-scaling-stroke" for px strokes)
  contextMenu(cx, hit) { return [{ kind: 'command', commandId: 'x' }, { kind: 'item', id, label, run }] },
});
registerContextMenuProvider((cx, hit) => MenuEntry[] | undefined);
```

* `CanvasPointerEvent`: `{world, screen, clientX/Y, button, buttons, pointerId, pointerType, shift/alt/ctrl/metaKey, detail, hit, native}`;
  `hit` is a `HitResult` computed once per event: `none | node {nodeId, columnId?, onName?, border?{columnId, side}} | edge {edgeId, branchId?, distance} | edge-label {edgeId, labelId}`.
* `CanvasContext`: `{project, diagramId, diagram, scene, viewport, zoom, palette, store, handle, worldFromClient, hit(world, opts?), setCursor, requestRender}`.
  It is rebuilt per event (never cache it). Plugin registration re-renders the canvas; call `cx.requestRender()` after changing plugin-local state.
* **Capture**: returning `'capture'` from `onPointerDown` routes that pointer's move/up/cancel to the plugin only and suppresses the default
  select/move/marquee. The dispatcher (`PluginDispatcher`) is unit-tested: priority order, first-consumer-wins, capture, cancel, hover.
* Edits from plugins must use `cx.store` (`commit` / `begin|update|endTransaction`) with `src/model/ops`; `hit.border` and `FkBranch` ids are provided for resize / anchor / bend tools.

## Tests

* Unit/DOM: `npx vitest run src/editor` (hit-testing, creation, commands, plugin dispatch, edit specs, viewport, jsdom canvas keyboard/rename,
  auto-pan maths, nudge coalescing, cell mode, connector focus, drag perf: `PERF=1` for the strict 16 / 33 / 16 ms targets) and `src/scene/draft.test.ts`.
* Browser: `E2E_PORT=5201 npx playwright test e2e/editor --output=.tmp/editor/results` against `harness/editor/index.html`
  (pharmacy Chen + relational + empty diagrams; `?theme=dark`, `?lang=zh`; `window.__sc` exposes the store, handle and plugin registry).
  Screenshots land in `.tmp/editor/`. Use `--output` so parallel Playwright runs do not delete each other's results.
  `harness/editor` also takes `?big=rel40|rel87|chen60` (generated by `perfFixtures.ts`).
* `e2e/editor2/` (EDITOR-2): `perf.spec.ts` (before / after drag numbers, `PERF=1` strict), `canvas.spec.ts` (draft mode, auto-pan, nudge burst, eased zoom,
  template selection) and `keyboard.spec.ts` (keyboard-only composite FK + connector route editing + Chen path, axe light / dark). Screenshots: `.tmp/editor2/`.

## Known gaps

* Draft mode has no "rebuild FULL quality when the pointer pauses" step: the full build happens on drop only (the drop frame of a
  87-table schema still takes one full build, ~170 ms in the browser). Draft connectors do not avoid tables while dragging.
* Zoom / fit are eased only for the commands and the handle (`zoomBy/zoomTo/fitTo*`); wheel / pinch / pan stay 1:1 by design.
* Dragging edge labels / waypoints / anchors, resize handles and connect tools are EDITOR-TOOLS (via the plugin API).
* Pinch/touch is covered by synthetic pointer events in e2e, not by a real touch device.

## Keyboard, focus and assistive technology (interaction fixes)

- **Focus is not selection.** Tab moves only the focus ring (`canvasUiStore.focusNodeId`, announced as "... Press Space or Enter to select it");
  Space / Enter selects it (Shift or Ctrl + Space adds it). A selection made any other way takes the ring with it.
- **Landmarks.** F6 / Shift+F6 cycle canvas -> properties -> library (`commands/focus.ts`, works from text fields too);
  `focus.properties` (Mod+Alt+P, also a context-menu item) jumps to the Properties panel for the current selection.
- **Context menu** owns its keys: Enter / Space run the item, Escape closes and returns focus to the canvas, nothing reaches the canvas.
- **Symbol hints** (`explain.ts` + the tooltip in `DiagramCanvas`): hover (550 ms) and keyboard focus (450 ms) explain the symbol under the
  pointer in plain language from the semantic model; ports use `toolUi.hoverPort`; Escape dismisses; `view.symbolHints` toggles them.
- **Text alternative** (`Outline.tsx`): the SVG is `role="img"` with a generated summary; a skip link and `view.outline` open a nested-list
  outline (links select + focus the shape). It lives OUTSIDE the `role="application"` element on purpose.
- **Live region**: messages expire after 10 s (`kbAnnounce`, `toolUi.announce`) and the creation hints are dropped when a rename commits.
- Auto-placed attributes treat connectors as obstacles (`placement.ts`).
