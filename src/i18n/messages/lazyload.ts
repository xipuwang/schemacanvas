import { defineMessages } from '../core';

/** Shown inside the frame of a lazily loaded dialog / dock when its code could not be downloaded (src/ui/dialogs/content/lazy.tsx). */
export default defineMessages('lazyload', {
  en: {
    failedTitle: 'Could not load this tool',
    failedDesc: 'The code for this window did not download. Check the connection and try again.',
    retry: 'Retry',
  },
  zh: {
    failedTitle: '无法加载此工具',
    failedDesc: '此窗口所需的代码未能下载。请检查网络连接后重试。',
    retry: '重试',
  },
});
