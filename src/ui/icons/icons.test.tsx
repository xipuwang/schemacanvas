// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ICON_ALIASES, ICON_NAMES, Icon, resolveIcon } from './index';

afterEach(cleanup);

describe('icons', () => {
  it('ships the required set (~50+) and every icon draws something on the 16px grid', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(50);
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.children.length, name).toBeGreaterThan(0);
      unmount();
    }
  });
  it('covers every glyph the spec lists', () => {
    const required = ['select', 'hand', 'undo', 'redo', 'new', 'open', 'save', 'export', 'import', 'layout', 'validate', 'convert', 'zoom-in', 'zoom-out', 'zoom-fit', 'grid', 'snap', 'align-left', 'align-center', 'align-right', 'align-top', 'align-middle', 'align-bottom', 'distribute-h', 'distribute-v', 'match-size', 'trash', 'copy', 'paste', 'cut', 'duplicate', 'lock', 'unlock', 'front', 'back', 'key', 'link', 'table', 'entity', 'relationship', 'attribute', 'settings', 'help', 'search', 'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right', 'close', 'plus', 'warning', 'error', 'info', 'sun', 'moon', 'sheet', 'sql', 'image', 'pdf', 'folder', 'example'];
    expect(required.filter((n) => !(ICON_NAMES as string[]).includes(n))).toEqual([]);
  });
  it('resolves aliases used by other modules and labels icons on request', () => {
    expect(resolveIcon('pointer')).toBe('select');
    for (const [alias, target] of Object.entries(ICON_ALIASES)) expect(ICON_NAMES).toContain(target as never);
    const { container } = render(<Icon name="pointer" label="Pointer" />);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Pointer');
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBeNull();
    const none = render(<Icon name="does-not-exist" />);
    expect(none.container.querySelector('svg')?.children.length).toBe(0);
  });
});
