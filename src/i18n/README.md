# src/i18n — localisation (en, zh)

`t(key, params)` / `useT()` / `tp(key, count)` from `core.ts`; per-feature catalogues in `messages/<file>.ts`
(`defineMessages(namespace, { en, zh })`, namespaces merge). Formatting helpers in `format.ts`; Chinese vocabulary in
`GLOSSARY.md`.

## Logic-module messages (validation, conversion, SQL, errors)

The logic modules write ENGLISH text plus a stable `code` and `params`. The UI shows the localised text:

```ts
import { localizeIssue, localizeDecision, localizeRule } from '@/i18n';
localizeIssue(issue)      // { title, explanation, suggestion, localized }   (issue.code + issue.params)
localizeDecision(decision) // { title, explanation, localized }              (decision.params.kind ?? ruleId)
localizeRule('weak-entity') // generic description of a conversion rule (legend / trace panel)
localizeLoadError(e) / localizeOpError(e) / localizeInvariant(v)   // src/i18n/errors.ts, for toasts
```

A triple is localised only when ALL parts exist for the locale, else the whole item falls back to the module's English
text (`localized: false`), so a user never reads half-translated advice. Decisions saved by older builds carry no `params`
and stay English.

| Source | Catalogue file | Key |
|---|---|---|
| validation rules `er.*`, `rel.*` | `messages/issues.ts` | `issues.<code>.title\|explanation\|suggestion` |
| conversion warnings `conv.*` (+ ops `conv.hand-added-*`, `conv.edits-overwritten`) | `messages/conversion.ts` | same |
| DDL `ddl.<dialect>.<x>` | `messages/ddl.ts` | `issues.ddl.<x>` (dialect variants `….explanation.mysql`) |
| SQL / DBML import `sql.import.*`, `dbml.import.*`, DBML export `dbml.export.*` | `messages/ddl.ts` | `issues.<code>.…`, shared advice `issues.import.suggestion` |
| conversion decisions | `messages/decisions.ts` | `decisions.<kind>.title\|explanation` (+ `.frag.<sel>.<value>`) |
| conversion rules (general) | `messages/decisions.ts` | `decisions.rule.<ruleId>.title\|explanation` |
| LoadError / OpError / invariants | `messages/errors.ts` | `errors.load.<code>`, `errors.op.<code>`, `errors.invariant.<code>` |

Template features (see the header of `issues.ts`): `{param}`; **variants** `<part>.<variant>` chosen by `params.variant`,
`params.<part>Variant`, the dialect, or `one`/`other` from `params.count`; **fragments** `{>selector}` pulling
`<base>.frag.<selector>.<params.selector>`; **sentinels** param values `@i18n:<key>`; import warnings get `{at}`.

### Adding or changing a message

1. The module emits `code` + `params` (`Issue.params`, `ConversionDecision.params`, `WarnInit.params`); keep its English text.
2. Add the code to the closed list (`src/conversion/codes.ts`, `src/sql/codes.ts`; validation rules register themselves).
   The emitters are typed with these lists, so an unlisted code does not compile.
3. Add rows `[key, en, zh]` to the catalogue (`build.ts`: `issue()`, `variant()`, `fromRows()`).
4. `npx vitest run src/i18n` — the inventory test fails until en + zh exist, the corpus test fails when the English catalogue
   differs from the module text or the Chinese keeps `{placeholders}` or an English phrase.
5. Broad check (dev tooling): `npx vitest run --config src/i18n/probe/vitest.config.ts src/validation src/conversion src/sql src/model src/integration src/examples`
   runs the whole suite with every produced Issue / decision verified (reaches the hundreds of unusual models in the suites).

## Tests

| File | Guards |
|---|---|
| `i18n.test.ts` | core: interpolation, fallback, plurals, merge |
| `messages.test.ts` | every code has en + zh; no orphan keys; English = module text, zh clean, over examples / broken models / DDL / SQL + DBML import |
| `catalogue.test.ts` | all namespaces: literal `t()` keys exist, placeholder parity, no empty / copied zh, plural completeness, glossary |
| `glossary.test.ts` | Chinese vocabulary over ALL catalogues: forbidden variants (所有者, 校验, 字段, 参与度, 父表 …, see `GLOSSARY.md`), convert dialog speaks 关系模式 / 属性, zh `{params}` equal to en, balanced braces, no straight quotes around Chinese names. `PENDING` lists violations in files other workers own |
| `format.test.ts` | counts, lists, relative times, dates |

## Known limits

* English text with computed lists in unusual states (several vanished columns on both sides of a foreign key, two or more
  deleted columns in a key) is reproduced exactly only in the common single-item case; the Chinese text always follows the
  structured params.
* `conv.hand-added-dropped | renamed` and `conv.edits-overwritten` list English detail lines (`params.details`, produced in
  `src/model/ops/conversion.ts`) in the English text only; the Chinese text states the count and relies on highlighting.
* Import errors (`SqlParseError`, thrown, ~100 distinct messages) are not localised; only import *warnings* are.
* `MigrationError` / `LoadError.message` details (`path`, versions) stay English in logs; toasts use `localizeLoadError`.

## Chinese UI overflow sweep (Playwright)

`e2e/i18n/zh-sweep.spec.ts` drives the real app in zh at 1440 / 900 / 390 px, light and dark, through the toolbar and its
tooltips, library, examples / convert (all tabs) / export (all formats) / import (all tabs) / SQL / diagram options / shortcuts /
settings / about / new-project dialogs, selection panels (entity, weak entity, relationship, identifying relationship,
attribute, multi-selection, connector, table, column, foreign key), context menus, issues and SQL docks, toasts, the command
palette and the status bar. After each surface `e2e/i18n/overflow.ts` reports clipped text (ellipsis / overflow hidden with
content wider or taller than the box), text painted outside the viewport or outside a clipping ancestor, horizontal page
scroll, and axe serious / critical violations; the console must stay clean. Screenshots go to `.tmp/i18n/`.
Run: `E2E_PORT=<port> npx playwright test e2e/i18n --output=.tmp/i18n/results`. When other people edit sources while it runs, the
dev server hot-reloads mid-test; run it against `vite build --outDir .tmp/i18n/dist` + `vite preview` on the same port instead.


## Loading (on demand)

Authoring is unchanged (one file per feature, `en` and `zh` side by side). `scripts/vite-i18n-split.ts` evaluates those files and serves two generated modules per file (`<file>.ts?locale=en` / `?locale=zh`), so the app bundle carries English only:

* English catalogues are eager, except the validation / conversion / DDL texts (`issues`, `conversion`, `ddl`, `decisions`), which are deferred: until `loadLocale('en')` has run (main.tsx does it right after the first paint) `localizeIssue` / `localizeDecision` return the identical English text the logic modules write.
* `loadLocale('zh')` fetches the Chinese chunk; `main.tsx` awaits it before the first render when zh is persisted, and Settings switches language through `setLocaleLoaded()` (flips only after the load; latest request wins; a failed download keeps the current language and shows an error toast, a superseded one is silent).
* Tests load everything through `src/i18n/testSetup.ts` (vitest `setupFiles`).
* Default sheet names are stored in English and shown localized: `displayDiagramName()` (src/i18n/defaultNames.ts); user-chosen names are shown as stored.
