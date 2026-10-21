# Testing

Rule of this project: a check counts only when it actually ran and you saw it pass. Skipped tiers are skipped, not passed. This file says
what each tier proves, how to run it, how to read a failure, and why the browser tiers can fail for reasons that are not bugs.

## Tiers at a glance

| Tier | Command | Proves | Needs |
|---|---|---|---|
| Type-check | `npm run typecheck` (`tsc --noEmit`; covers `src`, `e2e`, `scripts`) | Types compile, TypeScript 7 | - |
| Unit and in-process integration | `npm test` (`npx vitest run`) | Domain model, ops, conversion, validation, scene geometry, render output, SQL, export, i18n parity, jsdom component behaviour, pipeline tests | - |
| Production build | `npm run build` (type-check + `vite build`) | The app bundles; base path `/schemacanvas/` (`SC_BASE` overrides) | - |
| Browser (Playwright) | `npm run test:e2e` | The real app in Chromium: pointer and keyboard interaction, dialogs, panels, persistence, exports, a11y (axe) | `npx playwright install chromium` |
| Acceptance | `npx playwright test e2e/acceptance` | product specification "Definition of Done" and the conversion matrix as user scenarios, driven only through the UI; results read from downloaded files | same |
| Visual dumps | `VISUAL=1 npx vitest run <file>` | Nothing by itself: writes SVG to `.tmp/...` for you to rasterise and look at | Chromium for `svg2png` |
| Performance | `PERF=1 npx vitest run ...`, `npm run e2e:perf` | Budgets and measurements (below) | build for `preview` / `subfolder` modes |
| Browser integration tier | `INTEGRATION_BROWSER=1 npx vitest run src/integration/p3-browser.test.ts` | Every example, all option variants: nothing painted outside the SVG viewBox in real Chromium | Chromium |
| PostgreSQL tier | `INTEGRATION_PG=1 npx vitest run src/integration/p4-pg.test.ts` | Generated PostgreSQL DDL executes on a real server; every PK/FK present in `information_schema`; composite FK enforced | PostgreSQL 14 binaries |
| Cross-browser | `npm run e2e:cross` (`playwright.cross.config.ts`) | The acceptance suite (`e2e/acceptance`) in Firefox and WebKit | `npx playwright install firefox webkit` |
| Production smoke | `node scripts/smoke-prod.mjs <chromium\|firefox\|webkit\|all> <url>` (see below) | A built site served under its base path, with real mouse and keyboard input: 29 steps, zero console/page errors, failed requests or CSP violations | `npx playwright install chromium firefox webkit`; a running build, e.g. `npm run serve:dist` |
| MySQL tier | `INTEGRATION_MYSQL=1 npx vitest run src/integration/p4-mysql.test.ts` | Generated MySQL DDL executes on a real MySQL 8.4 server (every example, DDL option variants, hand-built hard cases); tables, PK order, FKs (composite, column order, actions), NOT NULL and UNIQUE read back from `information_schema`; composite FK enforced | Docker container `schemacanvas-mysql` (override `MYSQL_CONTAINER`; root password `sc`) |

Not covered by any tier: MySQL versions other than the 8.4 container, non-default server charsets (the generator assumes utf8mb4 when sizing untyped key columns), the non-acceptance browser folders in Firefox/WebKit, real desktop Safari, collaboration or cloud (not built).

## Unit and in-process integration (Vitest)

`npx vitest run` runs every `src/**/*.test.{ts,tsx}` (about 20 s; the exact totals are in the Verification section of [RELEASE.md](../RELEASE.md)). Tests are co-located with the
code. Run one area with `npx vitest run src/conversion`, one file with its path, one test with `-t "name"`. Files are in the Node environment unless
they carry a `// @vitest-environment jsdom` docblock (component tests). Skipped tests are the gated tiers (VISUAL, PERF strictness, INTEGRATION_*, dev dumps).

What the areas prove:

* `src/model` (+ `ops`, `io`): ids and invariants, every op's cascade table, undo-safe immutability (inputs are deep-frozen), serialisation round-trips,
  migrations and rejection of bad files.
* `src/conversion`: Examples A-E plus invariants (every ER element is traced, every rule's outcome, 1:1 variants, weak-entity chains, recursion, n-ary keys).
* `src/validation`: each rule on positive and negative fixtures, and robustness against malformed models.
* `src/scene`, `src/render`: geometry assertions rather than eyeballing: an FK arrow's last point lies on the border of the exact target cell and is
  perpendicular to it; random moves never re-point an FK; connectors avoid tables; labels do not overlap; SVG hygiene (no markers, concrete colours).
* `src/editor`, `src/ui`, `src/store`, `src/persistence`: jsdom interaction (hit-testing, tools, dialogs, focus), store transactions and undo/redo,
  autosave through `fake-indexeddb`, unavailable-storage behaviour.
* `src/export`, `src/sql`: SVG structure and determinism, PNG/PDF layout maths, DDL golden files for PostgreSQL/SQLite/MySQL, DDL executed in-process on SQLite
  (`node:sqlite`), DDL and DBML round-trips, parser error positions.
* `src/i18n`: every key exists in `en` and `zh`, placeholders match between languages, Chinese glossary consistency.
* `src/integration`: whole pipelines with nothing mocked (see its [README](../src/integration/README.md)).

**Reading a failure.** The assertion message names the example, element or code involved. For conversion failures read the decision/trace in the message;
for geometry failures the coordinates are printed (compare with the FK's source and target cell). The i18n tests print the namespace and key.
Tests that use `useDeterministicIds()` / `useFixedClock()` must restore them in `afterEach`; a failure that appears only after another test in the same file
usually means a leaked fixture.

## Browser tests (Playwright)

* Config: `playwright.config.ts`: Chromium, 1440x900, one worker, 60 s per test. It starts its own Vite dev server on port **5199**; `E2E_PORT=5247` uses another
  (and reuses a server already listening there). Always give parallel sessions distinct ports and private output folders:

  ```bash
  E2E_PORT=5247 npx playwright test e2e/export --reporter=line --output=.tmp/mine/results
  ```
* Folders: `acceptance` (44), `htable` (horizontal table editing), `editor`, `editor2` (canvas, keyboard, perf), `editor-tools` (connect, FK tool, resize, edge editing, attributes), `libdrag` (consecutive library drags with the inline editor open), `panels-a` / `panels-b` /
  `panels-fixes` (library, properties, issues, visual and axe sweeps in light/dark x en/zh), `shell` / `shell2` / `shell3` (toolbar, tabs, docks, replacement, narrow
  screens, layout busy state), `export` (SVG/PNG/PDF files parsed and checked), `examples`, `i18n` (Chinese sweep and an overflow detector), `crows`, `validation`, `perf`.
  Counts per folder change; `npx playwright test --list` prints the current total.
* `npm run e2e:all` / `npm run test:e2e` run everything serially (about a quarter of an hour on a quiet machine).
* **Production smoke** (`scripts/smoke-prod.mjs`): one engine or all three, against any URL. It covers cold load under the URL's path, fonts, the
  Pharmacy example in ER and relational views, FK arrow tips on their target cells, table moves, building a Chen diagram, validation, conversion,
  undo/redo, auto-layout in the ELK worker, project save and reopen, SVG/PNG/PDF, MySQL/PostgreSQL SQL and DBML export, SQL import with a
  composite foreign key, autosave reload, and Chinese and dark theme. It exits 1 on any failed step, console error or warning, page error,
  failed request, HTTP status 400 or above, or Content-Security-Policy violation. Downloads and screenshots go to `.tmp/smoke/<engine>/`.

  ```bash
  npm run build && npm run serve:dist &                       # serves dist/ at http://127.0.0.1:4173/schemacanvas/
  node scripts/smoke-prod.mjs all http://127.0.0.1:4173/schemacanvas/
  node scripts/smoke-prod.mjs all https://xipuwang.github.io/schemacanvas/   # after a deployment
  ```

  Read a failure from the printed step name; the page errors and failed URLs are printed after it.
* **Acceptance** helpers (`e2e/acceptance/helpers.ts`) use only the UI (real pointer events, HTML5 drag from the library, file chooser, downloads) and read state from the DOM or from
  files the app downloaded. No window hooks.
* **Performance and hosting** (`e2e/perf`, own config `e2e/perf/playwright.perf.config.ts`): modes `dev`, `preview` (`vite preview` of `dist/`) and `subfolder` (`dist/` under
  `/schemacanvas/`, 404 outside; proves the production base path). Metrics land in `.tmp/perf/metrics-<mode>.json`. `PERF=1` additionally turns the budgets in
  `src/editor/dragPerf.test.ts`, `src/integration/p6-scale.test.ts` (default budget 15 s per stage, 3 s with PERF=1) and `e2e/editor2/perf.spec.ts` into strict ones.

**Reading a failure.** Playwright prints the locator and the step. Failure screenshots go to the output folder (the default config writes `e2e/.results`; pass `--output`
to keep the repository clean and delete the folder afterwards, screenshots are large). Re-run the single failing spec alone first: `npx playwright test <file>:<line>`.

### Load sensitivity (read this before chasing a failure)

The browser tiers talk to a dev server, a real Chromium and, for layout, an ELK worker. On a busy machine, timing-sensitive steps (the lazy convert/export chunks loading, ELK,
animations, a 60 s test timeout) can fail while the product is fine. Rules of thumb:

* A failure that disappears when the spec is re-run alone, or that is a timeout waiting for a dialog or a lazy chunk, is load, not a regression.
* The dev server reloads the page when a source file changes. If someone (or a parallel worker) edits `src/` during a run, tests fail with "waiting for navigation to finish". For a
  stable run against fixed code, build once (`npx vite build --outDir .tmp/stable --emptyOutDir`), serve it (`node scripts/serve-static.mjs .tmp/stable 5247 /`) and point the run at it
  (`E2E_PORT=5247`; the config reuses a server that is already listening). Specs that load the `harness/*` pages (`e2e/export`, `e2e/examples`, `e2e/editor`, `e2e/editor-tools`, `e2e/editor2`) need the dev server and cannot run this way.
* The documentation screenshot script was verified deterministic only under that stable-build condition (three consecutive runs, byte-identical PNGs).
* Performance numbers vary with machine load; ratios (worker vs in-thread ELK) matter more than absolute milliseconds. The strict budgets are for `PERF=1` runs on a quiet machine.

## Visual verification

Geometry assertions are primary; pictures are for what assertions miss (wrong symbol, crossing, clipped text). Procedure:

```bash
VISUAL=1 npx vitest run src/examples/visual.test.ts         # also src/render/{chen,horizontal,vertical}/visual.test.tsx
node scripts/svg2png.mjs .tmp/examples/<file>.svg .tmp/examples/<file>.png   # real Chromium
```

then open the PNG and look. Artifacts stay under `.tmp/` (not part of the product). The Playwright suites `panels-a/visual.spec.ts` and `e2e/export` take screenshots of the live app.

## Documentation checks

* `node scripts/gen-shortcuts.mjs --check` fails when `docs/SHORTCUTS.md` no longer matches the command registry.
* `node scripts/docs-screenshots.mjs <baseUrl>` regenerates `docs/img/*.png` from the running app (see README); it exits non-zero on page errors.
