/**
 * Conversion decisions: namespace `decisions`. Key `<kind>.title|explanation` where kind = `params.kind` (else the ruleId),
 * see src/conversion/codes.ts DECISION_KINDS; `<kind>.frag.<selector>.<value>` are clause fragments pulled in by `{>selector}`
 * (src/i18n/issues.ts). `rule.<ruleId>.*` describes each conversion rule in general (legend / trace panel).
 * English reproduces the converter's text exactly (messages.test.ts).
 */
import { fromRows, type Row } from '../build';
import { defineMessages } from '../core';

/** title + explanation (+ fragments) of one kind. */
function kind(
  name: string,
  title: readonly [string, string],
  explanation: readonly [string, string],
  frags: Record<string, Record<string, readonly [string, string]>> = {},
): Row[] {
  return [
    [`${name}.title`, title[0], title[1]],
    [`${name}.explanation`, explanation[0], explanation[1]],
    ...Object.entries(frags).flatMap(([sel, values]) =>
      Object.entries(values).map(([value, [en, zh]]): Row => [`${name}.frag.${sel}.${value}`, en, zh]),
    ),
  ];
}

/** "The column is / The columns are ..." clause shared by the two foreign-key kinds. */
const nullMode = {
  nullMode: {
    'notnull.one': ['The column is NOT NULL because {holderEntity} participates totally.', '该外键属性为 NOT NULL，因为“{holderEntity}”是全部参与。'],
    'notnull.many': ['The columns are NOT NULL because {holderEntity} participates totally.', '这些外键属性为 NOT NULL，因为“{holderEntity}”是全部参与。'],
    'partial.one': ['The column is nullable because {holderEntity} participates only partially.', '该外键属性可为空，因为“{holderEntity}”只是部分参与。'],
    'partial.many': ['The columns are nullable because {holderEntity} participates only partially.', '这些外键属性可为空，因为“{holderEntity}”只是部分参与。'],
    'absent.one': [
      'The column is nullable because {holderEntity} is the optional partner of a merged 1:1 relation (its columns are absent for rows without a {holderEntity}); "{holderEntity} participates totally" is then enforceable only when its key is not NULL.',
      '该外键属性可为空，因为“{holderEntity}”是合并后的 1:1 联系中的可选一方（没有“{holderEntity}”的行中它的属性不存在）；这时只有当它的键不为 NULL 时，“{holderEntity}全部参与”才能得到强制保证。',
    ],
    'absent.many': [
      'The columns are nullable because {holderEntity} is the optional partner of a merged 1:1 relation (its columns are absent for rows without a {holderEntity}); "{holderEntity} participates totally" is then enforceable only when its key is not NULL.',
      '这些外键属性可为空，因为“{holderEntity}”是合并后的 1:1 联系中的可选一方（没有“{holderEntity}”的行中它的属性不存在）；这时只有当它的键不为 NULL 时，“{holderEntity}全部参与”才能得到强制保证。',
    ],
  },
} as const;

const omitted = (why: string, en: string, zh: string): Row[] =>
  kind(
    `relationship-omitted.${why}`,
    ['Relationship {relationship} was not converted', '联系“{relationship}”未被转换'],
    [`${en} Nothing was generated for it.`, `${zh}没有为它生成任何内容。`],
  );

const optionalNote = {
  noteMode: {
    none: ['', ''],
    'out.one': [
      ' The optional sub-attribute {noteColumns} stays nullable and outside the key (a key column cannot be NULL), so two values that differ only there are not both allowed.',
      '可选的子属性 {noteColumns} 保持可为空，且不属于键（键属性不能为 NULL），因此仅在该子属性上不同的两个值不能同时存在。',
    ],
    'out.many': [
      ' The optional sub-attributes {noteColumns} stay nullable and outside the key (a key column cannot be NULL), so two values that differ only there are not both allowed.',
      '可选的子属性 {noteColumns} 保持可为空，且不属于键（键属性不能为 NULL），因此仅在这些子属性上不同的两个值不能同时存在。',
    ],
    'forced.one': [
      ' {noteColumns} is optional but, as no required sub-attribute exists, had to become part of the key and therefore NOT NULL.',
      '{noteColumns} 是可选的，但由于不存在必需的子属性，它不得不成为键的一部分，因此被设为 NOT NULL。',
    ],
    'forced.many': [
      ' {noteColumns} are optional but, as no required sub-attribute exists, had to become part of the key and therefore NOT NULL.',
      '{noteColumns} 是可选的，但由于不存在必需的子属性，它们不得不成为键的一部分，因此被设为 NOT NULL。',
    ],
  },
} as const;

const rows: Row[] = [
  ...kind(
    'relation-renamed',
    ['Relation renamed to {name}', '关系模式已重命名为“{name}”'],
    [
      'The name "{desired}" was already used by another generated relation, so this one was named "{name}".',
      '名称“{desired}”已被另一个生成的关系模式使用，因此这个关系模式被命名为“{name}”。',
    ],
  ),
  ...kind(
    'column-renamed',
    ['Column {relation}.{column} renamed to avoid a collision', '为避免重名，属性 {relation}.{column} 已被重命名'],
    [
      '"{base}" was already a column of {relation}; the column was named "{column}" instead. Rename it freely — ids, not names, hold the model together.',
      '“{base}”已是“{relation}”的属性，因此该属性改名为“{column}”。您可以随意重命名——维系模型的是标识符（id），而不是名称。',
    ],
  ),
  ...(
    [
      ['entity', 'Entity {name}', '实体“{name}”', '实体“{name}”'],
      ['attribute', 'Attribute {name}', '属性“{name}”', '属性“{name}”'],
      ['relationship', 'Relationship {name}', '联系“{name}”', '联系“{name}”'],
      ['participant', 'A participant of {name}', '联系“{name}”的一个参与者', '联系“{name}”的一个参与者'],
    ] as const
  ).flatMap(([what, en, zhTitle, zhBody]) =>
    kind(
      `unmapped.${what}`,
      [`${en} was not converted`, `${zhTitle}未被转换`],
      [
        `${en} could not be attached to any generated relation (its owner is missing or was not converted), so nothing was generated for it.`,
        `${zhBody}无法归入任何已生成的关系模式（它的属主缺失或未被转换），因此没有为它生成任何内容。`,
      ],
    ),
  ),
  ...kind(
    'derived-omitted',
    ['Derived attribute {name} is not stored', '派生属性“{name}”不被存储'],
    [
      '{name} can be computed from {from}, so storing it would duplicate information and let it go out of date. Compute it in queries or a view instead; to store it anyway, add it to the "materialise derived attributes" option.',
      '“{name}”可以由 {from} 计算得出，因此存储它会造成信息冗余，并可能使它过时。请改在查询或视图中计算它；如果仍要存储，请将它加入“物化派生属性”选项。',
    ],
  ),
  ...kind(
    'derived-omitted.nosource',
    ['Derived attribute {name} is not stored', '派生属性“{name}”不被存储'],
    [
      '{name} can be computed from other data, so storing it would duplicate information and let it go out of date. Compute it in queries or a view instead; to store it anyway, add it to the "materialise derived attributes" option.',
      '“{name}”可以由其他数据计算得出，因此存储它会造成信息冗余，并可能使它过时。请改在查询或视图中计算它；如果仍要存储，请将它加入“物化派生属性”选项。',
    ],
  ),
  ...kind(
    'derived-omitted.multivalued',
    ['Derived attribute {name} is not stored', '派生属性“{name}”不被存储'],
    [
      '{name} is derived (computed from other data), so it is not stored in the relation of multivalued attribute {attribute}.',
      '“{name}”是派生属性（由其他数据计算得出），因此不会存储在多值属性“{attribute}”对应的关系模式中。',
    ],
  ),
  ...kind(
    'derived-materialized',
    ['Derived attribute {name} is stored', '派生属性“{name}”被存储'],
    [
      '{name} is derived, but it was explicitly chosen for storage and became the ordinary column {relation}.{column}. The database will not keep it in sync with the attributes it is computed from.',
      '“{name}”是派生属性，但被明确选择为存储，因此成为普通属性 {relation}.{column}。数据库不会让它与计算它所依据的属性保持同步。',
    ],
  ),
  ...kind(
    'composite-flatten',
    ['Composite attribute {name} is flattened', '复合属性“{name}”被展平'],
    [
      '{name} has sub-attributes, which become separate atomic columns of {relation}: {columns}. The composite itself is not a column.',
      '“{name}”含有子属性，它们成为“{relation}”中各自独立的原子属性：{columns}。复合属性本身不会单独存储。',
    ],
  ),
  ...kind(
    'composite-flatten.collision',
    ['Sub-attribute {leaf} prefixed with {parent}', '子属性“{leaf}”加上了前缀“{parent}”'],
    [
      'Several attributes of {owner} flatten to a column called "{leaf}"; the one under {parent} became "{column}" so every column name stays unique.',
      '“{owner}”的多个属性展平后都会得到名为“{leaf}”的属性；位于“{parent}”之下的那个改名为“{column}”，使属性名保持唯一。',
    ],
  ),
  ...kind(
    'multivalued-relation',
    ['Multivalued attribute {name} becomes relation {relation}', '多值属性“{name}”转换为关系模式“{relation}”'],
    [
      "A column cannot hold a set of values, so {name} gets its own relation {relation}. It holds {host}'s key as one foreign key ({fkColumns}) and the value column(s) {valueColumns}; the primary key is {pk}, so each value appears at most once per {host}.{>noteMode}",
      '单个属性无法存放一组值，因此“{name}”拥有自己的关系模式“{relation}”。它把“{host}”的键作为一个外键（{fkColumns}），并包含值属性 {valueColumns}；主键为 {pk}，因此每个值在每个“{host}”下至多出现一次。{>noteMode}',
    ],
    optionalNote,
  ),
  ...kind(
    'multivalued-relation.nokey',
    ['Multivalued attribute {name} becomes relation {relation}', '多值属性“{name}”转换为关系模式“{relation}”'],
    [
      '{name} is multivalued and gets its own relation {relation}, but {host} has no key to reference, so no foreign key could be created.',
      '“{name}”是多值属性，拥有自己的关系模式“{relation}”，但“{host}”没有可引用的键，因此无法创建外键。',
    ],
  ),
  ...kind(
    'strong-entity.nokey',
    ['{entity} has no key', '“{entity}”没有键'],
    [
      '{entity} has no key attribute, so its relation was created without a primary key (and cannot be referenced by foreign keys). Mark a key attribute and convert again.',
      '“{entity}”没有键属性，因此为它创建的关系模式没有主键（也无法被外键引用）。请标记一个键属性后重新转换。',
    ],
  ),
  ...kind(
    'weak-entity',
    ['Weak entity {entity}: key = owner key + partial key', '弱实体“{entity}”：键 = 属主实体的键 + 部分键'],
    [
      '{entity} cannot be identified by its own attributes, so its primary key is the FULL primary key of {owners} ({ownerColumns}) plus its partial key{>partialMode}: primary key {pk}. The identifying relationship creates no table of its own; it is the foreign key{>s} from {entity} to {ownerList}.',
      '“{entity}”无法仅凭自身的属性来标识，因此它的主键由 {ownerList} 的完整主键（{ownerColumns}）加上{>partialMode}构成，即主键为 {pk}。标识联系不会生成单独的关系模式，它体现为从“{entity}”指向 {ownerList} 的外键。',
    ],
    {
      partialMode: {
        some: [' {partial}', '它的部分键 {partial}'],
        none: [
          ' (none is defined, so the key is only the owner key — at most one row per owner)',
          '它的部分键（尚未定义部分键，因此键仅为属主实体的键——每个属主至多对应一行）',
        ],
      },
      s: { one: ['', ''], many: ['s', ''] },
    },
  ),
  ...kind(
    'weak-entity.noowner',
    ['Weak entity {entity}: key = owner key + partial key', '弱实体“{entity}”：键 = 属主实体的键 + 部分键'],
    [
      '{entity} is weak, but no usable owner key was found; its primary key is {pk}.',
      '“{entity}”是弱实体，但没有找到可用的属主实体的键；它的主键为 {pk}。',
    ],
  ),
  ...kind(
    'weak-entity.cycle',
    ['Ownership cycle between {names}', '{names} 之间存在属主循环'],
    [
      'The owner keys that would form a cycle were left out of the primary keys; the remaining partial keys and ordinary attributes were converted.',
      '构成循环的属主键没有被纳入主键；其余的部分键和普通属性已正常转换。',
    ],
  ),
  ...kind(
    'weak-entity-owner-key',
    ['Identifying relationship {relationship} creates no table', '标识联系“{relationship}”不会生成关系模式'],
    [
      '{relationship} identifies {entity}. It is represented by the owner key columns inside {relation} and the foreign key{>s} to the owner{>s}; a separate relation would only duplicate that information.',
      '“{relationship}”标识了“{entity}”。它体现为“{relation}”中的属主键属性，以及指向属主实体的外键；单独建一个关系模式只会重复这些信息。',
    ],
    { s: { one: ['', ''], many: ['s', ''] } },
  ),
  ...kind(
    'weak-entity-owner-key.nokey',
    ['{entity} could not take the key of {owner}', '“{entity}”无法获得“{owner}”的键'],
    ['{owner} has no primary key, so {entity} has nothing to reference.', '“{owner}”没有主键，因此“{entity}”没有可引用的对象。'],
  ),
  ...kind(
    'weak-entity-owner-key.unavailable',
    ['{entity} could not take the key of {owner}', '“{entity}”无法获得“{owner}”的键'],
    ['The relation of {owner} was not available (circular dependency).', '“{owner}”的关系模式不可用（存在循环依赖）。'],
  ),
  ...kind(
    'one-to-one-merge',
    ['{primary} and {other} merged into {relation}', '“{primary}”与“{other}”合并为“{relation}”'],
    [
      'The 1:1 relationship {relationship} was translated by merging both entities into one relation named "{primary}_{other}" (primary entity first). Its primary key is {primary}\'s key; {other}\'s key became UNIQUE{>partnerMode}. {>sideMode}',
      '1:1 联系“{relationship}”通过把两个实体合并为一个名为“{primary}_{other}”的关系模式来转换（主实体在前）。它的主键是“{primary}”的键；“{other}”的键成为 UNIQUE{>partnerMode}。{>sideMode}',
    ],
    {
      partnerMode: {
        optional: [
          ' and all {other} columns are nullable because not every {primary} has a {other}',
          '，并且“{other}”的所有属性都可为空，因为并非每个“{primary}”都有对应的“{other}”',
        ],
        none: ['', ''],
      },
      sideMode: {
        oneTotal: ['The side with partial participation keys the relation so no instance is lost.', '由部分参与的一侧作为该关系模式的键，这样就不会丢失任何实例。'],
        bothTotal: ['Both sides participate totally, so every instance has a partner and no instance is lost.', '两侧都是全部参与，每个实例都有对应的另一方，因此不会丢失任何实例。'],
        partial: ['Both sides participate only partially.', '两侧都只是部分参与。'],
      },
    },
  ),
  ...kind(
    'associative-entity',
    ['Associative entity {entity} becomes one relation', '关联实体“{entity}”转换为一个关系模式'],
    [
      '{entity} stands for the relationship {relationship}, so exactly one relation {relation} is created: a foreign key per participant ({participants}) plus its own attributes, with {>pkMode}. {>keyMode}',
      '“{entity}”代表联系“{relationship}”，因此只生成一个关系模式“{relation}”：每个参与者各一个外键（{participants}），再加上它自己的属性，并且{>pkMode}。{>keyMode}',
    ],
    {
      pkMode: { some: ['primary key {pk}', '主键为 {pk}'], none: ['no primary key', '没有主键'] },
      keyMode: {
        own: [
          'Its own key attributes form the key; the keys implied by the cardinalities became UNIQUE.',
          '由它自己的键属性构成键；由基数推出的键成为 UNIQUE。',
        ],
        implied: [
          'It has no key attribute of its own, so the key implied by the relationship cardinalities is used.',
          '它没有自己的键属性，因此采用由联系的基数推出的键。',
        ],
      },
    },
  ),
  ...kind(
    'associative-entity.invalid',
    ['{entity} is not a usable associative entity', '“{entity}”不是可用的关联实体'],
    [
      '{entity} is marked as associative, but its relationship is missing, identifying or has fewer than two participants; it was converted as an ordinary entity.',
      '“{entity}”被标记为关联实体，但它对应的联系缺失、是标识联系，或参与者少于两个；它已按普通实体转换。',
    ],
  ),
  ...kind(
    'participant-no-fk.nokey',
    ['No foreign key for {entity} in {relationship}', '“{relationship}”中没有为“{entity}”生成外键'],
    [
      '{entity} has no primary key, so there is nothing for {relationship} to reference. Give the entity a key attribute and convert again.',
      '“{entity}”没有主键，因此“{relationship}”没有可引用的对象。请为该实体添加键属性后重新转换。',
    ],
  ),
  ...kind(
    'participant-no-fk.unavailable',
    ['No foreign key for {entity} in {relationship}', '“{relationship}”中没有为“{entity}”生成外键'],
    [
      'The relation of {entity} was not available while {relationship} was converted (circular dependency), so no foreign key could be created.',
      '转换“{relationship}”时，“{entity}”的关系模式不可用（存在循环依赖），因此无法创建外键。',
    ],
  ),
  ...kind(
    'relationship-no-key',
    ['{relationship} has no primary key', '“{relationship}”没有主键'],
    [
      'A participant of the key of {relationship} has no primary key to reference, so using only the remaining foreign keys would claim a uniqueness the ER model never stated. No primary key was generated; give the keyless entity a key and convert again.',
      '“{relationship}”的键所涉及的某个参与者没有可引用的主键；如果只用其余的外键，就会声称一种 ER 模型从未声明过的唯一性。因此没有生成主键；请为没有键的实体添加键后重新转换。',
    ],
  ),
  ...omitted('fewer', 'The relationship has fewer than two participants.', '该联系的参与者少于两个。'),
  ...omitted('missing-entity', 'A participant refers to an entity that does not exist.', '某个参与者引用了不存在的实体。'),
  ...omitted('strategy', 'The 1:1 strategy could not be resolved.', '无法确定该 1:1 联系的转换策略。'),
  ...omitted('weak-no-relation', 'The identified (weak) entity has no relation.', '被标识的（弱）实体没有对应的关系模式。'),
  ...omitted('circular', 'A participating relation was not available (circular dependency).', '某个参与方的关系模式不可用（存在循环依赖）。'),
  ...omitted('nokey', '{entity} has no primary key, so a foreign key to it cannot be created.', '“{entity}”没有主键，因此无法创建指向它的外键。'),
  ...omitted('merged-unavailable', 'The merged relation was not available.', '合并后的关系模式不可用。'),
  ...kind(
    'relationship-attribute',
    ['Attributes of {relationship} stored in {relation}', '联系“{relationship}”的属性存放在“{relation}”中'],
    [
      '{columns} describe{>verbS} the relationship {relationship}, so {>itWas} placed in {relation}{>nullMode}. Relationship attributes are never dropped.',
      '{columns} 用于描述联系“{relationship}”，所以被放在“{relation}”中{>nullMode}。联系的属性绝不会被丢弃。',
    ],
    {
      verbS: { one: ['s', ''], many: ['', ''] },
      itWas: { one: ['it was', ''], many: ['they were', ''] },
      nullMode: {
        yes: [', nullable because the relationship is optional there', '，并且可为空，因为该联系在这一侧是可选的'],
        no: ['', ''],
      },
    },
  ),
  ...kind(
    'fk-n-side',
    ['{relationship}: foreign key on the N side ({holderEntity})', '“{relationship}”：外键位于 N 侧（{holderEntity}）'],
    [
      'In {relationship} each {holderName} relates to at most one {refName}, so the key of the "one" side ({refName}) was copied into the "many" side ({holderName}) as foreign key {where}; the reverse would require a multi-valued column. {>nullMode}',
      '在“{relationship}”中，每个“{holderName}”至多关联一个“{refName}”，因此把“一”侧（{refName}）的键复制到“多”侧（{holderName}）中作为外键 {where}；反过来做则需要多值属性。{>nullMode}',
    ],
    nullMode,
  ),
  ...kind(
    'fk-one-to-one',
    ['1:1 {relationship}: foreign key on {holderEntity}', '1:1 联系“{relationship}”：外键位于“{holderEntity}”'],
    [
      '{relationship} is 1:1, so the key of {refEntity} was placed in {relation} as a foreign key ({where}) and made UNIQUE so at most one {holderEntity} can refer to each {refEntity}. {>why} {>nullMode}',
      '“{relationship}”是 1:1 联系，因此把“{refEntity}”的键作为外键（{where}）放入“{relation}”，并设为 UNIQUE，使每个“{refEntity}”至多被一个“{holderEntity}”引用。{>why}{>nullMode}',
    ],
    {
      why: {
        'total-side': [
          '{holderEntity} holds the key because it participates totally, which lets the column be NOT NULL.',
          '由“{holderEntity}”持有外键，因为它是全部参与，这样该属性才可以设为 NOT NULL。',
        ],
        'both-total': ['Both sides are total; {holderEntity} (first participant) holds the key.', '两侧都是全部参与；由“{holderEntity}”（第一个参与者）持有外键。'],
        explicit: ['{holderEntity} was chosen as the FK side by option.', '按选项指定“{holderEntity}”为外键所在的一侧。'],
        default: ['{holderEntity} (first participant) holds the key by convention.', '按惯例由“{holderEntity}”（第一个参与者）持有外键。'],
      },
      ...nullMode,
    },
  ),
  ...kind(
    'relationship-table',
    ['{relationship} becomes relation {relation}', '“{relationship}”转换为关系模式“{relation}”'],
    [
      '{relationship} ({>rec}{shapeBase}) is represented by its own relation {relation} with one foreign key per participant ({participants}). {>pkMode}{>attrMode}{>naryMode}{>uniqueMode}.',
      '“{relationship}”（{>rec}{shapeBase}）由它自己的关系模式“{relation}”表示，每个参与者对应一个外键（{participants}）。{>pkMode}{>attrMode}{>naryMode}{>uniqueMode}。',
    ],
    {
      rec: { yes: ['recursive ', '递归 '], no: ['', ''] },
      pkMode: {
        one: ['Its primary key {pk} comes from the key participant {keyNames}', '它的主键 {pk} 取自键参与者 {keyNames}'],
        many: ['Its primary key {pk} comes from the key participants {keyNames}', '它的主键 {pk} 取自键参与者 {keyNames}'],
        none: ['No primary key could be formed because {keyNames} has no key', '未能生成主键，因为“{keyNames}”没有键'],
        noneMany: ['No primary key could be formed because {keyNames} have no key', '未能生成主键，因为“{keyNames}”没有键'],
      },
      attrMode: {
        none: ['', ''],
        one: [' plus the key attribute {attrNames}', '，外加键属性 {attrNames}'],
        many: [' plus the key attributes {attrNames}', '，外加键属性 {attrNames}'],
      },
      naryMode: {
        yes: ['; it is not automatically all foreign keys but follows the cardinalities', '；它并不自动等于全部外键，而是遵循基数'],
        no: ['', ''],
      },
      uniqueMode: {
        none: ['', ''],
        one: [', and the other candidate key became UNIQUE', '，其余的候选键成为 UNIQUE'],
        many: [', and the other candidate keys became UNIQUE', '，其余的候选键成为 UNIQUE'],
      },
    },
  ),
];

/** General description of each conversion rule (CONVERSION_RULE_IDS), without parameters. */
const ruleRows: Array<[string, string, string, string, string]> = [
  ['strong-entity', 'Strong entity', 'Each strong entity becomes a relation holding its stored atomic attributes; its key attributes form the primary key.', '强实体', '每个强实体转换为一个关系模式，包含它存储的原子属性；它的键属性构成主键。'],
  ['composite-flatten', 'Composite attribute', 'A composite attribute is replaced by its atomic sub-attributes; the composite itself is not stored.', '复合属性', '复合属性被它的原子子属性取代；复合属性本身不被存储。'],
  ['multivalued-relation', 'Multivalued attribute', 'A multivalued attribute becomes its own relation holding the owner key as a foreign key plus the value; the primary key is both together.', '多值属性', '多值属性转换为单独的关系模式，包含作为外键的属主键和属性值；主键由两者共同构成。'],
  ['derived-omitted', 'Derived attribute (omitted)', 'A derived attribute can be computed from other data, so it is not stored unless explicitly materialised.', '派生属性（省略）', '派生属性可由其他数据计算得出，因此除非明确要求物化，否则不予存储。'],
  ['derived-materialized', 'Derived attribute (stored)', 'A derived attribute chosen for storage becomes an ordinary column that the database does not keep in sync.', '派生属性（存储）', '被选择存储的派生属性成为普通属性，数据库不会使它保持同步。'],
  ['weak-entity', 'Weak entity', "A weak entity's primary key is the owner's full primary key plus its partial key.", '弱实体', '弱实体的主键是属主实体的完整主键加上它自己的部分键。'],
  ['weak-entity-owner-key', 'Identifying relationship', 'An identifying relationship creates no table: it is the owner key columns and foreign key inside the weak entity relation.', '标识联系', '标识联系不生成关系模式：它体现为弱实体关系模式中的属主键属性和外键。'],
  ['one-to-many-fk', '1:N relationship', 'The key of the "one" side is copied into the "many" side as a foreign key.', '1:N 联系', '把“一”侧的键作为外键复制到“多”侧。'],
  ['one-to-one-fk', '1:1 relationship (foreign key)', 'The foreign key is placed on one side (preferably the total side) and made UNIQUE.', '1:1 联系（外键）', '外键放在其中一侧（优先放在全部参与的一侧），并设为 UNIQUE。'],
  ['one-to-one-merge', '1:1 relationship (merge)', 'Both entities are merged into one relation.', '1:1 联系（合并）', '两个实体合并为一个关系模式。'],
  ['one-to-one-relation', '1:1 relationship (own relation)', 'The relationship becomes a separate relation with a foreign key to each side.', '1:1 联系（独立关系模式）', '联系转换为单独的关系模式，对每一侧各有一个外键。'],
  ['many-to-many-relation', 'M:N relationship', 'The relationship becomes a separate relation with a foreign key to each participant; the primary key combines them.', 'M:N 联系', '联系转换为单独的关系模式，对每个参与者各有一个外键；主键由这些外键组合而成。'],
  ['n-ary-relation', 'N-ary relationship', 'The relationship becomes a relation with a foreign key per participant; the key follows the cardinalities.', 'n 元联系', '联系转换为关系模式，每个参与者各有一个外键；键由基数决定。'],
  ['recursive-one-to-many-fk', 'Recursive 1:N relationship', 'A self-referencing foreign key is added to the entity relation.', '递归 1:N 联系', '在该实体的关系模式中添加一个自引用外键。'],
  ['recursive-many-to-many-relation', 'Recursive M:N relationship', 'A separate relation holds two foreign keys to the same entity relation.', '递归 M:N 联系', '用单独的关系模式保存两个指向同一实体关系模式的外键。'],
  ['relationship-attribute', 'Relationship attribute', 'Attributes of a relationship are stored with the relation that represents it; they are never dropped.', '联系的属性', '联系的属性存放在表示该联系的关系模式中，绝不会被丢弃。'],
  ['associative-entity', 'Associative entity', 'An associative entity becomes one relation with a foreign key per participant of its relationship.', '关联实体', '关联实体转换为一个关系模式，其联系的每个参与者各有一个外键。'],
];

const ruleCatalogue: Row[] = ruleRows.flatMap(([id, enTitle, enText, zhTitle, zhText]): Row[] => [
  [`rule.${id}.title`, enTitle, zhTitle],
  [`rule.${id}.explanation`, enText, zhText],
]);

const words: Row[] = [
  ['word.empty', 'empty', '空'],
  ['word.nary', 'n-ary', 'n 元'],
];

export default defineMessages('decisions', fromRows([...rows, ...ruleCatalogue, ...words]));
