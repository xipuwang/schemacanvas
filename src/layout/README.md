# src/layout

Automatic layout, alignment and snapping. Pure functions; ELK runs in a **Web Worker** in the browser (`elkRunner.ts`: `elkjs/lib/elk-api` + `elk-worker.min.js` bundled by Vite with `?worker`, base-path safe) and falls back automatically to the bundled in-thread build (`elkjs/lib/elk.bundled.js`) in Node/vitest/jsdom, when `Worker` is missing/cannot be built, or if the worker dies. Both run the same ELK build with the same seed and canonical ids, so the results are identical (`elkRunner.test.ts` compares them on the Pharmacy fixtures; `e2e/perf` compares a 60-entity Chen diagram in a real browser). The autoLayout/Chen/ELK-glue code and ELK itself are loaded on the first layout (dynamic imports), so none of it is in the entry bundle.
All positions are TOP-LEFT and can be written straight into `DiagramNode.x/y` (ARCHITECTURE rule 11) via `ops.setNodePositions`.
Import from `@/layout` (`index.ts`).

## API

```ts
autoLayout(scene, project, diagramId, opts?): Promise<Record<nodeId,{x,y}>>   // opts.signal?: AbortSignal
layoutGraph({ nodes:[{id,w,h,fixed?,sortKey?}], edges:[{id,source,target}], algorithm, direction?, spacing?, seed?, edgeLength?, clearance? }): Promise<Record<id,{x,y}>>
layoutChen(input, opts)         // the ER-aware engine behind autoLayout for `chen` diagrams (pure, scene-agnostic)
alignNodes(items, 'left'|'center'|'right'|'top'|'middle'|'bottom', lockedIds?)
distributeNodes(items, 'horizontal'|'vertical', 'even' | gapNumber, lockedIds?)   // lockedIds never move
matchSize(items, 'width'|'height'|'both', 'largest'|'smallest'|'first')   // returns target SIZES
snapRect(rect, {grid?, targets?, threshold?}) / snapPoint(p, opts)         // -> {x, y, guides: SnapGuide[]}
nudgeOutOfOverlap(rects, {gap?, fixedIds?, maxPasses?}), placeNear(size, anchor, obstacles, opts), stackBelow(size, anchor, obstacles, gap)
layoutBounds(positions, sizes), boundsOf(rects), anyOverlap(rects, gap)
```
`items`/`rects` are `{id,x,y,w,h}` (= node id + `geom.bounds`). Align/distribute/nudge return ONLY the nodes that move
(absolute positions; empty = no-op, skip the undo entry). `matchSize` results are `geom.bounds` sizes: map them to
`DiagramNode.width/height` yourself (h-table: width = min row width, height = row height).

### autoLayout options
* `algorithm` (`layered|stress|force|radial|rectpacking`), `direction` (`DOWN|RIGHT|UP|LEFT`), `spacing`, `seed`.
* `onlyNodeIds`: place ONLY these nodes in free space next to their neighbours; everything else is bit-identical and the
  result contains just these ids (use after Convert / import / add). If it names every node it is a full layout.
* `keepFixed`: full layout around nodes that keep their exact position (result includes them unchanged).
* `DiagramNode.locked` (read from `project.diagrams[diagramId].nodes`): locked nodes are ALWAYS kept fixed, exactly as if listed in
  `keepFixed`; in incremental mode they are removed from `onlyNodeIds`. Callers need not rebuild `keepFixed` from locks.
* `snapToGrid`: applied last to moved nodes. A snapped spot is accepted only if it keeps every clearance the layout had: no node
  gets closer to another than `min(gap, its unsnapped gap)` (gap: Chen attribute gap `round(spacing/3)`, relational 60), and (Chen) no
  line starts crossing a node or the other way round. Nearby grid points are tried, otherwise the node stays unsnapped, so on
  tight layouts not every node ends up on the grid (clearance wins over alignment).
* `origin`: top-left of the result for a full layout without fixed nodes (default: current top-left of the content, so
  converting on a temp project whose nodes sit at 0,0 yields content starting at 0,0).

### Strategies
* relational-schema / crows-foot / physical: ELK layered, default `DOWN` (cells attach top/bottom), spacing default 80 and
  never below 60. FK edges are fed parent -> child (referenced above/left of referencing); self-FKs ignored; parallel FKs
  and composite FKs (one edge) collapse to one graph edge.
* chen: skeleton (entities + relationships) via ELK stress (layered when `direction` is given or `algorithm:'layered'`),
  nodes inflated by their attribute fan so fans do not collide; attributes fanned away from the skeleton centroid and
  incident lines (key attributes first), composite children fanned around their parent, bounding-box collision
  avoidance against all nodes and line segments; recursive (single-neighbour) relationships are placed on a free side
  of their entity like satellites. After the skeleton is placed a repair pass pushes any entity/relationship that a
  participation line (or recursive loop) runs through perpendicular off that line. Pairs joined by several participant lines
  (recursive relationships, ternaries naming an entity twice) are modelled as the scene draws them: two elbow loops that
  leave both nodes on the sides perpendicular to their axis (`chenLoopPolylines`); the loops are obstacles for satellites and
  attribute fans, and the sides they use are kept free. Limit: an entity with SEVERAL recursive relationships has both its top
  and bottom walled in by loops, so one of its attribute links may still cross a loop line (never a node).

## Worker, cancel and busy state (UI hook)
* `layoutBusyStore` (zustand vanilla store `{ pending }`, `isLayoutBusy()`, `selectLayoutBusy`): `pending > 0` while any `autoLayout` / `layoutGraph` / `layoutChen` runs (including the lazy chunk load).
  UI owners: `const busy = useStore(layoutBusyStore, selectLayoutBusy)` (zustand's `useStore`) for a spinner on the Convert dialog / the `layout.auto` command.
* `signal?: AbortSignal` on `autoLayout` / `layoutGraph` / `layoutChen`: an aborted request rejects with an `AbortError` (`isAbortError(e)`) immediately - never a grid fallback -
  its late result is ignored, and when no other request waits the worker is terminated (the next layout starts a fresh one). Callers that supersede a request (Convert preview) should abort the old one.
* `configureElk({ mode: 'auto' | 'worker' | 'thread', workerFactory })`, `disposeElk()`, `elkStats` are test/diagnostic hooks.
* Public entry points exported from `index.ts` are thin lazy wrappers (`autoLayout`, `layoutGraph`, `layoutChen`); `chenLoopPolylines` (sync, diagnostic) is imported from `@/layout/chenLayout`.

## Conventions / limits
* Deterministic AND independent of the opaque ids: `autoLayout` orders nodes by a semantic key (kind, name, owner path and
  sibling order, from the model; the drawn label when no model is available), ids are only the final tie-break; ELK only
  ever sees canonical ids (`n0..`) and a fixed seed. Renaming/re-randomising ids therefore never changes a layout (two nodes
  with identical semantic keys still tie-break by id).
* `stress` above `STRESS_MAX_NODES` (220) silently runs `force`: ELK stress has a cubic set-up cost (500 nodes ~ 18 s).
* Measured on an idle machine (node, Apple silicon, vitest, real horizontal scenes by the reviewer): 150 tables layered ~0.3 s;
  500 tables layered ~6.5 s, stress/force ~4-11 s (synthetic 500-node tree: layered ~2 s, force ~4-8 s, radial ~0.7 s, rectpacking
  0.1 s); Chen with ~600 nodes ~3.6 s. ELK itself now runs in a worker in the browser (the page keeps painting: max frame gap 17 ms vs 1.5-3 s in-thread for 60 Chen entities, see docs/PERFORMANCE.md); the Chen post-processing and the overlap passes still run on the main thread. `layered` drops to thoroughness 3
  above 200 nodes. Timings roughly double on a loaded machine.
* Collision checks use bounding boxes (conservative for ellipses/diamonds). Clearance guarantees: chen attributes >= `round(spacing/3)` (13 at default), relational >= `spacing` (non-layered algorithms: `clearance`, default `spacing`; every algorithm ends with a plain no-overlap check). Snapping may reduce the relational gap to 60 at worst.
* `nudgeOutOfOverlap` converges: a work-bounded pairwise push first (minimal displacement), then a greedy legaliser that re-places every
  remaining violator in the nearest free spot (grid-accelerated). Result has no pair closer than `gap` unless both rects are fixed.
* Edge routing is NOT done here (the scene router does it); layout only leaves room (>= 60 between rows/columns).
* `testScenes.ts` / `layoutAssert.ts` are test helpers (hand-built Scene fixtures incl. Pharmacy ER / relational); set `VISUAL=1` to dump `.tmp/layout/chen-*.svg`.
