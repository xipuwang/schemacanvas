import { describe, expect, it } from 'vitest';
import { catalogueGaps, hasMessage, registerMessages, registeredNamespaces, t, tp } from './index';

describe('i18n', () => {
  it('registers the per-feature catalogues and every namespace is complete in en and zh', () => {
    expect(registeredNamespaces()).toContain('common');
    expect(catalogueGaps()).toEqual([]);
  });
  it('interpolates, falls back to English, then to the key', () => {
    expect(t('common.ok', undefined, 'zh')).toBe('确定');
    expect(t('common.ok', undefined, 'en')).toBe('OK');
    expect(t('nope.missing')).toBe('nope.missing');
    expect(t('common.items.other', { count: 3 }, 'en')).toBe('3 items');
    expect(t('common.items.other', {}, 'en')).toBe('{count} items'); // unknown placeholders stay visible
  });
  it('plurals', () => {
    expect(tp('common.items', 1, undefined, 'en')).toBe('1 item');
    expect(tp('common.items', 3, undefined, 'en')).toBe('3 items');
    expect(tp('common.items', 3, undefined, 'zh')).toBe('3 项');
    expect(hasMessage('common.ok', 'zh')).toBe(true);
  });
  it('registering a namespace twice merges (several features contribute to one namespace)', () => {
    registerMessages('mergetest', { en: { a: 'A' }, zh: { a: '甲' } });
    registerMessages('mergetest', { en: { b: 'B' }, zh: { b: '乙' } });
    expect(t('mergetest.a', undefined, 'en')).toBe('A');
    expect(t('mergetest.b', undefined, 'zh')).toBe('乙');
  });
});
