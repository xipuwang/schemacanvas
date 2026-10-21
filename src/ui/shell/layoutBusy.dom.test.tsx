// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import '@/editor/commands';

/** A layout the test controls: stays pending until aborted or released; records the signal it received. */
const harness = vi.hoisted(() => ({ signal: undefined as AbortSignal | undefined, release: undefined as undefined | (() => void), calls: 0 }));
vi.mock('@/layout', async (orig) => {
  const real = await orig<typeof import('@/layout')>();
  return {
    ...real,
    autoLayout: (...args: unknown[]) =>
      real.trackLayoutBusy(
        () =>
          new Promise<Record<string, { x: number; y: number }>>((resolve, reject) => {
            harness.calls++;
            const opts = args[3] as { signal?: AbortSignal } | undefined;
            harness.signal = opts?.signal;
            harness.release = () => resolve({});
            opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
          }),
      ),
  };
});

import * as ops from '@/model/ops';
import { editorStore, settingsStore } from '@/store';
import { layoutBusyStore } from '@/layout';
import { uiStore } from '../uiStore';
import { Toolbar } from './Toolbar';
import { registerShellCommands } from './commands';

let off: () => void;
beforeEach(() => {
  harness.signal = undefined;
  harness.release = undefined;
  harness.calls = 0;
  editorStore.getState().newProject('Test');
  uiStore.setState({ dialog: null, toasts: [] });
  settingsStore.getState().setLocale('en');
  off = registerShellCommands();
  editorStore.getState().commit('add', (p) => {
    const er = Object.values(p.models).find((m) => m.kind === 'er')!;
    ops.addEntity(p, er.id, { name: 'A' });
  });
});
afterEach(() => {
  cleanup();
  off();
});

describe('auto-layout busy state in the toolbar', () => {
  it('shows a spinner, disables the button, announces, and Esc aborts through the AbortSignal', async () => {
    render(<Toolbar />);
    const btn = screen.getByRole('button', { name: 'Auto-layout' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(btn);
    const busy = await screen.findByRole('button', { name: 'Laying out…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Laying out the diagram. Press Esc to cancel.')).toBeTruthy();
    expect(harness.signal?.aborted).toBe(false);
    // a second click while busy does not start another layout
    fireEvent.click(busy);
    expect(harness.calls).toBe(1);
    const before = editorStore.getState().project;
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(harness.signal?.aborted).toBe(true);
    expect(((await screen.findByRole('button', { name: 'Auto-layout' })) as HTMLButtonElement).disabled).toBe(false);
    expect(layoutBusyStore.getState().pending).toBe(0);
    expect(editorStore.getState().project).toBe(before); // cancelled: nothing applied, no error toast
    expect(uiStore.getState().toasts).toHaveLength(0);
    expect(screen.queryByText('Laying out the diagram. Press Esc to cancel.')).toBeNull();
  });

  it('returns to idle when the layout finishes', async () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Auto-layout' }));
    await screen.findByRole('button', { name: 'Laying out…' });
    await act(async () => {
      harness.release?.();
    });
    expect(((await screen.findByRole('button', { name: 'Auto-layout' })) as HTMLButtonElement).disabled).toBe(false);
  });

  it('is localised in Chinese', async () => {
    settingsStore.getState().setLocale('zh');
    render(<Toolbar />);
    fireEvent.click(screen.getByRole('button', { name: '自动布局' }));
    expect(((await screen.findByRole('button', { name: '正在布局…' })) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      harness.release?.();
    });
  });
});
