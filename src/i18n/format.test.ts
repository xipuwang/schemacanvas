import { describe, expect, it } from 'vitest';
import '@/i18n';
import { formatCount, formatDateTime, formatList, formatNumber, formatRelativeTime, formatSavedAgo, intlLocale } from './format';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const ago = (seconds: number): number => NOW - seconds * 1000;

describe('formatCount', () => {
  it('chooses the plural form in English and groups large numbers', () => {
    expect(formatCount(1, 'common.items', undefined, 'en')).toBe('1 item');
    expect(formatCount(8, 'common.items', undefined, 'en')).toBe('8 items');
    expect(formatCount(0, 'common.items', undefined, 'en')).toBe('0 items');
    expect(formatCount(1200, 'common.items', undefined, 'en')).toBe('1,200 items');
  });
  it('Chinese has one form', () => {
    expect(formatCount(1, 'common.items', undefined, 'zh')).toBe('1 项');
    expect(formatCount(8, 'common.items', undefined, 'zh')).toBe('8 项');
    expect(formatCount(12000, 'common.items', undefined, 'zh')).toBe('12,000 项');
  });
  it('formatNumber follows the locale', () => {
    expect(formatNumber(1234567.5, 'en')).toBe('1,234,567.5');
    expect(formatNumber(1234567.5, 'zh')).toBe('1,234,567.5');
  });
});

describe('formatList', () => {
  it('joins with the language conjunction', () => {
    expect(formatList(['a', 'b', 'c'], 'and', 'en')).toBe('a, b and c');
    expect(formatList(['甲', '乙', '丙'], 'and', 'zh')).toBe('甲、乙和丙');
    expect(formatList(['a', 'b'], 'or', 'en')).toBe('a or b');
    expect(formatList(['甲', '乙'], 'or', 'zh')).toBe('甲或乙');
  });
  it('handles zero and one item', () => {
    expect(formatList([], 'and', 'en')).toBe('');
    expect(formatList(['Doctor'], 'and', 'zh')).toBe('Doctor');
  });
});

describe('relative time', () => {
  it('English', () => {
    expect(formatRelativeTime(ago(10), NOW, 'en')).toBe('just now');
    expect(formatRelativeTime(ago(60), NOW, 'en')).toBe('1 minute ago');
    expect(formatRelativeTime(ago(3 * 60), NOW, 'en')).toBe('3 minutes ago');
    expect(formatRelativeTime(ago(2 * 3600), NOW, 'en')).toBe('2 hours ago');
    expect(formatRelativeTime(ago(26 * 3600), NOW, 'en')).toBe('yesterday');
    expect(formatRelativeTime(ago(3 * 86400), NOW, 'en')).toBe('3 days ago');
    expect(formatRelativeTime(NOW + 5 * 60 * 1000, NOW, 'en')).toBe('in 5 minutes');
  });
  it('Chinese', () => {
    expect(formatRelativeTime(ago(10), NOW, 'zh')).toBe('刚刚');
    expect(formatRelativeTime(ago(3 * 60), NOW, 'zh')).toBe('3分钟前');
    expect(formatRelativeTime(ago(2 * 3600), NOW, 'zh')).toBe('2小时前');
    expect(formatRelativeTime(ago(26 * 3600), NOW, 'zh')).toBe('昨天');
  });
  it('"Saved 3 minutes ago"', () => {
    expect(formatSavedAgo(ago(3 * 60), NOW, 'en')).toBe('Saved 3 minutes ago');
    expect(formatSavedAgo(ago(3 * 60), NOW, 'zh')).toBe('3分钟前已保存');
    expect(formatSavedAgo(ago(5), NOW, 'en')).toBe('Saved just now');
    expect(formatSavedAgo(ago(5), NOW, 'zh')).toBe('刚刚已保存');
  });
  it('accepts Date objects', () => {
    expect(formatRelativeTime(new Date(ago(120)), new Date(NOW), 'en')).toBe('2 minutes ago');
  });
});

describe('dates', () => {
  it('formats in the user language', () => {
    const d = Date.UTC(2026, 9, 18, 14, 5, 0);
    expect(formatDateTime(d, 'en')).toMatch(/18 Oct 2026/);
    expect(formatDateTime(d, 'zh')).toMatch(/2026年10月18日/);
    expect(intlLocale('zh')).toBe('zh-CN');
  });
});
