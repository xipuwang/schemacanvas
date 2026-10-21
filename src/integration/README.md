# src/integration: end-to-end pipeline tests

These tests drive the REAL modules together (erBuilder -> Project -> real store -> ops -> convert -> validate -> layout -> scene
-> render -> sql). Nothing is mocked. Test files use `// @vitest-environment node`; most import `./deterministic` (sequential ids +
fixed clock) because auto-layout and label placement depend on id ORDER (see "Known defects").

## Tiers

| Tier | Command | External processes | Time |
|---|---|---|---|
| Default | `npx vitest run src/integration` | none (node:sqlite is in-process) | ~10 s |
| Browser | `INTEGRATION_BROWSER=1 npx vitest run src/integration/p3-browser.test.ts` | Playwright Chromium | ~5 s |
| PostgreSQL | `INTEGRATION_PG=1 npx vitest run src/integration/p4-pg.test.ts` | throwaway PostgreSQL 14 | ~5 s |
| MySQL | `INTEGRATION_MYSQL=1 npx vitest run src/integration/p4-mysql.test.ts` | running Docker container `schemacanvas-mysql` (MySQL 8.4, root pw `sc`) | ~20 s |

* **Browser**: for examples A-E and the option variants, the union of `getBBox` of every painted element (mapped into viewBox space with the CTM)
  must lie inside the SVG viewBox (no clipping). Needs the Chromium used by `scripts/svg2png.mjs`.
* **PostgreSQL**: creates `/tmp/sc-pg-integ` (initdb `--auth=trust`, port 55438, `listen_addresses=''`, socket dir inside that folder),
  runs the generated DDL, checks `pg_constraint` counts and composite-FK enforcement, then ALWAYS stops the cluster and deletes the folder.
  It refuses to run if port 55438 is listening or the folder exists. Binaries: `PG_BIN` (default `/opt/homebrew/opt/postgresql@14/bin`).
* **MySQL**: talks to an EXISTING container through `docker exec -i <container> mysql` (`MYSQL_CONTAINER` overrides the name; no client library).
  Each case gets a fresh `sc_t_*` database, dropped afterwards; the container is never started or stopped by the test. The re-import
  round-trip block at the end of the file is not gated and runs in the default tier.
* **Visual**: the render tests write `.tmp/integration/<example>-<chen|relational>.svg` (and `E-<type>-<variant>.svg`); rasterise with
  `node scripts/svg2png.mjs .tmp/integration/E-relational.svg .tmp/integration/E-relational.png` and LOOK at the PNG.

## Files

| File | Pipeline |
|---|---|
| `p1-model.test.ts`, `p1b-semantics.test.ts` | P1: convert -> one store commit -> invariants -> validation -> undo/redo -> JSON round trip; spec schema per example |
| `p2-layout-scene.test.ts` | P2: Chen + relational layout through `ops.setNodePositions`; FK branches end on the exact referenced cells; random moves never re-point an FK |
| `p2b-quality.test.ts`, `p2c-variant-quality.test.ts` | drawing quality (lines vs nodes, labels vs everything) default + option matrix (seed sweeps) |
| `p2d-known-defects.test.ts` | deterministic replays (fixtures in `fixtures/`) of defects that only show for some random ids |
| `p3-render.test.ts`, `p3b-options.test.ts`, `p3-browser.test.ts` | P3: SVG hygiene, option matrix, real-Chromium clipping |
| `p4-sql.test.ts`, `p4-pg.test.ts`, `p4-mysql.test.ts` | P4: sqlite execution, DDL/DBML round trips, PostgreSQL, MySQL |
| `p5-editing.test.ts` | P5: scripted editing session, undo/redo of every step, autosave through fake-indexeddb |
| `p6-scale.test.ts` | P6: 60 entities / 150+ attributes / 80 relationships; per-stage timings in `.tmp/integration/scale.json` |
| `p7-extra.test.ts` | kitchen-sink model x 1:1 option matrix; re-conversion in place |
| `helpers.ts`, `fkAssert.ts`, `renderAll.ts`, `sqlSig.ts`, `deterministic.ts` | shared helpers |

## Performance budgets (PERF=1)

`p6-scale.test.ts` records per-stage timings in `.tmp/integration/scale.json`. The default budget per stage is 15 s (5x the strict
3 s) so loaded machines do not flake; `PERF=1 npx vitest run src/integration/p6-scale.test.ts` enforces the strict 3 s budget.

## Fixed defects (now plain regression assertions)

* HSTRAIGHT-1 (p2c): relational `routing:'straight'` connectors no longer cross foreign tables.
* HROUTE-1 (p2d): auto-routed FK connectors no longer run through foreign tables (fixture replay).
* CHEN-LABEL-1 (p2c): cardinality labels avoid attribute ellipses for minmax / large fonts.
* CHEN-LABEL-3 (p2d): same for default options (fixture replay).
* CHEN-ORTHO-1 (p2c): Chen `routing:'orthogonal'` links no longer run through other nodes.

## Open failures (intentionally red until the Chen code is fixed)

* `p2b example E Chen: no label rectangle overlaps a node ... or another label`.
* `p2c orthogonal-noroles: edge labels vs nodes and each other` (fails for all 40 seeds).
