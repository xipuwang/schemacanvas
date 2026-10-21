# Parts library panel

`registerPanel('library', LibraryPanel)` and `registerTemplateInserter(insertTemplateAt)` happen in `index.ts` (imported by `src/ui/register.ts`).

* **Content follows the active diagram type** (`items.ts`): Chen shows Entities (entity, weak entity), Relationships (relationship, identifying), Attributes (simple, key, partial key,
  multivalued, derived, composite); relational families show Tables; Templates are `TEMPLATES` of the matching model kind. A Tools block binds to the commands `tool.select|hand|connect|fk`
  (`aria-disabled` + tooltip when a command is not registered; active state from `store.tool`; Connect only on Chen, Foreign key only on relational diagrams).
* **Previews are the real notation** (`previews.ts`): a tiny project is built with `model/builders`, run through `buildScene` and `renderSceneToSvgString` (transparent background, light or dark
  palette), cached per (part, diagram type, theme, locale). Attribute previews drop their scaffolding owner entity; template previews insert the template with `insertTemplate`.
* **Arming and dragging**: items are `draggable` (`LIBRARY_MIME` + `encodeLibraryItem`) and click-to-arm through `commandContext().canvas.armItem`; click again or Escape disarms; the armed item is
  highlighted (`aria-pressed`) and the hint line (`role=status`) says what the next click does. Arming is dropped when the active sheet changes.
* **Keyboard**: one tab stop for all parts (roving tabindex); arrows / Home / End move (up/down follow the visual rows), Enter or Space arm.
* **Search** matches the localized label and English keywords; **sections collapse** and the state is kept in `localStorage` (`schemacanvas:library:v1`, failure-safe).
* **Template inserter** (`templateInserter.ts`): centres the template on the drop point (grid-snapped when snap is on) and inserts it with ONE `commit`, returning the new node ids.
* Strings: `src/i18n/messages/panels-library.ts` (namespace `library`, en + zh). Styles: `library.css` (tokens only).
* Tests: `npx vitest run src/ui/panels/library`, e2e in `e2e/panels-a`.

* Registered lazily (`index.ts` uses `lazyPanel`/`lazyDock`/`lazyDialog` from `../../dialogs/content/lazy`): this panel is its own chunk, loaded right after startup (library) or on demand (issues dock, diagram options dialog) and not part of the entry bundle.
