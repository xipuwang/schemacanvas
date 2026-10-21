/**
 * Conversion warnings (`conv.*`, src/conversion + the `conv.hand-added-*` / `conv.edits-overwritten` reports of
 * ops.applyConversionResult): namespace `issues`. English reproduces the converter's text exactly (messages.test.ts).
 */
import { fromRows, issue, variant, type Row } from '../build';
import { defineMessages } from '../core';

const NOT_ENFORCED = 'Enforce it in application logic or with a trigger';

const rows: Row[] = [
  ['conv.multivalued-optional-leaf.title', 'Optional part of multivalued {attribute} and the key of {relation}', '多值属性“{attribute}”的可选部分与“{relation}”的键'],
  variant(
    'conv.multivalued-optional-leaf',
    'explanation',
    'out.one',
    'The optional sub-attribute {columns} stays nullable and outside the key (a key column cannot be NULL), so two values that differ only there are not both allowed.',
    '可选的子属性 {columns} 保持可为空，且不属于键（键属性不能为 NULL），因此仅在该子属性上不同的两个值不能同时存在。',
  ),
  variant(
    'conv.multivalued-optional-leaf',
    'explanation',
    'out.other',
    'The optional sub-attributes {columns} stay nullable and outside the key (a key column cannot be NULL), so two values that differ only there are not both allowed.',
    '可选的子属性 {columns} 保持可为空，且不属于键（键属性不能为 NULL），因此仅在这些子属性上不同的两个值不能同时存在。',
  ),
  variant(
    'conv.multivalued-optional-leaf',
    'explanation',
    'forced.one',
    '{columns} is optional but, as no required sub-attribute exists, had to become part of the key and therefore NOT NULL.',
    '{columns} 是可选的，但由于不存在必需的子属性，它不得不成为键的一部分，因此被设为 NOT NULL。',
  ),
  variant(
    'conv.multivalued-optional-leaf',
    'explanation',
    'forced.other',
    '{columns} are optional but, as no required sub-attribute exists, had to become part of the key and therefore NOT NULL.',
    '{columns} 是可选的，但由于不存在必需的子属性，它们不得不成为键的一部分，因此被设为 NOT NULL。',
  ),
  ['conv.multivalued-optional-leaf.suggestion', 'Make the sub-attribute required, or accept the stated key.', '将该子属性设为必需，或接受上述的键。'],

  ...issue(
    'conv.weak-ownership-cycle',
    ['Weak-entity ownership cycle: {chain}', '弱实体属主循环：{chain}'],
    [
      '{names} identify each other (directly or through a chain), so no complete key can be built. Their relations were created WITHOUT the cyclic owner part of the key.',
      '{names} 相互标识（直接或经由一条标识链），因此无法构造出完整的键。它们对应的关系模式在创建时不包含键中构成循环的属主部分。',
    ],
    ['Break the cycle: an entity cannot be identified by an entity it identifies.', '打破循环：一个实体不能由它自己所标识的实体来标识。'],
  ),

  ['conv.total-on-one-side-unenforceable.title', 'Total participation of {entity} in {relationship} is not enforced', '“{entity}”在“{relationship}”中的全部参与约束不会被强制执行'],
  [
    'conv.total-on-one-side-unenforceable.explanation',
    'Every {refName} must take part in {relationship} (have at least one {holderName}). The foreign key on {relation} guarantees only that each {holderName} refers to an existing {refName}; "at least one" cannot be expressed by a foreign key.',
    '每个“{refName}”都必须参与“{relationship}”（至少对应一个“{holderName}”）。“{relation}”上的外键只能保证每个“{holderName}”都引用一个已存在的“{refName}”；“至少一个”无法用外键表达。',
  ],
  [
    'conv.total-on-one-side-unenforceable.suggestion',
    `${NOT_ENFORCED}; the foreign key is annotated with the intended minimum (childMin = 1).`,
    '请在应用程序逻辑中或用触发器来强制执行；外键上已标注预期的最小基数（childMin = 1）。',
  ],
  variant('conv.total-on-one-side-unenforceable', 'title', 'weak', 'Total participation of {owner} in {relationship} is not enforced', '“{owner}”在“{relationship}”中的全部参与约束不会被强制执行'),
  variant(
    'conv.total-on-one-side-unenforceable',
    'explanation',
    'weak',
    'Every {owner} must own at least one {entity}. The foreign key from {entity} guarantees the opposite direction only.',
    '每个“{owner}”都必须拥有至少一个“{entity}”。来自“{entity}”的外键只能保证相反方向的约束。',
  ),
  variant(
    'conv.total-on-one-side-unenforceable',
    'suggestion',
    'weak',
    'Enforce "at least one" in application logic or with a trigger.',
    '请在应用程序逻辑中或用触发器强制执行“至少一个”。',
  ),

  ...issue(
    'conv.one-to-one-merge-lossy',
    ['Merging {primary} and {other} cannot store unpaired {other} rows', '合并“{primary}”与“{other}”后，无法存储没有配对的“{other}”行'],
    [
      'Neither entity participates totally in {relationship}, so the merged relation (keyed by {primary}) cannot represent a {other} that has no {primary}.',
      '两个实体都不是全部参与“{relationship}”，因此合并后的关系模式（以“{primary}”为键）无法表示没有对应“{primary}”的“{other}”。',
    ],
    ['Use a foreign key or a separate relationship relation instead, or make one side total.', '改用外键或单独的联系关系模式，或将其中一侧设为全部参与。'],
  ),
  ...issue(
    'conv.relationship-key-fallback',
    ['Key of {relationship} replaced by a candidate key', '“{relationship}”的键被替换为候选键'],
    [
      'The chosen key participants of {relationship} do not contain a key implied by its cardinalities, so the primary key of the generated relation uses the first candidate key instead.',
      '为“{relationship}”选定的键参与者不包含由其基数推出的键，因此生成的关系模式的主键改用第一个候选键。',
    ],
    ['Choose key participants that include a candidate key, or fix the cardinalities.', '选择包含候选键的键参与者，或修正基数。'],
  ),
  ...issue(
    'conv.total-participation-unenforceable',
    ['Total participation of {entity} in {relationship} is not enforced', '“{entity}”在“{relationship}”中的全部参与约束不会被强制执行'],
    [
      'Every {entity} must take part in {relationship}, i.e. appear in {relation}. A foreign key only guarantees the opposite direction (every row of {relation} refers to an existing {entity}); "at least one row" needs an application check, a trigger or a deferred constraint.',
      '每个“{entity}”都必须参与“{relationship}”，即必须出现在“{relation}”中。外键只能保证相反方向的约束（“{relation}”的每一行都引用一个已存在的“{entity}”）；“至少一行”需要靠应用程序检查、触发器或延迟约束来保证。',
    ],
    [
      'Enforce it in application logic or with a database trigger; the foreign key is annotated with the intended minimum.',
      '请在应用程序逻辑中或用数据库触发器强制执行；外键上已标注预期的最小基数。',
    ],
  ),
  ...issue(
    'conv.fk-participant-invalid',
    ['Chosen FK side for {relationship} is not a participant', '为“{relationship}”选定的外键所在一侧不是它的参与者'],
    [
      'The override names participant {participant}, which does not take part in {relationship}; the strategy options were used instead.',
      '覆盖设置指定了参与者 {participant}，但它并不参与“{relationship}”；已改用转换策略选项。',
    ],
    ['Pick one of the two participants of the relationship as the FK side.', '从该联系的两个参与者中选择一个作为外键所在的一侧。'],
  ),
  ['conv.one-to-one-merge-ineligible.title', 'Cannot merge the entities of {relationship}', '无法合并“{relationship}”涉及的实体'],
  ...(
    [
      [
        'recursive',
        'a recursive 1:1 relationship relates an entity to itself, so there is nothing to merge',
        '递归的 1:1 联系关联的是同一个实体自身，没有可合并的对象',
      ],
      [
        'plain',
        'only plain strong entities can be merged (weak and associative entities keep their own relation)',
        '只有普通的强实体才能合并（弱实体和关联实体保留各自的关系模式）',
      ],
      [
        'pairwise',
        'one of the entities is already merged through another 1:1 relationship (merging is pairwise)',
        '其中一个实体已通过另一条 1:1 联系合并（合并只能两两进行）',
      ],
    ] as const
  ).map(([kind, en, zh]) =>
    variant(
      'conv.one-to-one-merge-ineligible',
      'explanation',
      kind,
      `Merge was requested for {relationship}, but ${en}. A foreign key on the total-participation side was used instead.`,
      `已请求合并“{relationship}”，但${zh}。已改为在全部参与的一侧放置外键。`,
    ),
  ),
  [
    'conv.one-to-one-merge-ineligible.suggestion',
    'Choose "foreign key" or "separate relation" for this relationship.',
    '为该联系选择“外键”或“单独的关系模式”。',
  ],
  ...issue(
    'conv.identifying-unresolved',
    ['Identifying relationship {relationship} has no identified participant', '标识联系“{relationship}”没有被标识的参与者'],
    [
      '{relationship} is marked identifying, but it is not clear which participant is the weak entity (flag one participant as identified, or have exactly one weak participant). It was converted as an ordinary relationship.',
      '“{relationship}”被标记为标识联系，但不清楚哪个参与者是弱实体（请将一个参与者标记为被标识方，或使其恰好只有一个弱实体参与者）。它已按普通联系转换。',
    ],
    ['Mark the dependent participant as identified.', '将依附的参与者标记为被标识方。'],
  ),
  ...issue(
    'conv.relationship-key-attr-folded',
    ['Key flag of {attributes} ignored', '{attributes} 上的键标记被忽略'],
    [
      '{relationship} was translated into a foreign key, so no relationship relation exists whose key could include {attributes}; the attribute became an ordinary column of {relation}.',
      '“{relationship}”被转换为外键，因此不存在可以把 {attributes} 纳入键的联系关系模式；该属性成为了“{relation}”的普通属性。',
    ],
    ['Model the relationship as M:N (or an associative entity) if it needs its own key.', '如果该联系需要自己的键，请将它建模为 M:N 联系（或关联实体）。'],
  ),
  ...issue(
    'conv.one-to-one-ambiguous-placement',
    ['Foreign key side of 1:1 {relationship} is arbitrary', '1:1 联系“{relationship}”的外键所在一侧是任意选定的'],
    [
      'Neither {holder} nor {ref} participates totally in {relationship}, so nothing says which relation should hold the foreign key. It was placed on {holder} (first participant), nullable and UNIQUE.',
      '“{holder}”和“{ref}”都不是全部参与“{relationship}”，因此没有依据判断外键应放在哪个关系模式中。它被放在了“{holder}”（第一个参与者）中，可为空且 UNIQUE。',
    ],
    ['Choose the FK side explicitly, merge the entities, or use a separate relation.', '明确指定外键所在的一侧、合并这两个实体，或使用单独的关系模式。'],
  ),
  ...issue(
    'conv.one-to-one-both-total',
    ['1:1 {relationship} is total on both sides', '1:1 联系“{relationship}”两侧均为全部参与'],
    [
      'Both entities participate totally, so the FK on {holder} (first participant) is valid but merging {holder} and {ref} into one relation is an equally good option. Foreign keys cannot enforce that every {ref} also has a {holder}.',
      '两个实体都是全部参与，因此放在“{holder}”（第一个参与者）上的外键是有效的，但把“{holder}”和“{ref}”合并为一个关系模式同样是好的选择。外键无法保证每个“{ref}”也都有对应的“{holder}”。',
    ],
    ['Consider the "merge" strategy for this relationship.', '考虑为该联系采用“合并”策略。'],
  ),

  // ops.applyConversionResult report (conversion REPLACES a model)
  ...issue(
    'conv.hand-added-kept',
    ['Hand-added elements were kept', '已保留手工添加的元素'],
    [
      '{count} element(s) you added by hand were carried over into the regenerated schema.',
      '您手工添加的 {count} 个元素已带入重新生成的关系模式中。',
    ],
    [
      'Review them: they are not derived from the ER model and are not updated by future conversions.',
      '请检查它们：它们并非由 ER 模型派生，也不会被以后的转换更新。',
    ],
  ),
  ...issue(
    'conv.hand-added-dropped',
    ['Hand-added elements could not be kept', '无法保留手工添加的元素'],
    [
      '{count} hand-added element(s) referenced columns or relations that the conversion no longer produces: {details}.',
      '有 {count} 个手工添加的元素（唯一约束、索引、检查约束或外键）引用了转换不再生成的属性或关系模式，因此没有保留。',
    ],
    ['Re-create them against the regenerated schema if you still need them.', '如果仍需要它们，请基于重新生成的关系模式重新创建。'],
  ),
  ...issue(
    'conv.hand-added-renamed',
    ['Hand-added elements were renamed', '手工添加的元素已被重命名'],
    [
      'Hand-added element(s) clashed with regenerated names and were renamed: {details}.',
      '有 {count} 个手工添加的元素与重新生成的名称冲突，已被重命名（受影响的对象已高亮）。',
    ],
    ['Merge the duplicates or pick distinct names.', '合并重复项，或改用互不相同的名称。'],
  ),
  ...issue(
    'conv.edits-overwritten',
    ['Edits to generated elements were overwritten', '对生成元素的修改已被覆盖'],
    ['Regeneration replaced {count} edited value(s): {details}.', '重新生成时替换了 {count} 个被修改过的值（受影响的对象已高亮）。'],
    [
      'Undo the conversion to restore them, or re-apply the edits (or change the ER model so the generated value is what you want).',
      '撤销本次转换以恢复它们，或重新应用这些修改（或修改 ER 模型，使生成的值符合您的要求）。',
    ],
  ),
];

export default defineMessages('issues', fromRows(rows));
