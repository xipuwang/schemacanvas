# SchemaCanvas: known limitations and known issues

This page lists the deliberate and accepted gaps in v0.1.0 of SchemaCanvas. None of them is hidden behind a placeholder control.
Build and test commands are in [README.md](../README.md), and what each test tier covers is in [docs/TESTING.md](TESTING.md).
The verification results for the release are in [RELEASE.md](../RELEASE.md), "Verification (v0.1.0)".

## Known limitations

1. **MySQL charset assumption.** Generated MySQL DDL runs on a real MySQL 8.4 server (gated tier `INTEGRATION_MYSQL=1`, see [docs/TESTING.md](TESTING.md)). Untyped key columns are sized assuming utf8mb4 (InnoDB's 3072-byte key limit). Servers with another default charset were not tested. A key whose typed columns alone exceed the limit gets a `key-too-long` warning instead of a silent change. The script emits no `SET NAMES`, so run it with a utf8mb4 client connection (for example `mysql --default-character-set=utf8mb4`) when names are not ASCII.
2. **PDF and non-Latin text.** PDF uses the built-in Helvetica (WinAnsi). If any label contains other characters (for example Chinese), the whole page is embedded as an image. It is still correct to view, but its text is not selectable. The export dialog and result carry a warning.
3. **Connector routing is heuristic.** The router avoids tables and separates parallel lanes, but dense layouts can still cross connectors. The Pharmacy relational layout is asserted to have at most 5 proper crossings (and a tangled fixture at most 2). Lane order is a heuristic, not an optimum.
4. **Auto-layout (ELK) limits.** ELK runs in a Web Worker so the page stays responsive (the longest frame gap while it runs is about 17-33 ms, see [docs/PERFORMANCE.md](PERFORMANCE.md)). If the worker cannot be used, the in-thread fallback blocks the page for about 1.5-3 s on a 60-entity Chen diagram (290 nodes). The `stress` algorithm silently becomes `force` above 220 nodes, because its set-up cost is cubic. Results are good for the examples, but not guaranteed to be pretty for arbitrary graphs.
5. **Bundle size.** The initial JS is 246.9 KB gzip (785.9 KB raw), under the 250 KB target. Chinese loads on demand, and the SQL dialect checks and the issue and conversion texts load after first paint. ELK (about 442 KB gzip) and the PDF libraries are loaded only when used.
6. **Default sheet names follow the UI language at display time** (tabs, panels, outline). The stored name is unchanged. A name that exactly equals a default spelling counts as the default. Exported SVG titles and file names use the stored name.
7. **No collaboration, cloud storage, accounts, shareable links or version history.** These are P2 items in the product specification and are not built. Everything is local.
8. **No P2 diagram types.** UML class diagrams, functional dependency diagrams, normalization diagrams, schema dependency graphs and architecture diagrams are not implemented. The notation registry (`src/scene/registry.ts`, `src/render/registry.ts`) is the extension point.
9. **No reverse conversion** (relational to Chen) by design. The product specification does not require it, and the app does not claim it.
10. **Browsers.** The full suite runs in Chromium. The acceptance suite (the product specification's "Definition of Done") also runs in Firefox and WebKit (`npm run e2e:cross`), and the export tests were also run once in WebKit. Other folders were not run in Firefox or WebKit. Real Safari (as opposed to Playwright's WebKit) was not tested. `file://` does not work, because Chromium blocks the module and CSS loads from a `null` origin. Serve `dist/` over HTTP.
11. **Offline.** There is no service worker and no install prompt. The app works offline only from an already loaded page, or from a local copy served over HTTP.
12. **ER semantics scope.** Cardinality minimums other than 0 and 1 are out of scope. The near-side maximum of an n-ary relationship is not derived, so `(min,max)` labels fall back to `1, N, M` for n-ary relationships. Associative entities are supported by the model and the converter. They are created with "Make associative entity" in a relationship's properties, not from a library part.
13. **SQL import** handles a documented DDL subset and reports anything else with a position instead of guessing. It is not a full SQL parser.
14. **Touch input was not tested.** The editor is designed for mouse, trackpad and keyboard.
15. **Two browser tabs on the same origin share one autosave slot.** There is no cross-tab coordination or merge in the code (no BroadcastChannel or locks). Behaviour with two tabs editing at once was not tested, so assume the last write wins.
16. **SQL free text is deliberately strict.** Column types, DEFAULTs, CHECKs and index WHERE predicates are emitted only if an allow-list tokenizer accepts the whole text (`src/sql/sqlText.ts`). This is the defence against SQL injection through crafted project files. The following are refused with an `unsafe-sql-text` error and are not emitted:
    - a semicolon anywhere, even inside a literal;
    - comments, and backslashes outside PostgreSQL and SQLite literals;
    - dollar quoting, `E''` strings and MySQL `"..."` strings;
    - array constructors and subscripts, `COLLATE`, `AT TIME ZONE`, `IS DISTINCT FROM`, shift and JSON operators;
    - MySQL `CHARACTER SET` in a type.

    Ordinary defaults and checks pass. The tested list is in `src/sql/acceptFixtures.ts`.
17. **DBML export is sanitised for downstream converters.** Characters that dbml2sql does not escape safely are replaced in names and notes: quotes, backticks, brackets and backslashes, with apostrophes becoming ’. Literal defaults containing a quote are dropped, and unsafe types become `text`. Each change carries a warning.
18. **Some text is not translated.** In the Chinese UI, SQL and DBML import parser messages, example tags and default project, model and element names stay in English.
19. **Stored data is not pruned.**
    - The Recent projects list and its IndexedDB copies have no cap. Settings > Clear local data removes them.
    - The crash screen's "Start with an empty project" keeps up to 3 backups of the stored project, which can be downloaded from the crash screen. A `?empty-start=1` link starts empty without asking, but deletes nothing.
20. **All rights reserved; no licence is granted.** The repository has no open-source licence. The source is viewable but may not be reused. Third-party licences ship in `THIRD-PARTY-NOTICES.txt`.
21. **No security headers on GitHub Pages.** GitHub Pages cannot send response headers. The strict CSP and `no-referrer` are build-time `<meta>` tags, so `frame-ancestors` (clickjacking protection), `Permissions-Policy`, `Cross-Origin-Opener-Policy` and a custom `Cache-Control` are impossible on this host. `X-Content-Type-Options` and HSTS depend on GitHub's own settings, and the app cannot set them. Check them on the live site. The full table is in [RELEASE.md](../RELEASE.md).
22. **Base path build.** The production build targets `/schemacanvas/`. A copy served from a domain root or another path must be built with `SC_BASE` (for example `SC_BASE=/ npm run build`). The setting is applied at build time, not at run time.

## Known issues

1. **Timing guards are load-sensitive.** Several tests assert wall-clock bounds or run long property checks: the CHEN-4 dense scene build, the P6 scale test, LAYOUT-1 and LAYOUT-2, the SA-05 lane separation and the ELK 500-node run. They can time out on a heavily loaded machine and usually pass when rerun alone. The strict budgets live in the `PERF=1` tier. The ELK 500-node test uses a 15 s budget under `PERF=1` and a 45 s hang guard otherwise. On a busy machine, `npx vitest run --maxWorkers=4` reduces contention.
2. **Owner defaults cannot tell "explicitly many and partial" from "untouched".** If a user sets an owner to many and partial before the weak entity is connected, connecting the weak entity flips the owner to one. The validator still flags a many-owner.
