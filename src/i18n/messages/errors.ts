/**
 * Errors the model / persistence layers raise or report: namespace `errors`.
 *   errors.load.<LoadErrorCode>[.path]   LoadError (file / autosave could not be opened)
 *   errors.op.<OpErrorCode>              OpError (an edit was refused; nothing changed)
 *   errors.invariant.<code>              InvariantViolation (checkInvariants)
 * Use the helpers in src/i18n/errors.ts instead of reading these keys directly.
 */
import { fromRows, type Row } from '../build';
import { defineMessages } from '../core';

const rows: Row[] = [
  ['load.not-json', 'The file is not valid JSON.', '文件不是有效的 JSON。'],
  ['load.wrong-format', 'This is not a SchemaCanvas project file.', '这不是 SchemaCanvas 项目文件。'],
  ['load.newer-version', 'This file was saved by a newer version of SchemaCanvas and cannot be opened here.', '此文件由更新版本的 SchemaCanvas 保存，无法在当前版本中打开。'],
  ['load.unsupported-version', 'This file uses a project format version that is no longer supported.', '此文件使用的项目格式版本已不再受支持。'],
  ['load.invalid-structure', 'The project data is damaged or incomplete.', '项目数据已损坏或不完整。'],
  ['load.invalid-structure.path', 'The project data is damaged or incomplete (problem at {path}).', '项目数据已损坏或不完整（问题出在 {path}）。'],

  ['op.not-found', 'The item no longer exists.', '该对象已不存在。'],
  ['op.wrong-kind', 'This action does not apply to that kind of item.', '此操作不适用于这种类型的对象。'],
  ['op.invalid', 'That change is not allowed.', '不允许这样的更改。'],
  ['op.id-in-use', 'That id is already in use.', '该标识符已被占用。'],
  ['op.cycle', 'That change would create a cycle.', '这样的更改会形成循环。'],
  ['op.foreign-key-invalid', 'That foreign key would be invalid.', '该外键无效。'],
  ['op.paste-kind-mismatch', 'The clipboard content cannot be pasted into this diagram.', '剪贴板中的内容无法粘贴到此图表中。'],

  ['invariant.attribute-owner-cycle', 'An attribute is nested inside itself.', '某个属性嵌套在它自身之内。'],
  ['invariant.attribute-owner-missing', 'An attribute refers to an owner that does not exist.', '某个属性引用了不存在的属主。'],
  ['invariant.column-widths-orphan', 'A diagram stores a column width for a column that does not exist.', '图表保存了一个不存在的列的列宽。'],
  ['invariant.diagram-model-kind', 'A diagram is attached to a model of the wrong kind.', '某个图表关联了类型不匹配的模型。'],
  ['invariant.diagram-model-missing', 'A diagram refers to a model that does not exist.', '某个图表引用了不存在的模型。'],
  ['invariant.diagram-order', 'The diagram order does not match the diagrams.', '图表的排列顺序与实际的图表不一致。'],
  ['invariant.duplicate-id', 'Two objects share the same id.', '两个对象使用了相同的标识符。'],
  ['invariant.edge-duplicate', 'A diagram has two connectors for the same item.', '图表中同一对象有两条连线。'],
  ['invariant.edge-endpoint-missing', 'A connector is attached to a shape that does not exist.', '某条连线连接到了不存在的图形。'],
  ['invariant.edge-ref-dangling', 'A connector refers to a model element that does not exist.', '某条连线引用了不存在的模型元素。'],
  ['invariant.fk-relation-missing', 'A foreign key refers to a relation that does not exist.', '某个外键引用了不存在的关系模式。'],
  ['invariant.key-column-duplicate', 'A key lists the same column twice.', '某个键重复列出了同一个属性。'],
  ['invariant.key-column-invalid', 'A key refers to a column that is not in its relation.', '某个键引用了不属于其关系模式的属性。'],
  ['invariant.key-id-mismatch', 'An object is stored under a different id than the one it carries.', '某个对象的存储标识符与它自身携带的标识符不一致。'],
  ['invariant.node-duplicate', 'A diagram has two shapes for the same item.', '图表中同一对象有两个图形。'],
  ['invariant.node-ref-dangling', 'A shape refers to a model element that does not exist.', '某个图形引用了不存在的模型元素。'],
  ['invariant.node-ref-kind', 'A shape refers to a model element of the wrong kind.', '某个图形引用了类型不符的模型元素。'],
  ['invariant.option-block-missing', 'A diagram lacks the option settings for its type.', '某个图表缺少其类型所需的选项设置。'],
];

export default defineMessages('errors', fromRows(rows));
