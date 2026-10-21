# scene/horizontal + scene/routing + render/horizontal

Native **horizontal relational schema** notation (`relational-schema` diagrams): one row of bordered cells per relation,
orthogonal FK connectors ending on the exact referenced cell.

## Public API
* `buildHorizontalScene(input)` (`scene/horizontal/index.ts`): `SceneBuilder`. Emits `HTableGeom` nodes (`kind:'h-table'`) and
  `FkEdgeGeom` edges (`kind:'fk'`); types in `types.ts` (`pairs?` and bracket semantics were added additively).
* `routeOrthogonal`, `nudgeRoutes`, `simplifyOrthogonal`, `cleanOrthogonal`, `orthogonalizeThrough` (`scene/routing`): obstacle-avoiding
  A* router (bend penalty, clearance, perpendicular stubs, manual waypoints passthrough, parallel-segment nudging). Grid lines are
  quantised (1e-6) so routes are exactly axis aligned; facing ends closer than 2*stub meet in the middle (no hook); a stub that would end
  inside a crowded neighbour is shortened; non-finite input is answered with the bare segment; the search runs on the obstacles near the
  endpoints first (far ones are added only when the found path hits them).
* Views register on `import '@/render/horizontal'` (`h-table`, `fk`). DOM hooks: `data-column-id`, `data-role`,
  `data-fk-branch` (= source column id), `data-fk-target` (= referenced column id), `data-fk-style`.
* `fixtures.ts`: Student, Pharmacy, PreReq, Employee, detour, typed, out-of-order, bracket fixtures (tests + visual).

## Conventions
* Columns are chosen ONCE (`planEdge` in `fk.ts`) from the FK pairs; sides/anchors/routing only move geometry.
* Table: name above (or left), `bounds` includes the name, `node.x/y === bounds.x/y`. Cell width = text (+type) + 2*padding, min 36;
  `columnWidths` only grow a cell; `node.width` = minimum row width (surplus to un-overridden cells); `node.height` >= text fit.
* Roles: PK = underline + key tint; FK = italic + FK tint; PK+FK = both (diagonal two-tone cell); plain = regular.
* Sides: auto = bottom->top when the target is below, top->bottom when above, else bottom/bottom; self-FK = bottom/bottom.
  A top border under the relation name is "blocked": that end uses the bottom border, except the first cell, which uses its left border.
* Anchors spread evenly per (table, cell, side) ordered by peer position; explicit `AnchorSpec.offset` is clamped inside its own cell.
* Composite `branches`: centreline routed (or manual waypoints), each branch = parallel lane (BRANCH_GAP) with its own stubs and own
  target cell; never merged. Pair numbers appear only when pairs cross. `bracket` only when contiguous + ordered on both sides, else
  `fk-bracket-fallback:<fkId>` warning and `style:'branches'`; the single bracket branch carries the FIRST pair's column ids and span rects.
* Scene warnings: `dangling-fk-edge:`, `fk-column-missing:`, `anchor-coerced:`, `fk-bracket-fallback:`, `missing-relation:`, `duplicate-relation-node:`, `h-node-invalid:` (a node whose x/y is not finite is skipped; its FK edges then get `dangling-fk-edge:`).
* `routing: 'straight'` draws stub + one straight segment + stub (still perpendicular at both ends). SPEC DECISION (HSTRAIGHT-1): a
  direct line through a foreign table would suggest the wrong referenced field, so an auto edge whose straight path crosses a
  foreign table's bounds is routed around the tables (orthogonal polyline, same obstacle rules) instead; edges with a free direct line
  stay direct. No warning is emitted (the mode is a style, not an error).

## Routing rules added by the review fixes
* Obstacles per FK request: every table's row + relation name, every table's bounds (name band) except the edge's own two tables,
  and a keep-out strip (arrowhead + final stub, `ZONE_PAD` 3) for every FK arrow except the edge's own. Obstacles may carry their own
  `clearance` (`RouteObstacle` in `scene/routing`, additive).
* Bundles (composite FK with all-vertical sides): lanes are offsets of the routed centreline. A bundle is given up (each branch routed
  on its own, then nudged apart) when a lane would run through a table / foreign arrow zone, or when two branches would run closer
  than half a lane gap. Jog heights are lowered in 3px steps to avoid near-coincident jogs. Only the derived jogs of a bundle may be
  nudged (`'ends'`), which is what makes `autoWaypoints` -> manual reproduce an auto bundle exactly.
* `autoWaypoints`: single branch = interior vertices of its path; bundle = interior of its centreline; separately routed composite
  branches have no common centreline, so an auto composite offers `[]` (a manual one reports its waypoints).
* Manual composite without a bundle (mixed sides, or a bundle that was given up): the waypoints are the CENTRELINE, branch i follows lane
  `(i-(n-1)/2)*BRANCH_GAP` beside it.
* Manual routes keep both stubs: a bend behind an anchor side (at/behind the border) gets a sideways detour around the owning table
  instead of a path that runs back through the cell; a bend that only shortens the stub (still outside the cell) is kept as given.
* Known limitation: when tables are packed closer than ~12px, two branches of one composite FK may still share a run inside the
  narrow corridor between them (they never cross a table); in rare layouts a nudge can land on a neighbouring line.

## Non-finite safety (R2)
* `sanitize.ts`: every stored number the builder reads is made safe first. Node `x`/`y` not finite = node skipped (`h-node-invalid:<id>`);
  `width`/`height`/`columnWidths`/`style.fontSize|strokeWidth`/anchor `offset`/edge `strokeWidth` that are not finite are dropped
  (defaults apply); waypoints with a non-finite coordinate are removed (a manual route left without waypoints becomes auto); label
  offsets fall back to 0; magnitudes are clamped to +-1e7. The scene never contains NaN/Infinity (fuzzed in `nonfinite.test.ts`).

## Crossing reduction (R2)
* After routing and nudging, a free branch (auto route, not part of a lane bundle) that crosses other connectors is routed once more
  with every other connector as a thin obstacle (`uncross` in `fk.ts`). The new path is kept only if it crosses strictly fewer
  connectors, avoids every table, is at most `MAX_DETOUR` x + `DETOUR_SLACK` px longer and has at most `MAX_EXTRA_BENDS` more corners.
  Only the PATH changes; the end cells are inputs, so the referenced column can never change. Crossings that can only be avoided by
  wrapping around a table are accepted (e.g. a connector that has to cross a composite FK's lanes into a neighbouring cell).
  `crossings.test.ts` counts proper crossings (Pharmacy 5 -> 5, tangled fixture 9 -> 2) and fails if they ever increase.

## Crowded endpoints (router contract)
* A neighbour whose padded rect would swallow a stub end is SHRUNK to its raw rect for that request; if the stub end is still inside it,
  the obstacle is DROPPED for that request. Exact end points and axis alignment are guaranteed either way (routing.test.ts).

## Draft quality (additive, see ../draft.ts)

`SceneBuildInput.quality: 'draft'` + `previous` (a full scene with its diagram / model): untouched edges are reused by identity and the
others get cheap provisional horizontal geometry (no router); `quality` omitted or `'full'` is byte identical to before. Used by the canvas
only while a drag transaction is open; tests in `../draft.test.ts`.
