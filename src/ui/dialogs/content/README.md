# src/ui/dialogs/content — convert, export, import, examples and SQL (PANELS-B)

Registered from `index.ts` (imported by `src/ui/register.ts`). **All dialog and dock modules load lazily** (`lazy.tsx`: `lazyDialog`/`lazyDock`/`lazyPanel` = `React.lazy` + `Suspense`): registration is synchronous, the chunk loads on first use behind the real `<Dialog>` frame (same title, size and CSS class as the loaded dialog, `dialogs.css` is eager so nothing jumps; spinner `data-testid="lazy-loading"`), and a failed chunk shows the same frame with an error and Retry (`data-testid="lazy-error"`, strings `lazyload.*` in `src/i18n/messages/lazyload.ts`). The SQL/DBML parsers, the converter, the example catalogue and the export pipeline are therefore out of the entry bundle; jsPDF/svg2pdf load on the first PDF export. `panels/{library,properties,issues}/index.ts` use the same helpers. New dialogs registered elsewhere should use `lazyDialog` too (a statically imported dialog drags its dependencies into the entry): dialog kinds `convert`, `export`, `import`, `examples`, `sql`, the `sql` bottom dock,
and two palette/menu commands, `view.showSql` (opens the SQL dock) and `file.sqlDialog` (opens the dialog). Strings: `src/i18n/messages/dialogs.ts`
(namespace `dialogs`, en + zh; it also merges two keys into `commands`). Styles: `dialogs.css` (tokens only).

Every flow is a pure module with unit tests; the dialogs only wire options to the flow and render the result. All semantic edits are
`store.commit` + `ops` (ONE undo step per Apply/Import).

| Folder | Flow module (tested) | UI |
|---|---|---|
| `convert/` | `convertFlow.ts`: `planConversion` (convertErToRelational -> temp project via `ops.applyConversionResult` on an immer draft -> `buildScene` -> `autoLayout` -> positions by relation id), `applyPlan` (ONE commit + activate the diagram), `renderPlanSvg`, option helpers (`withOverride`, `withMaterialized`, `pruneOptions`, `findPreviousConversion`, `listOneToOneRelationships`, `listDerivedAttributes`) | `ConvertDialog.tsx`: options column + live preview tabs (Decisions, Warnings, Mapping, Result). The preview shows the SAME plan Apply commits, recomputed 250 ms after the last option change. Re-convert ("Update ... in place") uses `env.previous` + `replaceModelId` and shows the kept / overwritten / dropped report. Mapping and decision chips close the dialog and select the ER element. |
| `export/` | `exportFlow.ts`: `exportOptionsFor`, `runExport` (images via `exportDiagram`, project via `exportProjectJson`, SQL/DBML via `src/sql`), `classifyExportWarning` (English library warnings -> catalogue keys), `defaultFilename`, `withExtension` | `ExportDialog.tsx`: format list, per-format options, live image preview (pure `renderExportSvg`), the real result is prepared in the background so warnings (e.g. the CJK PDF image fallback) show BEFORE Download; PNG pixel size / clamp notice; Copy image. SQL/DBML export uses the active relational model or, on an ER sheet, the model of its latest conversion. |
| `import/` | `importFlow.ts`: `parseImport` (never silent: `line`, `column`, `offset`, excerpt with the caret), `applyModelImport` (temp project -> `autoLayout` -> ONE `ops.addModel` commit, activates the new diagram), `parseProjectText` | `ImportDialog.tsx`: tabs SQL / DBML / Project file, paste or choose a file, dialect, error panel + "Go to the error", localized warnings, summary. A `.sql` / `.dbml` file dropped on the window opens it (`FileDrop` passes `{ file }`). |
| `examples/` | `examplesFlow.ts`: `filterExamples`, `openExample(id, view)` (`store.loadProject(buildExample)` + activate the ER or relational sheet; the dialog itself opens through the shell's `replaceProject`, which keeps the previous project in Recent projects and offers "Reopen previous") | `ExamplesDialog.tsx`: radiogroup gallery (arrow keys in 2-D, Enter opens, double-click opens), ER / relational thumbnail toggle (also decides which sheet opens), search; no own confirm any more (the replace helper asks only when the previous project cannot be saved). |
| `sql/` | `sqlOutput.ts` (`buildSqlOutput`, `activeRelationalModel`, `exportSourceModel`), `highlight.ts` (lossless SQL/DBML tokenizer) | `SqlView.tsx` (dock + dialog), `CodeView.tsx` (mono, CSS line numbers, rendering capped at 3000 lines with a notice; Copy/Download always use the full text). |

`common.tsx`: `Notice`, `IssueList` (localizeIssue), `SeverityIcon`, `useDebounced`, `copyText`.

## Tests
* `npx vitest run src/ui/dialogs src/ui/panels/issues` (flows, tokenizer, DOM tests of the issues dock, i18n key coverage in `keys.test.ts`).
* `E2E_PORT=5212 npx playwright test e2e/panels-b --output=.tmp/panels-b/results` on the real app; screenshots in `.tmp/panels-b/`.

## Known gaps
* Wide layout: the toolbar has no Import / SQL entry (only palette, compact File menu and drop); not changed here because the toolbar is shell-owned.
* Import of a `.json` project asks to confirm via the shell's discard dialog only when the project is dirty.
* Parser / generator messages (`SqlParseError.message`, DDL issue text when no catalogue entry exists) are English; the position and framing are localized.
* The convert preview lays out with ELK on every change (about a second for the largest examples); it is debounced and stale runs are discarded.
