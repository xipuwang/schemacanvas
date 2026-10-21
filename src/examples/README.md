# src/examples: example projects and insertable templates

Examples double as correctness fixtures (product specification section 8). Everything here is deterministic and runs without a layout engine.

```ts
import { EXAMPLES, buildExample, renderExampleThumbnail, TEMPLATES, insertTemplate } from '@/examples';

EXAMPLES: ExampleDefinition[]     // { id, titleKey, descriptionKey, level, tags, build(): Project }
buildExample(id): Project          // throws on an unknown id
renderExampleThumbnail(id, 'er' | 'relational'): string      // standalone SVG string, cached per (id, kind)
TEMPLATES: TemplateDefinition[]    // { id, titleKey, descriptionKey, modelKind: 'er' | 'relational', build(): ClipboardPayload }
insertTemplate(draft, diagramId, templateId, at: Point): { nodeIds: Id[] }   // inside store.commit; ids remapped by ops.pasteClipboard
```

## Examples (in this order)

| id | what it shows | level |
|---|---|---|
| `composite-multivalued` (A) | composite Name/Address flattened, two multivalued relations, derived Age omitted | basic |
| `weak-entity` (B) | Company makes Drug, double diamond, Drug(CompanyName, TradeName, Formula) | basic |
| `recursive-1n` (C) | Employee manages Employee, `ManagerEid -> Eid` | basic |
| `recursive-mn` (D) | `PreReq(Cid, Req_Cid)` (literal names through `ConversionOptions.columnPrefixes`) | basic |
| `pharmacy` (E) | Doctor, Patient, Pharmacy, Company, weak Drug, Contact, Sell, Prescription (ternary), two composite FKs | advanced |
| `university` | associative entity Enrollment with Grade | intermediate |
| `company` | Elmasri-style Company database: recursive supervision, 1:1 manager, works-on with Hours, weak Dependent, multivalued Locations | intermediate |

`buildExample` returns a COMPLETE project: the ER model + Chen diagram (`ER diagram`), the relational model produced by the REAL
`convertErToRelational`, its horizontal diagram (`Relational schema`), and the ConversionRecord. `diagramOrder` is `[ER, relational]`, so the
ER diagram is the first (active) tab. Ids are sequential (`ent_1`, ...), timestamps are `2026-01-01T00:00:00.000Z`; the id generator and clock are
restored in `finally` (`deterministically()` in `build.ts`), so ids the user creates afterwards stay random. Two builds are deep-equal.

Every example validates with zero errors and zero warnings. Design decisions that keep it that way: in `company`, `WorksFor` is partial for
Employee (with `Manages` total on Department both FKs would be NOT NULL: `rel.fk-not-null-cycle`).
In `pharmacy`, `Sell` and `Contact` list Drug / Company first so the generated column order matches the layout (`CompanyName` before `PharmacyName`).

## Layout: frozen, keyed by name

`layouts.ts` holds hand-tuned top-left positions per example, keyed by ELEMENT NAME (`Student`, `Student.Name.First`, `Makes`; relational: the
relation name), see `nodeKeys.ts`. The positions were generated once with `autoLayout`, then tuned by hand against rendered PNGs and frozen:
no ELK at runtime, nothing depends on id order. `applyFrozenPositions` writes them at build time; a test fails when a node has no entry or an
entry is stale. `pharmacy` uses `compositeFkStyle: 'bracket'` and one anchor tweak (`ExampleSource.tweak`): with `branches`, two composite
FKs arriving at the same two key cells from opposite sides must cross.

Dev tools (skipped unless the env var is set):
* `EXAMPLES_DUMP=1 npx vitest run src/examples/devLayout.test.ts` writes `.tmp/examples/auto-<id>.json` (autoLayout positions + node sizes by name).
* `VISUAL=1 npx vitest run src/examples/visual.test.ts` writes `.tmp/examples/<id>-er|rel.svg` and `tpl-<id>.svg`; rasterise with
  `node scripts/svg2png.mjs in.svg out.png` and LOOK at it.

## Templates

ER: `weak-entity`, `many-to-many` (with relationship attribute), `recursive-1n`, `ternary`, `composite-multivalued`. Relational: `parent-child`
(FK child to parent), `link-table` (composite PK, two FKs). `build()` makes a tiny model + diagram with frozen centre positions and returns
`extractClipboard(...)` of all nodes; `insertTemplate` pastes it with its top-left at `at`. Inserting into a diagram of the other model kind throws
`OpError('paste-kind-mismatch')`. Names are not made unique on insert: a collision with an existing entity name is reported by validation
(`er.entity-name-duplicate`), like any paste.

## i18n

`src/i18n/messages/examples.ts` (namespace `examples`, en + zh): `examples.<id>.title|description`, `examples.level.<level>`,
`examples.template.<id>.title|description`. `ExampleDefinition.tags` are plain English keywords (not translated). The English project name /
description stored in the built project come from `catalog.ts`.

## Tests

* `npx vitest run src/examples`: per example (both models): zero errors/warnings, invariants, `syncDiagram` fixed point, serialize/load
  deep-equal, deterministic builds, every node placed, scene without warnings or node overlaps, FK branches/pairs and arrow tips on the exact cell,
  restored id generator and clock; literal conversion expectations (relation names, PKs, FK pairs) per example; templates (insert, remap, invariants,
  validation, kind mismatch); thumbnails.
* `E2E_PORT=5204 npx playwright test e2e/examples`: real Chromium on `harness/examples/`: no console errors, no horizontal scroll, painted bbox union
  inside the viewBox for all 14 thumbnails; screenshots in `.tmp/examples/shots/`.
