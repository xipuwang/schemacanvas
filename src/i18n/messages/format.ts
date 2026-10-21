import { fromRows } from '../build';
import { defineMessages } from '../core';

/** Words used by src/i18n/format.ts (everything numeric / list-like comes from Intl). */
export default defineMessages(
  'format',
  fromRows([
    ['justNow', 'just now', '刚刚'],
    ['savedAgo', 'Saved {when}', '{when}已保存'],
    ['savedJustNow', 'Saved just now', '刚刚已保存'],
  ]),
);
