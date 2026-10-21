import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vite.config';

// the main config is a function of the Vite command; tests run as 'serve'
export default defineConfig((env) => mergeConfig(base(env), { test: { setupFiles: ['src/i18n/probe/setup.ts'] } }));
