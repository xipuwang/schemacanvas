// @vitest-environment node
/** The published site ships public/THIRD-PARTY-NOTICES.txt; every runtime dependency must be listed (re-run `npm run notices`). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const notices = readFileSync('public/THIRD-PARTY-NOTICES.txt', 'utf8');
const deps = Object.keys((JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> }).dependencies);

describe('third-party notices', () => {
  it.each(deps)('lists %s with its installed version', (dep) => {
    const version = (JSON.parse(readFileSync(`node_modules/${dep}/package.json`, 'utf8')) as { version: string }).version;
    expect(notices).toContain(`\n${dep} ${version}\n`);
  });
  it('carries the EPL-2.0 source pointer for elkjs', () => {
    expect(notices).toMatch(/elkjs[\s\S]*?Source code: https:\/\/github\.com\/kieler\/elkjs/);
  });
});
