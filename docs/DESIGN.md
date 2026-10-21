# SchemaCanvas — interface design

**Subject.** A drafting instrument for people who need exact database diagrams: students working to textbook notation and
engineers modelling real schemas. The chrome recedes; the *sheet* (canvas) is the hero.

**The one bold move — the chrome speaks the notation.** In the horizontal schema notation *underline = key*, *italic = foreign key*,
amber tint = PK, sky tint = FK. The interface reuses that vocabulary so it teaches the notation while you work:

* the properties panel header shows the selected relation as a live miniature **single-row table** (same cells, same marks);
* column rows carry the same underline / italic / tint marks as the canvas;
* the active diagram tab is **underlined in key-gold**, like a primary key;
* issue severity colours are the canvas halo colours.

**Tokens** live in `src/ui/theme/tokens.css` (light + dark). Type: *Atkinson Hyperlegible Next* (UI — designed so `I l 1` and `O 0` cannot be confused,
which matters for identifiers like `SSN` and `Id`) and *JetBrains Mono* only for SQL / DBML / identifier fields. Sentence case; no all-caps labels,
no eyebrow labels, no middle-dot meta strings, no arrows appended to buttons.

**Structure.** Docked flush panels divided by 1px rules (not floating cards); 3px control radius, 6px popovers; depth by tonal steps — shadows only on
menus, popovers and dialogs. Motion only in response to an action (panel/dialog open, 120 ms) and always disabled under `prefers-reduced-motion`.

**Layout (≥ 1100 px).**

```
┌──────────────────────────────────────────────────────────────────────────┐
│ toolbar: file · edit · diagram (auto-layout, validate, convert) · export  │
├────────┬─────────────────────────────────────────────────────┬───────────┤
│ parts  │ sheet tabs: ER diagram ▔▔▔▔ │ Relational schema │ +    │ properties│
│ drawer │ ┌─────────────────────────────────────────────────┐ │ (selection│
│ (Chen: │ │                                                 │ │  aware)   │
│ entity │ │                  the sheet                      │ │           │
│ attrs… │ │                                                 │ │           │
│ )      │ └─────────────────────────────────────────────────┘ │           │
│        ├─────────────────────────────────────────────────────┤           │
│        │ issues dock (collapsible)                           │           │
├────────┴─────────────────────────────────────────────────────┴───────────┤
│ status: zoom · selection · saved state · issue counts                     │
└──────────────────────────────────────────────────────────────────────────┘
```
Below 1100 px the side docks become drawers toggled from the toolbar; below 700 px the sheet fills the screen with a bottom sheet for properties.

**Writing.** Sentence case, plain verbs, action names stay the same through a flow ("Convert" → "Converted 8 tables"), errors say what happened and what to do,
empty states invite action ("Drag an entity onto the sheet, or open an example").

**Quality floor.** Visible focus ring on every control (`--focus-ring`), full keyboard operation, ≥ 4.5:1 text contrast in both themes, reduced motion respected,
no horizontal page scroll at any width.
