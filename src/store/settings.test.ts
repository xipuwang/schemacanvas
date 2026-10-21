import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, createSettingsStore, resolveTheme, sanitizeSettings } from './settings';

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial === undefined ? [] : [[SETTINGS_STORAGE_KEY, initial]]);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe('settings store', () => {
  it('starts with defaults and persists changes', () => {
    const st = memoryStorage();
    const s = createSettingsStore(st);
    expect(s.getState()).toMatchObject(DEFAULT_SETTINGS);
    s.getState().setTheme('dark');
    s.getState().setLocale('zh');
    s.getState().togglePanel('issues');
    s.getState().setPanel('library', false);
    expect(JSON.parse(st.data.get(SETTINGS_STORAGE_KEY)!)).toEqual({
      theme: 'dark',
      locale: 'zh',
      panels: { library: false, properties: true, issues: true },
    });
  });

  it('restores persisted values in a new store', () => {
    const st = memoryStorage();
    createSettingsStore(st).getState().setTheme('light');
    expect(createSettingsStore(st).getState().theme).toBe('light');
  });

  it('ignores corrupt or invalid stored values field by field', () => {
    expect(createSettingsStore(memoryStorage('{not json')).getState()).toMatchObject(DEFAULT_SETTINGS);
    const s = createSettingsStore(memoryStorage(JSON.stringify({ theme: 'neon', locale: 'zh', panels: { library: 'no', issues: true } })));
    expect(s.getState().theme).toBe('system');
    expect(s.getState().locale).toBe('zh');
    expect(s.getState().panels).toEqual({ library: true, properties: true, issues: true });
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('survives storage that throws on read and write (private mode)', () => {
    const throwing = {
      getItem: vi.fn(() => {
        throw new Error('denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    };
    const s = createSettingsStore(throwing);
    expect(s.getState().theme).toBe('system');
    expect(() => s.getState().setTheme('dark')).not.toThrow();
    expect(s.getState().theme).toBe('dark');
  });

  it('works with no storage at all (SSR)', () => {
    const s = createSettingsStore(undefined);
    s.getState().setLocale('zh');
    expect(s.getState().locale).toBe('zh');
  });

  it('resolveTheme passes explicit themes through and defaults to light without matchMedia', () => {
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('system')).toBe('light'); // node: no matchMedia
  });
});
