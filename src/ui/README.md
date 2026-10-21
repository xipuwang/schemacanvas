# src/ui — application chrome and design system (UI-SHELL worker)

Design language: `docs/DESIGN.md`; tokens: `src/ui/theme/tokens.css` (use only these variables for chrome colours).

## Layout of the code
| Path | What |
|---|---|
| `icons/` | `<Icon name size label?/>` — 70 inline-SVG icons on a 16px grid (`currentColor`, `aria-hidden` unless `label`). `ICON_NAMES`, `ICON_ALIASES` (`pointer`→`select`, `fit`→`zoom-fit`, `distribute-horizontal`…), `resolveIcon`. Add a glyph = add a key in `paths.ts`. |
| `components/` | Accessible primitives, all exported from `@/ui/components` (also imports `components.css`): `Button`, `IconButton` (requires `label`; tooltip with shortcut), `Tooltip`, `Dialog`, `MenuButton` / `MenuList` / `ContextMenu` / `useContextMenu` (data-driven `MenuEntry[]`: item, checkable item, separator, label), `Popover`, `Layer` (positioned portal), `Tabs`, `SegmentedControl`, `Switch`, `Checkbox`, `Field`, `TextField`, `Textarea`, `NumberField`, `Select`, `ColorField`, `Kbd`, `Badge`, `ToastHost` (reads `uiStore.toasts`), `EmptyState`, `Separator`, `Spinner`, `VisuallyHidden`, focus helpers (`trapTab`, `useScrollLock`, `useReturnFocus`, `useOutsidePress`). |
| `theme/useResolvedTheme.ts` | `useResolvedTheme(): 'light'\|'dark'` (system follows the OS live) — the canvas picks its palette from it; `useApplyTheme()` (sets `<html data-theme lang>`), `applyThemeNow()`. |
| `shell/` | `AppShell`, `Toolbar`, `SheetTabs`, docks, status bar, command palette, file drop, shell commands, startup. See below. |
| `dialogs/registry.ts` | `registerDialog(kind, Component<{props, onClose}>)`, `getDialog`. The host (`shell/DialogHost.tsx`) renders the component for `uiStore.dialog.kind`; unregistered kinds show a "Not available yet" placeholder. |

## Extension points for the panels worker
```ts
import { registerPanel, registerDock } from '@/ui/shell';
registerPanel('library' | 'properties', Component);   // side docks / drawers (no props)
registerDock('issues' | 'sql', Component);            // bottom dock (driven by uiStore.dock)
import { registerDialog } from '@/ui/dialogs/registry';
registerDialog('export' | 'import' | 'examples' | 'convert' | 'sql' | 'diagram-options' | 'new-diagram', Component);
import { confirmDialog } from '@/ui/shell';            // await confirmDialog({title, message, danger?}) -> boolean
```
Dialog components render their own `<Dialog title onClose …>`; `onClose` is `uiStore.closeDialog`.
Strings: contribute catalogues with `defineMessages` in `src/i18n/messages/<yourfile>.ts` (both `en` and `zh`).

## Shell-owned commands (ids; labels `commands.<id>` in `i18n/messages/commands-shell.ts`)
`file.new` (confirms if dirty, opens `new-project`), `file.open` (picker → `openProjectFromFile`; also drop a file anywhere), `file.save` (Mod+S, download + `markSaved`),
`file.export` (Mod+Shift+E → dialog `export`), `file.import`, `file.examples`, `diagram.validate` (F8; model of the active diagram, + `ddlIssues` for relational; opens the issues dock),
`diagram.convert` (enabled for Chen diagrams only), `diagram.options`, `help.shortcuts` (`?`, F1), `help.about`, `settings` (Mod+,), `palette.open` (Mod+K),
`view.togglePanel.library|properties|issues` (Mod+B / Mod+I / Mod+J; in the medium/narrow layouts they toggle drawers).

The toolbar binds to editor command ids `edit.undo`, `edit.redo`, `tool.select`, `tool.hand`, `layout.auto` and builds its Arrange / View menus from every registered command of group `arrange` / `view` at open time; missing commands render disabled.
A window-level key handler (`shell/keyboard.ts`) runs shortcuts the canvas did not consume (`defaultPrevented`); inside text fields only file/help/settings/palette commands run.

## Behaviour notes
* Startup (`shell/startup.ts`, `startApp()`): `loadAutosave` → else `newProject`; `startAutosave`; live validation (400 ms debounce after model changes; flag `shellStore.liveValidation`, persisted in localStorage `schemacanvas:shell:v1` together with dock sizes); `beforeunload` warning only when dirty and persistence is unavailable/errored.
* Layouts: ≥1100 three columns with draggable and keyboard-resizable docks (ArrowKeys ±16, Shift ±48, Home/End, double-click resets); 700–1100 docks are drawers; <700 canvas + bottom sheet and a compact toolbar (File menu, undo/redo, panel toggles, "More commands").
* Status bar: zoom (LIVE, `useViewportInfo()` of the canvas; the stored `diagram.viewport.zoom` only before the canvas reports), selection count, issue counts (click toggles the issues dock), persistence state.
* Tests: `src/ui/**/*.test.tsx` (jsdom), `src/ui/shell/keys.test.ts` (every literal i18n key exists in en+zh), e2e `e2e/shell/shell.spec.ts` (`E2E_PORT=5202 npx playwright test e2e/shell --output=.tmp/shell/results`), gallery `harness/shell/index.html`.

## Replacing the project safely (SHELL-2)
* `shell/replace.ts` `replaceProject(next, { label, activeDiagramId?, repairs?, verb? })` is the ONLY way to swap the open project: new project, open file, drop, example, project import, recent. If the current project has content (`projectHasContent`: any entity / attribute / relationship / relation / diagram node) it is first written with `saveSnapshot` (autosave slot + `project:<id>` + meta = a "recent" entry), the project is replaced, and a toast with the action **Reopen previous** (12 s, pauses on hover/focus) reports it. Empty projects are replaced silently. If the snapshot cannot be written AND there are unsaved changes the old `confirmDialog` ("Discard unsaved changes?") appears. A replacement with the SAME project id gets a fresh id so autosave cannot overwrite the kept copy. `confirmDiscardIfDirty` (alias of `confirmDiscardUnlessSaved`) is for flows that open a dialog before replacing (`file.new`).
* `ToastMessage.action?: { label, onSelect }` (uiStore) renders a keyboard-accessible button in `ToastHost`. While a dialog is open the toast stack picks bottom, else top, so it never covers the dialog's footer actions; below 700 px it spans the screen width.
* Recent projects: dialog kind `recent` (`dialogs/recent/`, registered from `registerShellDialogs`), command `file.recent`. Rows load lazily (`IntersectionObserver`): counts + a thumbnail of the first diagram with content (`renderSceneToSvgString`, loaded by dynamic import together with the dialog module via `lazyDialog`, so `react-dom/server` stays out of the entry bundle). Open = `loadRecent` -> `replaceProject`; Delete asks first; corrupt records raise an error toast with the localised LoadError; unavailable storage is explained.
* Layout busy state: the `layout.auto` toolbar button (`AutoLayoutButton` in `Toolbar.tsx`) reads `layoutBusyStore`; while ELK runs it shows a spinner + "Laying out…", is disabled, `aria-busy`, announces through a polite status region, and Esc (capture listener, only while busy) calls `cancelAutoLayout()` (`src/editor/commands/layout.ts`), which aborts the command's `AbortSignal`. The Convert dialog passes an `AbortSignal` to `planConversion` (aborted when an option changes, on Esc or on close) and shows "Laying out…" in its summary and a busy Convert button. Tests: `shell/layoutBusy.dom.test.tsx`, `e2e/shell/layout-busy.spec.ts`.
* File menu (wide toolbar text button + compact icon button, `fileMenuEntries()` in `Toolbar.tsx`): New, Open file, Open example, Recent projects, Save, Import SQL or DBML, Export, SQL and DBML view, with shortcuts.
* Welcome (`shell/Welcome.tsx`, shown on an EMPTY sheet under the canvas hint): Open an example / Add an entity (ER) or Add a table (relational) / Import SQL; "Don't show again" is remembered in `localStorage` (`schemacanvas:welcome:v1`), Hide is per session.
* Sheet tabs: drag to reorder (pointer, 5 px threshold, Escape cancels, no click after a drag) and Alt+ArrowLeft/Right; both commit `ops.reorderDiagrams` (one undo step) and announce the move in a live region.
* Project name: `ProjectName` in the toolbar (click to rename inline; `ops.renameProject`, blank ignored); the document title is `<name> - SchemaCanvas` with a leading bullet while unsaved.
* `shell.css` neutralises the editor's global `.sc-menu { position: fixed }` inside `.sc-menu-layer` (it made shared menus escape their Layer, so `Layer` could not measure/clamp them: the "More commands" menu clipped at the right edge).
* Tests: `shell/replace.dom.test.tsx`, `shell/shell2.test.tsx`, `dialogs/recent/RecentDialog.dom.test.tsx`; e2e `e2e/shell2/shell2.spec.ts` (`E2E_PORT=5221 npx playwright test e2e/shell2 --output=.tmp/shell2/results`).
