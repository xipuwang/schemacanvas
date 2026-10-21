# Chinese glossary

The vocabulary of Chinese database textbooks (《数据库系统概念》, 《数据库系统概论》), used by every Chinese message of the logic
modules (`messages/issues.ts`, `conversion.ts`, `ddl.ts`, `decisions.ts`, `errors.ts`) and expected from the UI catalogues.
`catalogue.test.ts` fails when a catalogue uses one of the avoided variants listed last.

## Terms

| English | 中文 | Note |
|---|---|---|
| entity / strong entity | 实体 / 强实体 | not 实体集 (the product models instances, not sets) |
| weak entity | 弱实体 | |
| owner entity (of a weak entity) | 属主实体 | only this term (SQL object ownership is 拥有者) |
| identifying relationship | 标识联系 | drawn as a double diamond (双菱形) |
| attribute | 属性 | |
| composite / multivalued / derived attribute | 复合属性 / 多值属性 / 派生属性 | |
| key attribute / primary key | 键属性 / 主键 | |
| partial key (discriminator) | 部分键 | dashed underline (虚线下划线) |
| candidate key / foreign key | 候选键 / 外键 | |
| relationship | 联系 | ER concept; never 关系 (that is the relational one) |
| recursive / ternary / n-ary relationship | 递归联系 / 三元联系 / n 元联系 | |
| role | 角色 | |
| cardinality / cardinality label | 基数 / 基数标注 | Chen labels are read *across* the relationship (跨联系读取, look-across) |
| participation / total / partial | 参与约束 / 全部参与 / 部分参与 | total = double line (双线) |
| associative entity | 关联实体 | |
| relation | 关系模式 | the relational-model element (UI: 表 in table-like panels) |
| tuple / row | 元组 / 行 | 元组 in model explanations, 行 next to SQL |
| column (relational diagram) | 属性 | in `rel.*` / `conv.*`; **列** in `ddl.*` / SQL |
| table (SQL) | 表 | in `ddl.*` and import / export text |
| unique constraint / NOT NULL | 唯一约束 / NOT NULL | SQL keywords stay in English: PRIMARY KEY, UNIQUE, NOT NULL, CHECK, CASCADE |
| referential action | 参照动作 | |
| conversion / convert | 转换 | ER → relational; never 生成 for this |
| schema (SQL namespace) | schema (running text) / 命名空间 (labels) | not 模式 (clashes with 关系模式) |
| dialect | 数据库方言 | PostgreSQL, MySQL, SQLite keep their names; "standard SQL" = 通用 SQL |
| normal form / functional dependency | 范式 / 函数依赖 | reserved for the later normalisation diagrams |

Quotes: names are written between “ ” in Chinese text (straight `"` in English). Sentence case, no all-caps labels.

## Context rule: 关系模式 / 属性 versus 表 / 列

The English product itself distinguishes *relation* (the relational-model element) from *table* (a drawn / SQL element). The
Chinese UI follows the same split, so a student never meets two words for one thing in one place:

| Context | Element | 中文 |
|---|---|---|
| Relational model semantics: validation (`rel.*`), conversion warnings and decisions (`conv.*`), the **ER → relational convert dialog** (`dialogs` `convert.*`), diagram-type names, templates of relational schemas | relation / its fields | **关系模式 / 属性** (never 表 / 列 / 字段) |
| SQL-facing text: DDL notes (`ddl.*`), import / export / SQL / DBML dialogs, data types, physical model | table / column | **表 / 列** |
| Diagram-editing controls of the table element (library "表", `properties` `kind.table`, `col.*`, `fk.*`, `editorTools` `fk.*`) | table / column | **表 / 列** — this element is shared by the horizontal relational schema, Crow's Foot and physical diagrams and edits SQL-level details (data type, AUTO_INCREMENT, DEFAULT, indexes), so the SQL words are the honest ones. |

Other fixed choices made in this pass: owner of a weak entity = **属主实体** everywhere (SQL object ownership, a different
thing, = 拥有者); validate = **检查** (never 验证 / 校验); relational field = never 字段; parent / child table = 被引用的表 /
引用的表 (`被参照与参照关系模式` in the template title); SQL namespace `schema` = **命名空间** in labels; participation =
**参与约束** (never 参与度).

## Avoided variants (checked by `glossary.test.ts` and `catalogue.test.ts`)

外部键 外码 → 外键 · 主码 → 主键 · 候选码 → 候选键 · 组合属性 → 复合属性 · 完全参与 / 总参与 / 全参与 → 全部参与 · 局部参与 → 部分参与 ·
导出属性 / 衍生属性 → 派生属性 · 联系集 → 联系 · 实体集 / 强实体集 / 弱实体集 → 实体 / 强实体 / 弱实体 · 识别联系 → 标识联系 ·
所有者 / 所属实体 → 属主实体 · 参与度 → 参与约束 · 校验 / 验证 → 检查 · 字段 → 属性 or 列 · 父表 / 子表 → 被引用的表 / 引用的表.
`glossary.test.ts` also fails when a zh value uses other `{params}` than the English text, when braces are unbalanced, and when the
convert dialog says 表 / 列. Pending violations in files other workers own are listed (exact key) in its `PENDING` table.

## Terminology decisions applied

* Crow's Foot = **鸭脚** everywhere (`diagramType.crows-foot` 鸭脚 ER 图, `about.description` 鸭脚模型, properties 鸭脚图); 鸦脚 is avoided.
* Grid snapping = **对齐网格** in every catalogue (`settings.snap`, `view.toggleSnap`, `properties.grid.snap`). 吸附网格 is avoided; the align tools keep 对齐 as a verb (左对齐 ...).
* Pan / hand: the toolbar button is **平移** (English "Pan"); the tool itself (library, commands, announcements) is **抓手 / 抓手工具** (English "Hand").
* `newProject.startRelDesc` = 空白的横向关系模式图，用于关系模式和外键。 (relational-model context rule).
* Participation connector = **参与线** (`sel.participant`, `kind.participant`, `tool.connect.desc`).
* Partial key attribute add action = 添加部分键属性 (`attr.partialKey`, `chen.addPartialKeyAttribute`).
* Duplicate vs copy: Copy = 复制, Cut = 剪切, Paste = 粘贴, Duplicate (`edit.duplicate`, `tabs.duplicate`) = **创建副本**; the tab label is 创建图表副本.

## Quality read-back: before / after

| Key | Before | After | Why |
|---|---|---|---|
| `properties.entity.weakDesc` | 通过所属实体及自身的部分键来标识。 | 由属主实体的键与自身的部分键共同标识。 | canonical owner term; "共同" states the composite identification |
| `properties.entity.ownedBy` | 通过 {relationship} 由 {owner} 标识。 | 经由 {relationship}，由 {owner} 标识。 | the earlier "通过…由…" read as a double passive |
| `properties.rel.participation` / `setParticipation` / `identifiedDesc` | 参与度 | 参与约束 | glossary term (参与度 sounds like a measure) |
| `properties.fk.childMax` / `childMin` / `parentMin` | 每个父行的子行数（最多）… | 每个被引用行对应的引用行数（最多）… | 父 / 子 are not relational terms; says which side is counted |
| `properties.pk.compositeHint` | 复合键：此处的顺序即生成 SQL 中的顺序。 | 复合键：此处的顺序即 SQL 中的列顺序。 | shorter, precise |
| `properties.table.schema` | 模式 | 命名空间 | 模式 collides with 关系模式 |
| `library.part.weakEntity.desc`, `part.identifying.desc`, `properties.attr.derivedFromEmpty`, `rel.identifyingDesc` | 所属实体 / 所有者 | 属主实体 | one owner term |
| `library.sample.relationship` | 关联 | 联系 | 关联 is the associative entity |
| `properties.route.anchorHint` | …指向别的字段。 | …指向别的列。 | no 字段 |
| `properties.diagram.dialectDesc` | 用于校验和 SQL 导出。 | 用于检查和 SQL 导出。 | one verb for validate |
| `dialogs.convert.strategy.merge` / `relation` (+ `Desc`) | 合并为一张表 / 为联系单独建表 | 合并为一个关系模式 / 联系单独成为关系模式 | conversion speaks the relational model |
| `dialogs.convert.kind.relation` / `kind.column` / `columns` | 表 / 列 | 关系模式 / 属性 | same |
| `dialogs.convert.tables.*`, `resultAlt` | {count} 张表 | {count} 个关系模式 | same (quantifier 个 for 关系模式) |
| `dialogs.convert.strategyDesc.auto` | （全参与） | （全部参与） | glossary term |
| `dialogs.import.diagramName` | 导入的模式 | 导入的关系模式 | 模式 alone is ambiguous |
| `examples.template.parent-child.*`, `link-table.*` | 父表与子表 / 连接表 … | 被参照与参照关系模式 / 连接关系模式 … | relational-model vocabulary |
| `examples.composite-multivalued.description` | 展开为原子列 … 各生成一张关系 | 展开为原子属性 … 各转换为一个关系模式 | 生成 for "convert" avoided; 关系 alone is wrong |
| `issues.er.key-multivalued.explanation` | 它所属实体的键 | 它所在实体的键 | no 所属实体 |
| `ddl.owner` (OWNER TO) | 表的所有者 | 表的拥有者 | SQL ownership is not 属主实体 |

## Review: the 15 messages a student meets first

Each row was read back against the English text and the underlying database semantics.

| # | Code | 中文 (title) | Check |
|---|---|---|---|
| 1 | `er.entity-no-key` | 实体“Student”没有键 | “键” (not 主键) is right: an entity has key attributes, the *relation* gets the primary key. Explanation says the generated 关系模式 lacks a 主键. |
| 2 | `er.weak-no-owner` | 弱实体“Drug”没有属主实体 | 属主实体 is the textbook owner; explanation names the double-diamond fix. |
| 3 | `er.weak-no-partial-key` | 弱实体“Drug”没有部分键 | Adds the exception "at most one per owner" exactly as the English does (no false error for 1:1 identification). |
| 4 | `rel.no-primary-key` | 关系模式“Student”没有主键 | 元组（行）= tuple/row; "其他关系模式也无法可靠地引用它" is the referential reason. |
| 5 | `rel.fk-target-not-key` | 外键“Prescription.(CompanyName, DrugTradeName) → Drug.(CompanyName)”引用的属性不构成目标关系模式的键 | The classic composite-FK mistake. First wording ("没有引用一个键") read as "references no key"; changed to say the *referenced attributes do not form* the key. The `partial` variant names the missing key attributes. |
| 6 | `rel.fk-column-missing` | “Patient.DoctorSSN → Doctor.SSN”引用了不存在的属性 | Source / target side stated with their relation; a vanished column shows （已删除） instead of an English placeholder. |
| 7 | `rel.fk-type-mismatch` | “…”中的数据类型不匹配 | “类型不兼容” plus the consequence (rejected or silently cast) kept from the English. |
| 8 | `rel.pk-nullable` | “Student”中存在可为空的主键属性 | 主键属性必须为 NOT NULL — SQL keyword kept in English on purpose. |
| 9 | `rel.fk-total-but-nullable` | 必选的外键“…”允许为 NULL | Three causes (declared / relationship relation / total participation) each get their own sentence; no "mandatory" claim is invented for ordinary FKs. |
| 10 | `er.identifying-partial` | “Makes”中弱实体一侧不是全部参与 | 全部参与 (double line) is the participation constraint of the weak side; "依附属主实体而存在" is the existence dependency. |
| 11 | `er.identifying-owner-many` | “Makes”的属主实体“Company”为“多” | The explanation states the *look-across* reading of Chen labels (基数标注按“跨联系”方式阅读) — a literal translation would have been wrong. |
| 12 | `er.key-multivalued` | 键属性“Phones”是多值属性 | Reason is semantic: a multivalued attribute becomes its own 关系模式 so cannot key its entity. |
| 13 | `er.total-on-one-side` | “Doctor”的“至少一个”约束无法强制执行 | 外键只能强制“多”的一侧引用“一”的一侧 — correct direction; offers trigger / assertion / application check. |
| 14 | `er.relationship-key-vs-cardinality` | “Prescription”的键与它的基数相冲突 | Candidate keys are listed neutrally (`("Doctor","Patient")`) so no English word (role) leaks into Chinese; fallback behaviour ("退回使用…第一个键") matches the converter. |
| 15 | `er.cardinality-label-conflict` | 标注“N”与“Doctor”的基数相矛盾 | 最大基数 “一” / “多” per variant; advice differs per case (use label 1, or letter label N/M/P). |

Critical read-back notes: (a) “键” vs “主键” kept distinct in ER (键) and relational (主键) messages; (b) `schema` is left
untranslated because 模式 would collide with 关系模式; (c) the converter's `Issue` text for the unusual case of an unnamed
element renders as （未命名）, mirroring the English `(unnamed)`.
