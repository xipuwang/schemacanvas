// Vitest setup: tests see both languages and every deferred catalogue (the app loads them on demand, see core.loadLocale).
import { loadLocale } from './index';

await Promise.all([loadLocale('en'), loadLocale('zh')]);
