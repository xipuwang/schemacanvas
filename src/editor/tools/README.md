# src/editor/tools: connect, foreign-key, add-attribute, resize and edge-editing tools

Owner: EDITOR-TOOLS. Everything here sits ON TOP of the canvas plugin API (`../plugins.ts`; see `../README.md`): two canvas
plugins, a set of commands, i18n and overlay chrome. `index.ts` is imported for its side effects by `src/ui/register.ts`
(`installEditorTools()` is idempotent). All semantic edits are `store.commit` / `begin|update|endTransaction` + `src/model/ops`;
all derived geometry comes from `buildScene`.

| File | What |
|---|---|
| `handlesPlugin.tsx` | plugin `editor-tools.handles` (priority 100): resize handles, column / row / table-width handles, edge bend / midpoint / anchor-end handles, connector label dragging, `Alt+Shift+Arrow` keyboard resize, double-click reset |
| `toolsPlugin.tsx` | plugin `editor-tools.tools` (priority 90): connect tool, FK tool, ports (hover / selection), add-attribute port, ghost lines and target highlights |
| `ToolChrome.tsx`, `tools.css` | the hint chip, the aria-live region, the FK mapping popover and the add-attribute flavour menu (portalled; an `EventGuard` keeps their events away from the canvas) |
| `chenConnect.ts` | `classifyConnect` (pure rules) + `connectParticipant`, `createRelationshipBetween`, `planConnectSelected` |
| `fkLogic.ts` | pure FK rules: `candidateKeys`, `resolveFkTarget`, `suggestMapping`, `remapTarget`, `describePairs`, `validTargetColumns`; `fkCommit.ts` = the ONE commit |
| `attributes.ts` | `addAttributeTo(store, diagramId, ownerNodeId, flavor)`: unique name, free spot next to the owner, composite = two children |
| `handles.ts`, `ports.ts`, `resize.ts`, `routeEdit.ts` | pure geometry / maths: handle sets + hit-testing, ports, resize clamping (text fit measured on the real scene), waypoint insertion / straighten, anchor-from-pointer |
| `commands.ts` | the commands below; labels in `src/i18n/messages/editor-tools.ts` (namespaces `editorTools` and `commands`, en + zh) |
| `toolState.ts` | transient UI state (hover, ghost lines, popover, hint, announcements): never project data, never history |

## What the user gets

* **Connect tool** (`tool.connect`, **C**; Chen only). Press on an entity or relationship and drag. Over a valid target the target is
  ringed and the hint chip says what releasing does; invalid targets turn red with the reason. Rules (`classifyConnect`):
  entity <-> relationship = participant (defaults: `many`, `partial`; edit in Properties); the same entity dragged onto the same relationship
  again = RECURSIVE participant (the role edit of the new line opens); a third is refused; entity -> another entity = a new relationship
  midway with both participants in ONE commit (selected + inline rename); entity -> itself (leave the node, come back) = recursive
  relationship; relationship -> relationship and anything involving an attribute are refused with an explanation.
  Also by dragging the **connect port** of a hovered / selected node in the select tool, and `chen.connectSelected` (two selected nodes).
* **Foreign key tool** (`tool.fk`, **F**; relational, crow's foot, physical). Press a column cell and drag onto the referenced table (or a
  key cell). Shift-click builds a composite source (cells of ONE table; click-armed: click the cells, then click / Enter the referenced
  table). While dragging every cell of a key of the right length is outlined, the hovered table shows the chosen key cells. On release a
  **popover** shows `Patient.DoctorSSN → Doctor.SSN`, the column mapping pair by pair (reorder = pick another target column, the other
  pair swaps: always a permutation of the key), the key to reference when several fit and a type-mismatch note; **nothing exists until Create**
  (Enter). Creation = `ops.addForeignKey` with ONE foreign key and ordered pairs, ONE undo step. Targets that are not a key / have the wrong
  number of columns / would make a column reference itself / duplicate an FK are refused with the reason and the fix (never "create anyway").
  Mapping defaults: name hints (`DrugTradeName` -> `TradeName`), then key order; sources are ordered by the table's column order.
  Also: FK **port** of a selected / hovered cell, `fk.fromSelection` (arms the tool from the selected column).
* **Add attribute**: `+` port on entities, relationships and composite attributes (click = simple attribute, selected + inline rename;
  press-and-hold 450 ms = flavour menu), `chen.addAttribute` (**A**), `chen.add{Key,PartialKey,Multivalued,Derived,Composite}Attribute`,
  `chen.addSubAttribute`, and the same entries in the context menu. Key flavours are entity-only (disabled elsewhere).
* **Resize**: Chen nodes: 8 handles on the outer outline (clamped at the text fit, Shift = keep aspect, grid snap unless Alt, read-out bubble,
  double-click = reset to auto size). Horizontal tables (and crow's foot horizontal): column borders (+ left border of the first column) and a
  bottom strip for the row height. Vertical tables: width handle. `table.resetWidths`, `node.resetSize`. `Alt+Shift+Arrows` resizes from the keyboard.
* **Edge editing** (selected edge): bend handles (drag; Alt+click / double-click removes), midpoint handles (drag inserts a waypoint and
  switches to `manual`, starting from `EdgeGeom.autoWaypoints`), end handles (slide the anchor along the ALLOWED side of the cell / outline rect;
  composite FK branches write `branchAnchors[sourceColumnId]`; double-click resets), label dragging (selects the edge first), `edge.straighten`,
  `edge.resetRoute` (core). Moving tables keeps the routes: `ops.moveNodesBy` / `ops.setNodePositions` translate MANUAL waypoints of every edge whose
  BOTH endpoints move by the same delta (see `src/model/ops/diagram.ts`).
* Every gesture is a captured pointer sequence with a live preview in one transaction; Escape / pointercancel / blur restore; one undo step each.
  Handles and ports have a >= 9 px (screen) hit radius at every zoom. Tool state is announced through an aria-live region and a hint chip.

## Safety invariant

Edge editing only ever produces `EdgeRoutePatch` fragments (mode, waypoints, anchor preferences). Anchors are cell-relative and clamped, the
referenced column / element is not an input: tests assert that the foreign key pairs are byte-identical and the arrow still ends on the same cell
after every bend / midpoint / anchor gesture.

## Commands

`tool.connect (C) tool.fk (F) chen.connectSelected chen.addAttribute (A) chen.addKeyAttribute chen.addPartialKeyAttribute
chen.addMultivaluedAttribute chen.addDerivedAttribute chen.addCompositeAttribute chen.addSubAttribute edge.straighten table.resetWidths
node.resetSize fk.fromSelection` (+ `edge.resetLabels` as a context-menu item). Escape returns to the select tool (canvas behaviour).

## Tests

* Unit / plugin integration: `npx vitest run src/editor/tools src/model/ops` (pure parts, the REAL plugins driven through `PluginDispatcher`
  over a real store + scene, commands).
* Browser: `E2E_PORT=5213 npx playwright test e2e/editor-tools --output=.tmp/editor-tools/results` against `harness/editor-tools/index.html`
  (chen / rel / relBare = no FKs / cf = crow's foot without FKs / empty; `?theme=dark`, `?lang=zh`, `?snap=1`) and against the REAL app
  (`app.spec.ts`: project loaded through the shell's file chooser, library tool buttons, axe light + dark). Screenshots: `.tmp/editor-tools/`.

## Known gaps

* Midpoint handles insert ONE waypoint at the pointer (corner semantics of `EdgeRoute`); there is no "drag a whole segment" gesture.
  For composite FK bundles the midpoint handles lie on the first lane, not on the bundle centreline (offset <= half a lane gap).
* (Resolved by `../keyboard/`, see ../README.md "Keyboard layer": cell mode selects columns, `[` `]` + arrows edit bends / anchors / labels, `fk.fromSelection`
  has the shortcut Shift+F and arrow-key target selection.)
* Auto-layout (different deltas per node) does not translate manual waypoints; they stay absolute (documented in `ops/diagram.ts`).
* Below ~22 screen px a Chen node shows only its 4 corner handles; at very low zoom column strips cover whole narrow cells and win over the row strip.
* Press-and-hold and the touch handles are exercised with synthetic pointer events, not a real touch device.
* Vertical-table inline rename and FK-label rename remain core behaviour (`editSpec`), not part of these tools.
