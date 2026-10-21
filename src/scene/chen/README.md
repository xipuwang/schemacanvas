# scene/chen + render/chen: Chen ER notation

Public API
- `buildChenScene(input: SceneBuildInput): Scene` (`src/scene/chen/index.ts`, registered by `scene/registry.ts`).
- Geometry kinds (`types.ts`): `chen-entity`, `chen-attribute`, `chen-relationship` (nodes), `chen-line` (edges, `lineKind: 'participant' | 'attribute'`).
- `metrics.ts`: `DEFAULT_NODE_STROKE`, `DEFAULT_EDGE_STROKE`, `DOUBLE_INSET` (4), `RAIL_GAP` (4), `nodeFont`, `nodeStrokeWidth`.
- `fixtures.ts`: dev/test ER fixtures (`exampleA..D`, `ternary`, `associative`, `pharmacy`, `ALL_FIXTURES`) and `layoutChenFixture(fixture, tweak?)`.
  The layout helper is NOT the product auto-layout; it fans attributes around owners so fixtures are legible.
- Views: `import '@/render/chen'` registers the four views (`render/chen/NodeViews.tsx`, `EdgeView.tsx`).

Conventions
- Notation comes strictly from stored data: `weak` -> double rectangle, `identifying` -> double diamond, `participation: 'total'` -> two rails,
  `multivalued` -> double ellipse, `derived` -> dashed ellipse (`geom.dashed`), `key: 'primary'|'partial'` -> `label.underline` solid|dashed.
- `bounds` = outer outline box without stroke, `bounds.x/y === node.x/y`; `paintBounds` adds stroke + label rect; edge `bounds` are paint bounds (paths, rails, labels).
- Manual `node.width/height` = outer outline size, clamped only to the text fit (cosmetic minimums apply to auto size only).
- Sizes: ellipse text box corners lie on the ellipse; diamond fits `w'/W + h'/H <= 1` against the INNER diamond for double diamonds.
- Associative entity: rectangle with `innerDiamond` (inset 8); the relationship has no node, its edges attach to the entity (`nodeIdOfRef`).
- Edge ends: straight = ray between centres clipped by `boundaryPoint`; `AnchorSpec` = `sidePoint(outline rect, side, offset)` projected with
  `boundaryPoint`. Orthogonal = `routeOrthogonal` from side points; edges sharing a node side get spread offsets (explicit offsets reserve slots).
- Recursive participation (several participants of one entity, auto route): elbow loops on different sides (top/bottom when the diamond is
  beside the entity, left/right when above/below); a manual route replaces the loop. `ChenEdgeGeom.recursive` flags them.
- Total participation: `rails` (offsetPolyline +-2), each end re-intersected with the real outline. `paths = [centre, rail1, rail2]`.
- Labels: cardinality (`cardinalityText`) just outside the entity end, beside the line, avoiding all other edge paths; role (italic, backdrop)
  at the middle of the longest segment on the side away from the nodes' centroid. `labelOffsets` are added afterwards and folded into bounds.
- `autoWaypoints`: interior corners of the auto route (router stub corners excluded); for manual routes the stored waypoints.
- Dangling edges/nodes are skipped with warnings `chen-edge-dangling:<id>`, `chen-edge-self:<id>`, `chen-node-dangling:<id>`.
- Views draw strokes/fills only; labels are drawn by SceneSvgCore. No markers, no text-decoration, no selection chrome.

Verification
- `npx vitest run src/scene/chen src/render/chen`
- Visual: `VISUAL=1 npx vitest run src/render/chen/visual.test.tsx`, then `node scripts/svg2png.mjs .tmp/chen/<name>.svg .tmp/chen/<name>.png` and look.

## Review fixes
- Double notation: `doubleInset(sw)` / `railGap(sw)` (metrics.ts) = max(4, strokeWidth + 2.5); used for node insets, text fit, rails and label offsets, so the two strokes never merge.
- Recursive loops are placed after all other lines: side (preferred first), nesting layer and level are searched until the loop crosses no node, shares no segment with another line and attaches away from other attachment points. Nested loops attach at mirrored offsets at both ends.
- Labels (cardinality first, role second) are tested against exact node outlines, other lines, their own line (except the last segment) and previously placed labels; fewest hits wins when nothing is clear.
- Collision queries use a uniform grid (collide.ts) and analytic segment-rect tests (scene build ~4x faster on 350 participation edges, straight routing).
- Orthogonal routing: a direct Z / L path is preferred when it is clean (planned sides first, other free sides after); otherwise the shared router runs as before. Router output is de-duplicated.

## Draft quality (additive, see ../draft.ts)

`SceneBuildInput.quality: 'draft'` + `previous` (a full scene with its diagram / model): untouched edges are reused by identity and the
others get cheap provisional Chen geometry (no router); `quality` omitted or `'full'` is byte identical to before. Used by the canvas
only while a drag transaction is open; tests in `../draft.test.ts`.
