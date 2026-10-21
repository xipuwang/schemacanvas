import { beforeEach, describe, expect, it, vi } from 'vitest';

// A fresh core per test: the setup file has already loaded zh into the shared one.
beforeEach(() => vi.resetModules());

describe('on-demand locale loading', () => {
  it('t() falls back to English until zh is loaded; setLocaleLoaded flips the locale only after the load', async () => {
    const core = await import('./core');
    const { settingsStore } = await import('@/store/settings');
    settingsStore.getState().setLocale('en');
    core.registerLocale('en', { demo: { hello: 'Hello' } });
    let release!: () => void;
    core.setLocaleLoader('zh', () => new Promise((r) => (release = () => r([{ demo: { hello: '你好' } }]))));
    expect(core.t('demo.hello', undefined, 'zh')).toBe('Hello'); // never the key, never blank
    const pending = core.setLocaleLoaded('zh');
    expect(settingsStore.getState().locale).toBe('en'); // still English while downloading
    release();
    expect(await pending).toBe('applied');
    expect(settingsStore.getState().locale).toBe('zh');
    expect(core.t('demo.hello')).toBe('你好');
    expect(core.isLocaleLoaded('zh')).toBe(true);
  });

  it('a failed download keeps the current language and can be retried', async () => {
    const core = await import('./core');
    const { settingsStore } = await import('@/store/settings');
    settingsStore.getState().setLocale('en');
    let attempts = 0;
    core.setLocaleLoader('zh', async () => {
      if (++attempts === 1) throw new Error('offline');
      return [{ demo: { hello: '你好' } }];
    });
    expect(await core.setLocaleLoaded('zh')).toBe('failed');
    expect(settingsStore.getState().locale).toBe('en');
    expect(await core.setLocaleLoaded('zh')).toBe('applied');
    expect(settingsStore.getState().locale).toBe('zh');
  });

  it('concurrent loads share one download', async () => {
    const core = await import('./core');
    let calls = 0;
    core.setLocaleLoader('zh', async () => (calls++, []));
    await Promise.all([core.loadLocale('zh'), core.loadLocale('zh')]);
    expect(calls).toBe(1);
  });

  it('latest request wins: en -> zh (downloading) -> en ends in en when the zh download completes', async () => {
    const core = await import('./core');
    const { settingsStore } = await import('@/store/settings');
    settingsStore.getState().setLocale('en');
    let release!: () => void;
    core.setLocaleLoader('zh', () => new Promise((r) => (release = () => r([{ demo: { hello: '你好' } }]))));
    const toZh = core.setLocaleLoaded('zh');
    expect(await core.setLocaleLoaded('en')).toBe('applied');
    release();
    expect(await toZh).toBe('superseded');
    expect(settingsStore.getState().locale).toBe('en');
    expect(core.isLocaleLoaded('zh')).toBe(true); // the download itself is kept for next time
  });

  it('a superseded download that fails is reported as superseded, not failed', async () => {
    const core = await import('./core');
    const { settingsStore } = await import('@/store/settings');
    settingsStore.getState().setLocale('en');
    let reject!: () => void;
    core.setLocaleLoader('zh', () => new Promise((_, rj) => (reject = () => rj(new Error('offline')))));
    const toZh = core.setLocaleLoaded('zh');
    expect(await core.setLocaleLoaded('en')).toBe('applied');
    reject();
    expect(await toZh).toBe('superseded');
    expect(settingsStore.getState().locale).toBe('en');
  });
});
