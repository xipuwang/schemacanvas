// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { sampleProject } from '@/model/io/testFixtures';
import * as ops from '@/model/ops';
import { editorStore, settingsStore } from '@/store';
import { Dialog, SegmentedControl, restoreFocusTo } from '../components';
import { MAX_VISIBLE_TOASTS, stackToast, uiStore, type ToastMessage } from '../uiStore';
import { CommandPalette } from './CommandPalette';
import { startFocusPolicy } from './focusPolicy';
import { shellStore } from './shellStore';
import { namesSignature, startToastHygiene } from './toasts';

beforeEach(() => {
  settingsStore.getState().setLocale('en');
  uiStore.setState({ dialog: null, toasts: [] });
});
afterEach(() => {
  cleanup();
  shellStore.getState().setPalette(false);
  document.body.innerHTML = '';
});

const toast = (id: number, kind: ToastMessage['kind'], message: string, at = 0, extra: Partial<ToastMessage> = {}): ToastMessage => ({ id, kind, message, ttl: kind === 'error' ? 0 : 4000, at, ...extra });

describe('UX-8 toast stack', () => {
  it('dedupes identical text, coalesces rapid same-kind confirmations, and never exceeds the cap', () => {
    let list: ToastMessage[] = [];
    list = stackToast(list, toast(1, 'success', 'A', 0));
    list = stackToast(list, toast(2, 'success', 'A', 10));
    expect(list.map((x) => x.id)).toEqual([2]);
    list = stackToast(list, toast(3, 'success', 'B', 20));
    expect(list.map((x) => x.message)).toEqual(['B']); // same kind within the window: the latest replaces
    list = stackToast(list, toast(4, 'info', 'C', 30));
    list = stackToast(list, toast(5, 'warning', 'D', 40));
    list = stackToast(list, toast(6, 'error', 'E', 50));
    expect(list.length).toBeLessThanOrEqual(MAX_VISIBLE_TOASTS);
    expect(list.some((x) => x.kind === 'error')).toBe(true); // sticky errors are dropped last
  });

  it('through the store: six connect-style toasts leave at most three', () => {
    for (let i = 0; i < 6; i++) uiStore.getState().pushToast({ kind: 'success', message: `Created relationship R${i}` });
    expect(uiStore.getState().toasts.length).toBeLessThanOrEqual(MAX_VISIBLE_TOASTS);
    expect(uiStore.getState().toasts.at(-1)?.message).toBe('Created relationship R5');
  });

  it('a rename dismisses the transient toast that names the old text (no stale names)', async () => {
    editorStore.getState().loadProject(sampleProject());
    const off = startToastHygiene();
    uiStore.getState().pushToast({ kind: 'success', message: 'Created relationship Relationship1 between A and B' });
    uiStore.getState().pushToast({ kind: 'error', message: 'sticky error' });
    await new Promise((r) => setTimeout(r, 200));
    const p = editorStore.getState().project;
    const before = namesSignature(p);
    editorStore.getState().commit('rename', (d) => ops.renameProject(d, 'Renamed'));
    expect(namesSignature(editorStore.getState().project)).not.toBe(before);
    expect(uiStore.getState().toasts.map((x) => x.message)).toEqual(['sticky error']);
    off();
  });
});

describe('A11Y-15 / A11Y-10 dialog', () => {
  it('opens focused on the CHECKED radio (never the roving tabindex=-1 one) and adds no banner/contentinfo', () => {
    render(
      <Dialog title="Settings" onClose={() => undefined} footer={<button type="button">Done</button>}>
        <SegmentedControl label="Theme" value="dark" onChange={() => undefined} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Dark' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('header,footer')).toBeNull();
  });
});

describe('A11Y-11 palette with no results', () => {
  it('has no empty listbox: the message is a status outside any listbox', () => {
    shellStore.getState().setPalette(true);
    render(<CommandPalette />);
    const input = screen.getByRole('combobox');
    act(() => {
      (input as HTMLInputElement).focus();
    });
    // an unmatched query
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'zzzzqqqq');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.queryAllByRole('listbox')).toHaveLength(0);
    expect(screen.getByRole('status').textContent).toMatch(/no matching/i);
    expect(input.getAttribute('aria-controls')).toBeNull();
  });
});

describe('A11Y-07 focus-return policy', () => {
  it('restoreFocusTo falls back to the canvas when the opener is disabled or gone', async () => {
    document.body.innerHTML = '<main id="sheet-main"><div role="application" tabindex="0"></div></main><button id="x" disabled>Convert</button>';
    restoreFocusTo(document.getElementById('x'));
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('application'));
  });

  it('a focused control that disappears hands focus to its dock instead of <body>', async () => {
    document.body.innerHTML = '<main id="sheet-main"><div role="application" tabindex="0"></div></main><aside data-testid="dock-properties" aria-label="Properties"><a href="#" id="lnk">Open relationship</a></aside>';
    const off = startFocusPolicy();
    document.getElementById('lnk')!.focus();
    document.getElementById('lnk')!.remove();
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('dock-properties'));
    off();
  });

  it('does nothing after a pointer interaction (clicking empty space keeps focus on body)', async () => {
    document.body.innerHTML = '<main id="sheet-main"><div role="application" tabindex="0"></div></main><button id="b">b</button>';
    const off = startFocusPolicy();
    document.getElementById('b')!.focus();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.getElementById('b')!.remove();
    await new Promise((r) => setTimeout(r, 100));
    expect(document.activeElement).toBe(document.body);
    off();
  });
});
