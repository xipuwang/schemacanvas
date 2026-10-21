# src/ui/panels/issues — the Issues dock (PANELS-B)

`index.ts` registers `registerDock('issues', IssuesDock)`. Strings: `src/i18n/messages/panels-issues.ts` (namespace `issuesPanel`).

* `IssuesDock.tsx`: reads `uiStore.issues`; severity chips with counts (toggle filters), stale badge + Validate (runs the shell command
  `diagram.validate`), empty state, rows sorted error > warning > info, title / explanation / suggestion through `localizeIssue`, affected
  elements named with `describeRef`. The focused issue (`uiStore.focusedIssueId`, which also drives the canvas halo) expands its details.
  Keyboard: Arrow Up/Down/Home/End move between rows (roving tabindex), Enter focuses the issue, Escape returns to the canvas.
* `issueActions.ts` (tested): `focusIssueOnCanvas` = `resolveRefsInDiagram` -> `store.setSelection(ids, sub)` (column or foreign-key
  sub-selection when that is what is affected) -> `canvas.fitToNodes` (an FK-only issue fits both endpoint tables). An issue whose refs are
  not on the active diagram's model gets "Show in <diagram>" (`findOtherDiagram`, `showIssueInDiagram`, `selectRefsOnDiagram`, which waits
  for the new canvas to mount before fitting).
* Tests: `issues.test.tsx` (jsdom) and the e2e spec `e2e/panels-b/panels.spec.ts`.

* Registered lazily (`index.ts` uses `lazyPanel`/`lazyDock`/`lazyDialog` from `../../dialogs/content/lazy`): this panel is its own chunk, loaded right after startup (library) or on demand (issues dock, diagram options dialog) and not part of the entry bundle.
