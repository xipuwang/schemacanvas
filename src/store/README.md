# store, model/io, persistence

Owned by the STORE worker. Contracts: ARCHITECTURE 5b (store) and 5c (file format).

## `src/model/io` — versioned file format

```ts
serializeProject(project, savedAt?): string        // ProjectFile envelope, pretty JSON
parseProjectFile(text, opts?): LoadResult          // text of a .schemacanvas.json
loadProjectData(raw: unknown, opts?): LoadResult   // same path for IndexedDB records (raw is cloned, never mutated)
migrations: Record<number, (raw) => unknown>       // n -> n+1 on the WHOLE envelope; EMPTY while SCHEMA_VERSION === 1
```

* Order: envelope/format check -> version gate (`newer-version`, `unsupported-version` when a step is missing) ->
  migrations (the machinery stamps `schemaVersion`) -> structural validation -> fill missing diagram option blocks/keys
  from `defaultDiagramOptions` -> `repairPresentation` (from `@/model/invariants`). `repairs` lists what was filled/fixed.
* Structural validation (`validate.ts`) checks required fields, JSON types and `record key === id`. It never copies or
  strips, so unknown properties survive load -> save verbatim (tested at every level). Semantic problems (dangling FK,
  no PK, ...) load as-is.
* `opts.migrations` / `opts.currentVersion` are test seams only. To add a real migration: bump `SCHEMA_VERSION`, set
  `migrations[<old>] = step` in `migrations.ts`, add a fixture test of the old shape.
* `testFixtures.ts` (`sampleProject()`, `largeProject(n)`) is for tests only.
* Note: `checkInvariants` (structural class) is NOT called by the loader; only `repairPresentation` is.

## `src/store` — editor store

```ts
import { editorStore, useEditorStore, createEditorStore } from '@/store';
const { commit, undo } = editorStore.getState();
const result = commit('Rename', (draft) => { draft.name = 'x'; return somethingForTheCaller; });
```

* State: `project` (deeply frozen), `activeDiagramId`, `selection {ids, sub?}`, `tool`, `dirty`, `lastSavedAt`,
  `undoStack/redoStack`, `canUndo/canRedo`, `inTransaction`. Subscribe with `editorStore.subscribe`.
* `commit(label, fn, {select?})`: one `set` per commit. A recipe that changes nothing (only the timestamp) records no
  history and notifies nobody. Throws inside a transaction.
* Transactions: `beginTransaction` (nested = throws) / `updateTransaction` (live, no history) / `endTransaction`
  (ONE merged entry) / `cancelTransaction` (inverse patches; harmless no-op when none open). `undo`/`redo` are ignored
  while a transaction is open. `setViewState` during a transaction is kept on cancel.
* `setViewState(diagramId, viewport)`: no history, no `dirty`, no `updatedAt`, but replaces `project` so autosave runs.
* Selection after undo/redo is `selectionBefore/After` filtered to ids that still exist anywhere in the project
  (`collectElementIds`). Deleting commits prune the selection the same way. Selection/tool never enter history.
* `loadProject` (clears history, freezes the object you pass in place), `newProject`, `replaceProject` (one undoable
  step, root replace patch), `markSaved(savedAt?, project?)` (pass the saved project so a newer edit stays `dirty`).
* History cap: `DEFAULT_HISTORY_LIMIT = 200`, or `createEditorStore({ historyLimit })`.
* `selectors.ts`: `selectActiveDiagram`, `selectActiveModel`, `selectProject`, `selectSelectedIds`. Never return fresh
  arrays/objects from a selector given to `useEditorStore` (zustand 5 would loop).
* `settings.ts`: `useSettings` / `settingsStore` (theme, locale, panel flags) persisted to localStorage, failure-safe.

## `src/persistence`

* `startAutosave(store, {delayMs=500, kv?}) -> stop` (NOT auto-started). Debounced, serialised writes; `flush()` writes
  now (also on `visibilitychange` hidden and `pagehide`). `stop()` cancels a pending save without writing.
* `saveSnapshot` writes `autosave:current`, `project:<id>` and `meta:<id>` atomically. `loadAutosave()` /
  `loadRecent(id)` return `LoadResult | null` (null = nothing stored OR storage unavailable). `listRecent`,
  `deleteRecent`, `clearAutosave`, `clear`.
* Nothing throws: failures become `getPersistenceStatus()` = idle | saving | saved | unavailable | error
  (`onPersistenceStatus(listener)` to react). Unavailable (private mode) keeps the editor working and `dirty` true.
* `downloadProjectFile(project) -> filename`, `openProjectFromFile(file) -> Promise<LoadResult>`,
  `projectFileName(name)`.
* Tests: `fake-indexeddb/auto`; `*.dom.test.ts` / `files.test.ts` use jsdom; `unavailable.test.ts` deliberately has no
  IndexedDB. Fake timers must only fake `setTimeout/clearTimeout` (fake-indexeddb needs the real `setImmediate`).

## Load hardening notes
- Loader rejects (invalid-structure) edge/node refs lacking id fields, diagrams whose `modelId` is not an own key of `models`, and files nested deeper than 200 levels; wrong-typed diagram option values are replaced by defaults (logged in `repairs`); prototype-named `diagramOrder` entries are dropped. Any throw during repair becomes a LoadError.
- Selection pruning (ids and `sub`) runs on every non-empty commit, since deletes may be array reassignments.
