import { defineMessages } from '../core';

/** Strings of the issues dock (bottom panel). */
export default defineMessages('issuesPanel', {
  en: {
    filter: 'Show severities',
    'severity.error': 'Errors',
    'severity.warning': 'Warnings',
    'severity.info': 'Notes',
    stale: 'Out of date',
    validate: 'Validate',
    emptyTitle: 'No issues',
    emptyDesc: 'The model passes every check.',
    noneShown: 'No issues match the selected severities.',
    'listLabel.one': '{count} issue',
    'listLabel.other': '{count} issues',
    more: '+{count} more',
    suggestion: 'Suggestion:',
    showIn: 'Show in {name}',
    notOnSheet: 'This issue has no element on the current sheet.',
  },
  zh: {
    filter: '按严重程度筛选',
    'severity.error': '错误',
    'severity.warning': '警告',
    'severity.info': '提示',
    stale: '已过期',
    validate: '检查',
    emptyTitle: '没有问题',
    emptyDesc: '模型通过了所有检查。',
    noneShown: '没有符合所选严重程度的问题。',
    'listLabel.one': '{count} 个问题',
    'listLabel.other': '{count} 个问题',
    more: '另有 {count} 项',
    suggestion: '建议：',
    showIn: '在“{name}”中显示',
    notOnSheet: '此问题在当前图纸上没有对应元素。',
  },
});
