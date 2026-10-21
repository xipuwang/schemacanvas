/**
 * Validation rules (`er.*`, `rel.*`): namespace `issues`, keys `<code>.title|explanation|suggestion` (+ `.<variant>`).
 * English reproduces the text of src/validation exactly (asserted by messages.test.ts); Chinese follows src/i18n/GLOSSARY.md.
 * Params are the ones the rule puts in `Issue.params` (see the rule's `params`).
 */
import { fromRows, issue, variant, type Row } from '../build';
import { defineMessages } from '../core';

const er: Row[] = [
  ...issue(
    'er.entity-name-empty',
    ['Entity has no name', '实体没有名称'],
    ['Every entity becomes a relation, and a relation cannot be created without a name.', '每个实体都会转换为一个关系模式，而关系模式必须有名称。'],
    ['Give the entity a name.', '为该实体命名。'],
  ),
  ...issue(
    'er.relationship-name-empty',
    ['Relationship has no name', '联系没有名称'],
    [
      'A relationship needs a verb-like name; M:N and n-ary relationships become relations named after it.',
      '联系应使用动词性的名称；M:N 联系和 n 元联系会转换为以该名称命名的关系模式。',
    ],
    ['Give the relationship a name such as "Works_for".', '为联系命名，例如“Works_for”。'],
  ),
  ...issue(
    'er.attribute-name-empty',
    ['Attribute has no name', '属性没有名称'],
    ['Every stored attribute becomes a column, and a column cannot be created without a name.', '每个存储的属性都会转换为关系模式的一个属性，而属性必须有名称。'],
    ['Give the attribute a name.', '为该属性命名。'],
  ),
  ...issue(
    'er.entity-name-duplicate',
    ['Duplicate entity name "{name}"', '实体名称重复：“{name}”'],
    [
      '{count} entities share this name. Each entity becomes a relation, and relation names must be unique.',
      '有 {count} 个实体使用了这个名称。每个实体都会转换为一个关系模式，而关系模式的名称必须唯一。',
    ],
    ['Rename one of the entities, or merge them if they model the same concept.', '重命名其中一个实体；如果它们表示同一个概念，请将它们合并。'],
  ),
  ...issue(
    'er.relationship-name-duplicate',
    ['Duplicate relationship name "{name}"', '联系名称重复：“{name}”'],
    [
      '{count} relationships share this name. Chen diagrams allow it, but relationship relations of an M:N or n-ary conversion would collide and get numeric suffixes.',
      '有 {count} 个联系使用了这个名称。Chen 图允许这样做，但 M:N 联系或 n 元联系转换出的关系模式会重名，并被自动加上数字后缀。',
    ],
    ['Give the relationships distinct names (e.g. "Teaches" and "Attends").', '为这些联系取互不相同的名称（例如“Teaches”和“Attends”）。'],
  ),
  ...issue(
    'er.attribute-name-duplicate',
    ['Duplicate attribute name "{name}"', '属性名称重复：“{name}”'],
    [
      '{count} attributes of "{owner}" share this name; they would become columns with the same name.',
      '“{owner}”有 {count} 个属性同名；它们会转换为同名的属性。',
    ],
    ['Rename one of the attributes.', '重命名其中一个属性。'],
  ),
  ...issue(
    'er.entity-no-key',
    ['Entity "{entity}" has no key', '实体“{entity}”没有键'],
    [
      'A strong entity needs at least one key attribute (underlined) to identify its instances; without it the generated relation has no primary key.',
      '强实体至少需要一个键属性（带下划线）来标识它的实例；否则生成的关系模式将没有主键。',
    ],
    [
      'Mark one or more attributes as the primary key, or make the entity weak if it depends on an owner.',
      '将一个或多个属性设为主键；如果该实体依赖于某个属主实体，请将它改为弱实体。',
    ],
  ),
  ...issue(
    'er.key-on-subattribute',
    ['Key flag on sub-attribute "{attribute}" is ignored', '子属性“{attribute}”上的键标记被忽略'],
    [
      'Only top-level attributes can be keys. The leaves of a composite attribute inherit the key flag of the top-level attribute, so this flag has no effect.',
      '只有顶层属性才能作为键。复合属性的各个叶子属性会继承顶层属性的键标记，因此这个标记不起作用。',
    ],
    [
      'Move the key flag to the composite attribute (all of its leaves become key columns), or clear it.',
      '将键标记移到复合属性上（它的所有叶子属性都会成为键属性），或清除该标记。',
    ],
  ),
  ...issue(
    'er.key-optional',
    ['Optional flag on key attribute "{attribute}" is ignored', '键属性“{attribute}”上的“可选”标记被忽略'],
    [
      'A key attribute identifies instances and is always converted to a NOT NULL column, so "optional" has no effect.',
      '键属性用于标识实例，总是转换为 NOT NULL 的属性，因此“可选”不起作用。',
    ],
    ['Clear the optional flag, or remove the key flag if the value may be absent.', '清除“可选”标记；如果该值允许缺失，则取消键标记。'],
  ),
  ...issue(
    'er.weak-primary-key',
    ['Weak entity "{entity}" has a full key', '弱实体“{entity}”带有完整的键'],
    [
      "A weak entity has no key of its own: its key is the owner's key plus a partial key. {attributes} will be converted like a partial key.",
      '弱实体没有自己的键：它的键由属主实体的键加上部分键构成。{attributes} 将按部分键处理。',
    ],
    [
      'Mark the attribute as a partial key (dashed underline) instead, or make the entity strong.',
      '请改为将该属性标记为部分键（虚线下划线），或将该实体改为强实体。',
    ],
  ),
  ...issue(
    'er.partial-key-on-strong',
    ['Partial key on strong entity "{entity}"', '强实体“{entity}”上有部分键'],
    [
      'A partial key only makes sense for weak entities. {attributes} is converted as an ordinary attribute.',
      '部分键只对弱实体有意义。{attributes} 将作为普通属性转换。',
    ],
    [
      'Make the entity weak (and add an identifying relationship), or turn the attribute into a primary key or plain attribute.',
      '将该实体改为弱实体（并添加标识联系），或将该属性改为主键或普通属性。',
    ],
  ),
  ...issue(
    'er.key-multivalued',
    ['Key attribute "{attribute}" is multivalued', '键属性“{attribute}”是多值属性'],
    [
      'A multivalued attribute becomes a separate relation, so it cannot be part of the key of its own entity.',
      '多值属性会转换为单独的关系模式，因此不能作为它所在实体的键的一部分。',
    ],
    ['Remove the key flag, or make the attribute single-valued.', '取消键标记，或将该属性改为单值属性。'],
  ),
  ...issue(
    'er.key-derived',
    ['Key attribute "{attribute}" is derived', '键属性“{attribute}”是派生属性'],
    ['Derived attributes are not stored, so they cannot identify rows.', '派生属性不会被存储，因此不能用来标识元组。'],
    ['Remove the key flag, or make the attribute a stored (non-derived) attribute.', '取消键标记，或将该属性改为存储属性（非派生属性）。'],
  ),
  ...issue(
    'er.weak-no-owner',
    ['Weak entity "{entity}" has no owner', '弱实体“{entity}”没有属主实体'],
    [
      'A weak entity is identified through an identifying relationship to an owner entity. None connects to it, so its primary key cannot be built.',
      '弱实体须经由标识联系，借助属主实体来标识。目前没有任何标识联系与它相连，因此无法构造它的主键。',
    ],
    [
      'Connect it to its owner with an identifying relationship (double diamond), or make the entity strong.',
      '用标识联系（双菱形）将它与属主实体相连，或将该实体改为强实体。',
    ],
  ),
  ...issue(
    'er.weak-no-partial-key',
    ['Weak entity "{entity}" has no partial key', '弱实体“{entity}”没有部分键'],
    [
      'Without a partial key, two instances of this weak entity with the same owner cannot be told apart (unless there is at most one per owner).',
      '没有部分键时，属于同一个属主实体的两个该弱实体实例无法区分（除非每个属主至多对应一个）。',
    ],
    ['Mark an attribute as the partial key (dashed underline).', '将一个属性标记为部分键（虚线下划线）。'],
  ),
  ...issue(
    'er.identifying-ambiguous',
    ['Identifying relationship "{relationship}" is ambiguous', '标识联系“{relationship}”含义不明确'],
    [
      'More than one participant is a weak entity and none is flagged as the identified side, so it is unclear who owns whom. The converter treats it as non-identifying.',
      '有多个参与者是弱实体，且没有一个被标记为被标识的一方，因此无法判断谁依附于谁。转换时会把它当作非标识联系处理。',
    ],
    ['Mark exactly the dependent participant as identified in the relationship properties.', '在联系属性中，只将依附的那个参与者标记为被标识方。'],
  ),
  ...issue(
    'er.identifying-identifies-nothing',
    ['Identifying relationship "{relationship}" identifies nothing', '标识联系“{relationship}”没有标识任何实体'],
    [
      'A double diamond connects a weak entity to its owner, but none of its participants is weak.',
      '双菱形用于连接弱实体与它的属主实体，但这个联系的参与者中没有弱实体。',
    ],
    [
      'Make the dependent entity weak, or turn the relationship into an ordinary (single-diamond) relationship.',
      '将依附的实体改为弱实体，或将该联系改为普通联系（单菱形）。',
    ],
  ),
  ...issue(
    'er.identified-not-weak',
    ['Identified entity "{entity}" is not weak', '被标识的实体“{entity}”不是弱实体'],
    [
      '"{relationship}" marks this participant as identified (dependent) but the entity is drawn as a strong entity.',
      '“{relationship}”将该参与者标记为被标识方（依附方），但这个实体被画成了强实体。',
    ],
    ['Make the entity weak, or clear the identified flag.', '将该实体改为弱实体，或清除“被标识”标记。'],
  ),
  ...issue(
    'er.identifying-partial',
    ['Weak side of "{relationship}" is not total', '“{relationship}”中弱实体一侧不是全部参与'],
    [
      'Every instance of "{entity}" exists only through its owner, so its participation in the identifying relationship must be total (double line).',
      '“{entity}”的每个实例都只能依附属主实体而存在，因此它在标识联系中必须是全部参与（双线）。',
    ],
    ['Set the participation of the weak entity to total.', '将弱实体的参与约束设为全部参与。'],
  ),
  ...issue(
    'er.identifying-owner-many',
    ["Owner \"{entity}\" of \"{relationship}\" is 'many'", '“{relationship}”的属主实体“{entity}”为“多”'],
    [
      "Cardinality labels read across the relationship: 'many' next to the owner means one weak instance could belong to several owner instances, which contradicts identification by the owner's key.",
      '基数标注按“跨联系”（look-across）方式阅读：属主实体旁标“多”，表示一个弱实体实例可能同时属于多个属主实例，这与依靠属主的键来标识弱实体相矛盾。',
    ],
    [
      "Set the owner's cardinality to 1 (the weak entity side is the 'many' side).",
      '将属主实体一侧的基数设为 1（弱实体一侧才是“多”的一侧）。',
    ],
  ),
  ...issue(
    'er.weak-ownership-cycle',
    ['Identification cycle: {entitiesQuoted}', '标识循环：{entitiesQuoted}'],
    [
      'Each of these entities needs the full key of another one in the cycle, so no primary key can be derived.',
      '这些实体中的每一个都需要循环中另一个实体的完整主键，因此无法推导出任何主键。',
    ],
    [
      'Break the cycle: make one entity strong (give it its own key) or remove one identifying relationship.',
      '打破循环：将其中一个实体改为强实体（赋予它自己的键），或删除一条标识联系。',
    ],
  ),
  variant('er.relationship-too-few-participants', 'title', 'one', 'Relationship "{relationship}" has {count} participant', '联系“{relationship}”只有 {count} 个参与者'),
  variant('er.relationship-too-few-participants', 'title', 'other', 'Relationship "{relationship}" has {count} participants', '联系“{relationship}”只有 {count} 个参与者'),
  [
    'er.relationship-too-few-participants.explanation',
    'A relationship relates at least two participants (a recursive relationship uses the same entity twice).',
    '联系至少要关联两个参与者（递归联系会两次使用同一个实体）。',
  ],
  ['er.relationship-too-few-participants.suggestion', 'Connect the relationship to another entity, or delete it.', '将该联系连接到另一个实体，或将它删除。'],
  ...issue(
    'er.participant-missing-entity',
    ['Relationship "{relationship}" has a dangling participant', '联系“{relationship}”存在悬空的参与者'],
    ['One of its participants references an entity that was deleted.', '它的某个参与者引用了一个已被删除的实体。'],
    ['Connect the participant to an existing entity or remove it.', '将该参与者连接到现有的实体，或将它移除。'],
  ),
  ['er.relationship-key-vs-cardinality.title', 'Key of "{relationship}" conflicts with its cardinalities', '“{relationship}”的键与它的基数相冲突'],
  variant(
    'er.relationship-key-vs-cardinality',
    'explanation',
    'unknown',
    '{unknown} chosen key participant(s) no longer belong to the relationship. The converter falls back to the first implied key.',
    '有 {unknown} 个所选的键参与者已不再属于该联系。转换时将退回使用由基数推出的第一个键。',
  ),
  variant(
    'er.relationship-key-vs-cardinality',
    'explanation',
    'invalid',
    'the chosen participants do not contain any key implied by the cardinalities, which is {candidates}. The converter falls back to the first implied key.',
    '所选的参与者不包含由基数推出的任何键；由基数推出的键为 {candidatesNeutral}。转换时将退回使用其中第一个键。',
  ),
  variant(
    'er.relationship-key-vs-cardinality',
    'explanation',
    'both',
    '{unknown} chosen key participant(s) no longer belong to the relationship; the chosen participants do not contain any key implied by the cardinalities, which is {candidates}. The converter falls back to the first implied key.',
    '有 {unknown} 个所选的键参与者已不再属于该联系；并且所选的参与者不包含由基数推出的任何键；由基数推出的键为 {candidatesNeutral}。转换时将退回使用其中第一个键。',
  ),
  [
    'er.relationship-key-vs-cardinality.suggestion',
    'Choose a key that contains a candidate key, or adjust the cardinalities.',
    '选择包含候选键的键，或调整基数。',
  ],
  ['er.cardinality-label-conflict.title', 'Label "{label}" contradicts cardinality of "{entity}"', '标注“{label}”与“{entity}”的基数相矛盾'],
  variant(
    'er.cardinality-label-conflict',
    'explanation',
    'max-one',
    "The participant's maximum is 'one', but its label says otherwise. The label is ignored and a derived one is drawn, so the diagram differs from what was typed.",
    '该参与者的最大基数为“一”，但它的标注表示的并非如此。该标注会被忽略，图中改画由基数推出的标注，因此显示的内容与所输入的不同。',
  ),
  variant(
    'er.cardinality-label-conflict',
    'explanation',
    'max-many',
    "The participant's maximum is 'many', but its label says otherwise. The label is ignored and a derived one is drawn, so the diagram differs from what was typed.",
    '该参与者的最大基数为“多”，但它的标注表示的并非如此。该标注会被忽略，图中改画由基数推出的标注，因此显示的内容与所输入的不同。',
  ),
  variant('er.cardinality-label-conflict', 'suggestion', 'max-one', 'Use the label 1, or set the cardinality to many.', '将标注改为 1，或将基数设为“多”。'),
  variant(
    'er.cardinality-label-conflict',
    'suggestion',
    'max-many',
    'Use a letter label (N, M, P), or set the cardinality to one.',
    '使用字母标注（N、M、P），或将基数设为“一”。',
  ),
  ...issue(
    'er.recursive-no-roles',
    ['Recursive relationship "{relationship}" has no role names', '递归联系“{relationship}”没有角色名'],
    [
      'When an entity plays several parts in one relationship, role labels (e.g. "supervisor" / "subordinate") say which line is which and name the generated foreign keys.',
      '当一个实体在同一个联系中扮演多个角色时，角色标注（例如“supervisor”/“subordinate”）用来说明各条连线分别对应哪个角色，并为生成的外键命名。',
    ],
    ['Add a role to each participant of the recursive relationship.', '为该递归联系的每个参与者添加角色名。'],
  ),
  ...issue(
    'er.associative-dangling',
    ['Associative entity "{entity}" has no relationship', '关联实体“{entity}”没有对应的联系'],
    [
      'It stands for a relationship that was deleted, so it cannot be converted as an associative entity.',
      '它所代表的联系已被删除，因此无法作为关联实体转换。',
    ],
    ['Reconnect it to a relationship, or turn it into an ordinary entity.', '将它重新连接到某个联系，或将它改为普通实体。'],
  ),
  ...issue(
    'er.associative-duplicate',
    ['Several associative entities for "{relationship}"', '“{relationship}”对应多个关联实体'],
    [
      '{count} entities ({entities}) stand for the same relationship; at most one may.',
      '有 {count} 个实体（{entities}）代表同一个联系；至多只能有一个。',
    ],
    ['Keep one associative entity and turn the others into ordinary entities.', '保留一个关联实体，将其余的改为普通实体。'],
  ),
  ...issue(
    'er.associative-weak',
    ['Associative entity "{entity}" is weak', '关联实体“{entity}”被标为弱实体'],
    [
      'An associative entity is identified by the entities of its relationship and is never weak.',
      '关联实体由它所属联系涉及的各个实体来标识，不会是弱实体。',
    ],
    ['Clear the weak flag.', '清除“弱实体”标记。'],
  ),
  ...issue(
    'er.associative-identifying',
    ['Associative entity "{entity}" promotes an identifying relationship', '关联实体“{entity}”对应的是标识联系'],
    [
      'Only ordinary relationships can be promoted to an associative entity; identifying relationships define weak entities.',
      '只有普通联系才能提升为关联实体；标识联系用于定义弱实体。',
    ],
    ['Make the relationship non-identifying, or remove the associative entity.', '将该联系改为非标识联系，或移除该关联实体。'],
  ),
  ...issue(
    'er.composite-single-child',
    ['Composite attribute "{attribute}" has one part', '复合属性“{attribute}”只有一个组成部分'],
    [
      'A composite attribute groups several parts; with the single part "{part}" it behaves like a simple attribute.',
      '复合属性由多个部分组成；只有一个组成部分“{part}”时，它的行为与简单属性无异。',
    ],
    ['Add the other parts, or replace the composite by a simple attribute.', '添加其余的组成部分，或将该复合属性替换为简单属性。'],
  ),
  ...issue(
    'er.derived-no-source',
    ['Derived attribute "{attribute}" has no source', '派生属性“{attribute}”未说明来源'],
    [
      'Derived values are not stored; documenting what they derive from explains the omission when the model is converted.',
      '派生值不会被存储；写明它由哪些属性派生而来，可以在转换时说明为何省略它。',
    ],
    ['Select the attributes it is derived from (e.g. Age from DOB).', '选择它的派生来源属性（例如 Age 由 DOB 派生）。'],
  ),
  ...issue(
    'er.one-to-one-ambiguous-placement',
    ['Placement of the foreign key for "{relationship}" is a free choice', '“{relationship}”的外键放在哪一侧可自由选择'],
    [
      'Both sides are partial, so the foreign key would be nullable wherever it is placed and neither placement is better. A separate relationship relation avoids NULLs.',
      '两侧都是部分参与，无论外键放在哪一侧都可能为空，哪种放法都不占优。使用单独的联系关系模式可以避免空值。',
    ],
    [
      'Mark one side total if every instance takes part, or choose the 1:1 strategy explicitly when converting.',
      '如果每个实例都参与该联系，请将其中一侧设为全部参与；或在转换时明确选择 1:1 联系的转换策略。',
    ],
  ),
  ...issue(
    'er.nary-multiple-keys',
    ['"{relationship}" implies {keys} candidate keys', '“{relationship}”隐含 {keys} 个候选键'],
    [
      'Several participants are on the "one" side, so each combination of the others identifies a row. One becomes the primary key; the others become UNIQUE constraints.',
      '有多个参与者位于“一”的一侧，因此其余参与者的每种组合都能确定一行。其中一个会成为主键，其余的成为 UNIQUE 约束。',
    ],
    ['Choose the primary-key participants explicitly in the relationship properties.', '在联系属性中明确选择作为主键的参与者。'],
  ),
  ...issue(
    'er.total-on-one-side',
    ['"At least one" on "{entity}" is not enforceable', '“{entity}”的“至少一个”约束无法强制执行'],
    [
      'Every "{entity}" must take part in "{relationship}", i.e. have at least one partner. A foreign key can only force the many side to reference its parent, so this needs a trigger, assertion or application check.',
      '每个“{entity}”都必须参与“{relationship}”，即至少有一个对应方。外键只能强制“多”的一侧引用它的“一”的一侧，因此这需要触发器、断言或应用程序检查。',
    ],
    ['Keep the constraint as documentation, or enforce it outside the schema.', '将该约束仅作为文档说明保留，或在数据库模式之外强制执行。'],
  ),
];

const strays = (kind: string, en: string, zh: string): Row[] => [variant('rel.key-column-missing', 'explanation', kind, en, zh)];

const rel: Row[] = [
  ...issue(
    'rel.relation-name-empty',
    ['Relation has no name', '关系模式没有名称'],
    ['A table cannot be created without a name.', '没有名称就无法创建关系模式。'],
    ['Give the relation a name.', '为该关系模式命名。'],
  ),
  ...issue(
    'rel.column-name-empty',
    ['Column in "{relation}" has no name', '“{relation}”中有属性没有名称'],
    ['A column cannot be created without a name.', '没有名称就无法创建属性。'],
    ['Give the column a name.', '为该属性命名。'],
  ),
  ['rel.relation-name-duplicate.title', 'Duplicate relation name "{name}"', '关系模式名称重复：“{name}”'],
  [
    'rel.relation-name-duplicate.explanation',
    '{count} relations share this name; table names must be unique.',
    '有 {count} 个关系模式同名；关系模式名称必须唯一。',
  ],
  variant(
    'rel.relation-name-duplicate',
    'explanation',
    'schema',
    '{count} relations share this name in schema "{schema}"; table names must be unique.',
    '在 schema “{schema}”中有 {count} 个关系模式同名；关系模式名称必须唯一。',
  ),
  ['rel.relation-name-duplicate.suggestion', 'Rename one of the relations.', '重命名其中一个关系模式。'],
  ...issue(
    'rel.column-name-duplicate',
    ['Duplicate column "{name}" in "{relation}"', '“{relation}”中的属性“{name}”重复'],
    [
      '{count} columns share this name; a table cannot have two columns with the same name.',
      '有 {count} 个属性同名；一个关系模式不能有两个同名的属性。',
    ],
    ['Rename one of the columns.', '重命名其中一个属性。'],
  ),
  ...issue(
    'rel.no-primary-key',
    ['Relation "{relation}" has no primary key', '关系模式“{relation}”没有主键'],
    [
      'Without a primary key rows cannot be uniquely identified and other relations cannot reference this one reliably.',
      '没有主键就无法唯一标识各个元组（行），其他关系模式也无法可靠地引用它。',
    ],
    ['Mark one or more columns as the primary key.', '将一个或多个属性设为主键。'],
  ),
  ...issue(
    'rel.no-primary-key-candidate',
    ['Relation "{relation}" has no primary key (but a candidate key)', '关系模式“{relation}”没有主键（但有候选键）'],
    [
      'Rows are uniquely identified by a NOT NULL UNIQUE key, which is valid SQL; most designs still declare one candidate key as the PRIMARY KEY.',
      '元组由一个 NOT NULL 且 UNIQUE 的键唯一标识，这在 SQL 中是合法的；但大多数设计仍会把其中一个候选键声明为 PRIMARY KEY。',
    ],
    ['Promote the UNIQUE key to PRIMARY KEY.', '将该 UNIQUE 键提升为 PRIMARY KEY。'],
  ),
  variant('rel.key-column-missing', 'title', 'primary', 'Primary key of "{relation}" uses unknown columns', '“{relation}”的主键使用了未知的属性'),
  variant('rel.key-column-missing', 'title', 'unique', 'UNIQUE constraint of "{relation}" uses unknown columns', '“{relation}”的 UNIQUE 约束使用了未知的属性'),
  variant('rel.key-column-missing', 'title', 'index', 'Index "{index}" of "{relation}" uses unknown columns', '“{relation}”的索引“{index}”使用了未知的属性'),
  ...strays('found.one', '{strays} is not a column of "{relation}".', '{strays} 不属于“{relation}”。'),
  ...strays('found.other', '{strays} are not columns of "{relation}".', '{strays} 不属于“{relation}”。'),
  ...strays('deleted.one', 'a deleted column is not a column of "{relation}".', '引用的是一个已删除的属性，它不属于“{relation}”。'),
  ...strays('deleted.other', '{deleted} deleted columns are not columns of "{relation}".', '引用的是 {deleted} 个已删除的属性，它们不属于“{relation}”。'),
  ...strays(
    'both.other',
    '{strays} and {deleted} deleted column(s) are not columns of "{relation}".',
    '{strays} 以及 {deleted} 个已删除的属性不属于“{relation}”。',
  ),
  variant(
    'rel.key-column-missing',
    'suggestion',
    'primary',
    'Remove the stray columns from the primary key and choose columns of this relation.',
    '从主键中移除这些多余的属性，并改选本关系模式的属性。',
  ),
  variant(
    'rel.key-column-missing',
    'suggestion',
    'unique',
    'Edit the constraint so that it only lists columns of this relation, or delete it.',
    '修改该约束，使其只列出本关系模式的属性，或将它删除。',
  ),
  variant(
    'rel.key-column-missing',
    'suggestion',
    'index',
    'Edit the index so that it only lists columns of this relation, or delete it.',
    '修改该索引，使其只列出本关系模式的属性，或将它删除。',
  ),
  ['rel.pk-nullable.title', 'Nullable primary-key column in "{relation}"', '“{relation}”中存在可为空的主键属性'],
  variant(
    'rel.pk-nullable',
    'explanation',
    'one',
    '{columnsQuoted} is part of the primary key but allow NULL; primary-key columns must be NOT NULL.',
    '{columnsQuoted} 属于主键，却允许为 NULL；主键属性必须为 NOT NULL。',
  ),
  variant(
    'rel.pk-nullable',
    'explanation',
    'other',
    '{columnsQuoted} are part of the primary key but allow NULL; primary-key columns must be NOT NULL.',
    '{columnsQuoted} 属于主键，却允许为 NULL；主键属性必须为 NOT NULL。',
  ),
  ['rel.pk-nullable.suggestion', 'Mark the column(s) NOT NULL.', '将这些属性设为 NOT NULL。'],
  ['rel.fk-relation-missing.title', 'Foreign key points at a missing relation', '外键指向了不存在的关系模式'],
  variant(
    'rel.fk-relation-missing',
    'explanation',
    'target',
    'The referenced (target) relation of this foreign key no longer exists.',
    '该外键所引用的（目标）关系模式已不存在。',
  ),
  variant(
    'rel.fk-relation-missing',
    'explanation',
    'source',
    'The referencing (source) relation of this foreign key no longer exists.',
    '该外键的引用方（源）关系模式已不存在。',
  ),
  ['rel.fk-relation-missing.suggestion', 'Delete the foreign key or reconnect it to existing relations.', '删除该外键，或将它重新连接到现有的关系模式。'],
  ...issue(
    'rel.fk-no-columns',
    ['Foreign key "{foreignKey}" has no columns', '外键“{foreignKey}”没有任何属性'],
    [
      'A foreign key must pair at least one referencing column with one referenced column.',
      '外键必须至少将一个引用属性与一个被引用属性配成一对。',
    ],
    ['Add the column pair(s) or delete the foreign key.', '添加属性对，或删除该外键。'],
  ),
  ['rel.fk-column-missing.title', 'Foreign key references a missing column in "{foreignKey}"', '“{foreignKey}”引用了不存在的属性'],
  ['rel.fk-column-missing.suggestion', 'Re-select the column for each affected pair, or remove the pair.', '为每个受影响的属性对重新选择属性，或移除该属性对。'],
  ['rel.fk-column-wrong-relation.title', 'Foreign key column is in the wrong relation in "{foreignKey}"', '“{foreignKey}”中有外键属性属于错误的关系模式'],
  [
    'rel.fk-column-wrong-relation.suggestion',
    'Referencing columns must belong to the referencing relation and referenced columns to the referenced relation. Re-select them.',
    '引用属性必须属于引用方关系模式，被引用属性必须属于被引用方关系模式。请重新选择。',
  ],
  ...['rel.fk-column-missing', 'rel.fk-column-wrong-relation'].flatMap((code): Row[] => [
    // English: the module's own sentence list (`lines`); Chinese is built from the structured params.
    variant(code, 'explanation', 'source', '{lines}.', '引用方属性 {sourceColumns}（属于“{sourceRelation}”）。'),
    variant(code, 'explanation', 'target', '{lines}.', '被引用方属性 {targetColumns}（属于“{targetRelation}”）。'),
    variant(
      code,
      'explanation',
      'both',
      '{lines}.',
      '引用方属性 {sourceColumns}（属于“{sourceRelation}”）；被引用方属性 {targetColumns}（属于“{targetRelation}”）。',
    ),
  ]),
  ['rel.fk-target-not-key.title', 'Foreign key "{foreignKey}" does not reference a key', '外键“{foreignKey}”引用的属性不构成目标关系模式的键'],
  variant(
    'rel.fk-target-not-key',
    'explanation',
    'repeated',
    'The referenced column(s) {repeated} of "{target}" appear more than once in this foreign key, so the pairs do not form the key of "{target}"; its keys are {keys}.',
    '“{target}”的被引用属性 {repeated} 在该外键中出现了多次，因此这些属性对并不构成“{target}”的键；它的键为 {keyColumns}。',
  ),
  variant(
    'rel.fk-target-not-key',
    'explanation',
    'partial',
    'It references {columns} of "{target}", but that is only part of the key ({covering}). The missing key column(s): {missing}.',
    '它引用了“{target}”的 {columns}，但这只是键（{covering}）的一部分。缺少的键属性：{missing}。',
  ),
  variant(
    'rel.fk-target-not-key',
    'explanation',
    'nokeys',
    '"{target}" has no primary key or UNIQUE constraint, so the referenced columns {columns} identify nothing.',
    '“{target}”既没有主键也没有 UNIQUE 约束，因此被引用的属性 {columns} 不能标识任何元组。',
  ),
  variant(
    'rel.fk-target-not-key',
    'explanation',
    'generic',
    'The referenced columns {columns} are not a key of "{target}"; its keys are {keys}.',
    '被引用的属性 {columns} 不是“{target}”的键；它的键为 {keyColumns}。',
  ),
  [
    'rel.fk-target-not-key.suggestion',
    'Reference the complete key (add the missing columns to the foreign key), or add a UNIQUE constraint on the referenced columns.',
    '引用完整的键（将缺少的属性加入外键），或在被引用的属性上添加 UNIQUE 约束。',
  ],
  ['rel.fk-type-mismatch.title', 'Type mismatch in "{foreignKey}"', '“{foreignKey}”中的数据类型不匹配'],
  variant(
    'rel.fk-type-mismatch',
    'explanation',
    'single',
    '{sourceColumn} is {sourceType} but {targetColumn} is {targetType}. Values of such types are not comparable, so the constraint would be rejected or silently cast.',
    '{sourceColumn} 的类型为 {sourceType}，而 {targetColumn} 的类型为 {targetType}。这类类型的值不可比较，因此该约束会被拒绝，或被悄悄地做类型转换。',
  ),
  variant(
    'rel.fk-type-mismatch',
    'explanation',
    'multiple',
    'Incompatible column pairs: {pairs}. Values of such types are not comparable, so the constraint would be rejected or silently cast.',
    '类型不兼容的属性对：{pairs}。这类类型的值不可比较，因此该约束会被拒绝，或被悄悄地做类型转换。',
  ),
  [
    'rel.fk-type-mismatch.suggestion',
    'Give the referencing column the same type as the referenced column.',
    '让引用属性使用与被引用属性相同的数据类型。',
  ],
  ['rel.fk-total-but-nullable.title', 'Mandatory foreign key "{foreignKey}" allows NULL', '必选的外键“{foreignKey}”允许为 NULL'],
  ...(
    [
      ['stated', 'The foreign key is declared mandatory', '该外键被声明为必选'],
      [
        'relationship',
        'This foreign key column belongs to a relationship relation, where every row records one partner from each participant',
        '该外键属性属于联系关系模式；在这种关系模式中，每一行都记录各个参与者的一个对应方',
      ],
      ['origin', 'The ER participation behind this foreign key is total', 'ER 图中该外键对应的参与约束为全部参与'],
    ] as const
  ).flatMap(([kind, en, zh]): Row[] => [
    variant('rel.fk-total-but-nullable', 'explanation', `${kind}.one`, `${en}, but {columns} is nullable, so rows may exist without a parent.`, `${zh}，但 {columns} 可为空，因此可能存在没有父元组的行。`),
    variant('rel.fk-total-but-nullable', 'explanation', `${kind}.other`, `${en}, but {columns} are nullable, so rows may exist without a parent.`, `${zh}，但 {columns} 可为空，因此可能存在没有父元组的行。`),
  ]),
  variant('rel.fk-total-but-nullable', 'suggestion', 'relationship', 'Mark the foreign-key column(s) NOT NULL.', '将这些外键属性设为 NOT NULL。'),
  [
    'rel.fk-total-but-nullable.suggestion',
    'Mark the foreign-key column(s) NOT NULL, or relax the participation to partial.',
    '将这些外键属性设为 NOT NULL，或将参与约束放宽为部分参与。',
  ],
  ['rel.fk-set-null-not-null.title', '{actionsTitle} SET NULL on NOT NULL column', '对 NOT NULL 属性使用了 {actionsTitle} SET NULL'],
  [
    'rel.fk-set-null-not-null.explanation',
    '"{foreignKey}" would have to write NULL into {columns}, which is NOT NULL; the database rejects the deletion or the table definition.',
    '“{foreignKey}”需要向 {columns} 写入 NULL，但这些属性是 NOT NULL；数据库会拒绝该删除操作或该表定义。',
  ],
  variant(
    'rel.fk-set-null-not-null',
    'suggestion',
    'pk',
    'Choose another referential action (CASCADE, RESTRICT or NO ACTION); primary-key columns cannot be made nullable.',
    '改用其他参照动作（CASCADE、RESTRICT 或 NO ACTION）；主键属性不能设为可空。',
  ),
  variant(
    'rel.fk-set-null-not-null',
    'suggestion',
    'plain',
    'Choose another referential action (RESTRICT, CASCADE) or make the column(s) nullable.',
    '改用其他参照动作（RESTRICT、CASCADE），或将这些属性设为可空。',
  ),
  ...issue(
    'rel.fk-not-null-cycle',
    ['Circular NOT NULL references: {relationsArrow}', 'NOT NULL 外键形成循环引用：{relationsArrow}'],
    [
      '{relationsQuoted} each require a parent row in another table of the group through NOT NULL foreign keys. Whichever row is inserted first has no parent yet, unless constraints are deferred.',
      '{relationsQuoted} 都通过 NOT NULL 外键要求在本组的另一个表中存在父元组。无论先插入哪一行，它都还没有父元组，除非将约束设为延迟检查。',
    ],
    [
      'Make at least one foreign key in the cycle nullable (or use deferred constraints) so that a first row can be inserted.',
      '使循环中至少一个外键可为空（或使用延迟约束），这样才能插入第一行。',
    ],
  ),
  ...issue(
    'rel.self-reference-not-null',
    ['Self-reference "{foreignKey}" cannot be NOT NULL for the root row', '自引用外键“{foreignKey}”为 NOT NULL，根元组无法插入'],
    [
      'Every row must reference another row of the same table, so the first (root) row can never be inserted unless the root points at itself.',
      '每一行都必须引用同一个表中的另一行，因此除非根元组引用它自己，否则第一行（根元组）永远无法插入。',
    ],
    ['Make the foreign-key column nullable (NULL = no parent, e.g. the top manager).', '将外键属性设为可空（NULL 表示没有上级，例如最高层管理者）。'],
  ),
  ...issue(
    'rel.fk-duplicate',
    ['Duplicate foreign key "{foreignKey}"', '外键“{foreignKey}”重复'],
    [
      '{count} foreign keys define the same constraint; the database enforces it once per copy, which only costs performance.',
      '有 {count} 个外键定义了相同的约束；数据库会对每个副本各检查一次，这只会白白消耗性能。',
    ],
    ['Delete the redundant foreign key.', '删除多余的外键。'],
  ),
];

export default defineMessages('issues', fromRows([...er, ...rel]));
