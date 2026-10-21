import { fromRows, type Row } from '../build';
import { defineMessages } from '../core';

/** Words of the validation flow that are used at startup (announcements, placeholders); the issue texts themselves are DEFERRED, see index.ts. */
const words: Row[] = [
  ['word.unnamed', '(unnamed)', '（未命名）'],
  ['word.dialectChecksUnavailable', 'The SQL dialect checks could not be loaded, so this result covers the model rules only. Check your connection and validate again.', 'SQL 方言检查未能加载，此结果仅包含模型规则。请检查网络后重新检查。'],
  ['word.validationClean', 'Validation finished: no issues.', '检查完成：没有问题。'],
  ['word.validationDone', 'Validation finished: {errors}, {warnings}, {notes}.', '检查完成：{errors}，{warnings}，{notes}。'],
  ['word.nErrors.one', '{count} error', '{count} 个错误'],
  ['word.nErrors.other', '{count} errors', '{count} 个错误'],
  ['word.nWarnings.one', '{count} warning', '{count} 个警告'],
  ['word.nWarnings.other', '{count} warnings', '{count} 个警告'],
  ['word.nNotes.one', '{count} note', '{count} 条提示'],
  ['word.nNotes.other', '{count} notes', '{count} 条提示'],
  ['word.deleted', '(deleted)', '（已删除）'],
  ['word.deletedColumn', 'a deleted column', '一个已删除的属性'],
  ['at', '(line {line}, column {column})', '（第 {line} 行，第 {column} 列）'],
];

export default defineMessages('issues', fromRows(words));
